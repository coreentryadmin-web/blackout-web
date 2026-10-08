import {
  fetchNighthawkEditionByDate,
  fetchNighthawkCandidateSnapshots,
  fetchNighthawkScoringHistory,
  upsertNighthawkEdition,
  insertNighthawkCandidateSnapshots,
  type NighthawkCandidateSnapshotRow,
} from "@/lib/db";
import type { TickerDossier } from "./dossier";
import type { ScoredCandidate } from "./scorer";
import type { PlaybookPlay } from "./types";
import { backfillThinEditionPlays } from "./play-backfill";
import { effectiveMinPublishPlays, computeQualityFloorNote } from "./edition-quality";
import { buildRankFinalSnapshotRows } from "./edition-builder";
import { alertCandidateSnapshotWriteFailure } from "./candidate-snapshot-alert";
import { syncNighthawkPlayOutcomes } from "./play-outcomes";

/**
 * Every other Legacy publish path (edition-builder.ts) calls syncNighthawkPlayOutcomes right
 * after writing the edition row -- this module's own republish path never did, so a BACKFILL
 * play could end up with no nighthawk_play_outcomes row at all. Three real consequences, found
 * live 2026-09-29: (1) the 9:15am ET morning-confirm cron's pull latch (morning-verdict-
 * persist.ts's recordNighthawkMorningVerdict) silently no-ops for a ticker with no row to match
 * ("missing_rows"), so an INVALIDATED backfilled play never gets pulled=true and the
 * member-facing edition keeps showing it as an actionable pick -- a real split-brain (BB:
 * play-status said INVALIDATED, the edition's own pulled overlay said false) caught by
 * legacy-e2e-healthcheck.mjs's stage D; (2) the ticker is invisible to forward-grading/
 * analytics, which read off this same table; (3) it can never resolve to a win/loss.
 * `publish_context` is intentionally omitted (null) -- backfilled plays never ran the
 * publish-time gate stack this pin records (the same gap
 * backfillBypassesPublishGates_2026_09_17T1815Z already flags), and the pin is documented
 * fail-soft: an un-pinned row must never block the outcome sync. Idempotent
 * (ON CONFLICT ... WHERE outcome = 'pending'), so calling this for a play that already has a
 * synced row is always a safe no-op. Isolated in its own try/catch, matching
 * edition-builder.ts's "POST-PUBLISH steps isolated from the outer catch" discipline -- a
 * transient DB failure here must never fail the caller.
 */
async function syncOutcomeRows(
  editionFor: string,
  plays: PlaybookPlay[],
  dossiers: Record<string, TickerDossier>
): Promise<void> {
  try {
    const sectorByTicker = Object.fromEntries(
      plays.map((p) => {
        const ticker = String(p.ticker ?? "").toUpperCase();
        return [ticker, dossiers[ticker]?.sector ?? null];
      })
    );
    await syncNighthawkPlayOutcomes(editionFor, plays, sectorByTicker, {});
  } catch (err) {
    console.warn("[nighthawk/post-publish-backfill] outcome-row sync failed:", err);
  }
}

/**
 * Pure reconstruction of the real, already-frozen `ranked` pool (post cross-edition-governor
 * demotion) from durably-persisted `rank_governor`-stage nighthawk_candidate_snapshot rows.
 * This is NOT re-scoring — it is reading back the exact decision-time payload
 * `scoredCandidateSnapshotPayload` (scorer.ts) already wrote that night. Every field defaults
 * conservatively (0 / undefined) when a component wasn't captured rather than fabricating a value.
 */
export function reconstructScoredPoolFromRankGovernorRows(
  rows: NighthawkCandidateSnapshotRow[]
): ScoredCandidate[] {
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const numOrUndef = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

  return rows
    .filter((r) => r.stage === "rank_governor")
    .map((r) => {
      const snap = r.snapshot_json ?? {};
      const components = (snap.components as Record<string, unknown>) ?? {};
      return {
        ticker: r.ticker,
        score: typeof snap.score === "number" ? snap.score : num(r.score),
        direction: snap.direction === "short" ? "short" : "long",
        flow_score: num(components.flow_score),
        tech_score: num(components.tech_score),
        pos_score: num(components.pos_score),
        news_score: num(components.news_score),
        smart_money_score: num(components.smart_money_score),
        fundamental_score: numOrUndef(components.fundamental_score),
        catalyst_score: numOrUndef(components.catalyst_score),
        catalyst_flags: Array.isArray(components.catalyst_flags) ? (components.catalyst_flags as string[]) : undefined,
        short_interest_score: numOrUndef(components.short_interest_score),
        wall_proximity_score: numOrUndef(components.wall_proximity_score),
        vex_alignment_score: numOrUndef(components.vex_alignment_score),
        skew_score: numOrUndef(components.skew_score),
        earnings_risk: typeof snap.earnings_risk === "boolean" ? snap.earnings_risk : undefined,
        confirming_signals: numOrUndef(snap.confirming_signals),
        conviction: typeof snap.conviction === "string" ? snap.conviction : "C",
        regime_multiplier: numOrUndef(snap.regime_multiplier),
        fundamental_block: typeof snap.fundamental_block === "boolean" ? snap.fundamental_block : undefined,
        fundamental_flags: Array.isArray(snap.fundamental_flags) ? (snap.fundamental_flags as string[]) : undefined,
        trading_halt: typeof snap.trading_halt === "boolean" ? snap.trading_halt : undefined,
        sector: typeof snap.sector === "string" ? snap.sector : undefined,
        govPenalty: typeof snap.gov_penalty === "number" ? snap.gov_penalty : numOrUndef(r.gov_penalty),
      };
    });
}

export type RepublishBackfillResult =
  | { ok: true; status: "noop_already_at_minimum"; editionFor: string; playsCount: number }
  | { ok: true; status: "noop_no_eligible_pool"; editionFor: string; playsCount: number }
  | {
      ok: true;
      status: "backfilled";
      editionFor: string;
      playsCount: number;
      addedTickers: string[];
      notes: string[];
    }
  | { ok: false; status: "no_published_edition" | "no_rank_governor_snapshot"; editionFor: string };

/**
 * Operator-directed, admin-triggered republish (2026-09-28): an edition already published below
 * the minimum play count. This applies the structural-only-eligibility backfill logic
 * (play-backfill.ts's selectBackfillPlays) to that SAME edition's real, already-frozen
 * rank_governor candidate pool — it does not re-run discovery, dossier fetch, or scoring, and it
 * never touches an already-published QUALIFIED play. Live option chains are fetched fresh
 * (a frozen contract could be illiquid/repriced/expired by read time), same as the live pipeline's
 * own backfill call already does. No placeholder contracts, never replaces a QUALIFIED play with a
 * BACKFILL one, respects the cross-edition governor's demotion (ranks on effectiveMeritScore) —
 * identical guarantees to the pipeline's own thin-edition path, just invoked after the fact.
 */
export async function republishBackfilledEdition(editionFor: string): Promise<RepublishBackfillResult> {
  const existing = await fetchNighthawkEditionByDate(editionFor);
  if (!existing) return { ok: false, status: "no_published_edition", editionFor };

  const finalPlays: PlaybookPlay[] = (existing.plays as PlaybookPlay[]).map((p) => ({
    ...p,
    selection_tier: p.selection_tier ?? "QUALIFIED",
  }));

  const historyRows = await fetchNighthawkScoringHistory(editionFor);
  const dossiers: Record<string, TickerDossier> = {};
  for (const row of historyRows) {
    dossiers[row.ticker.toUpperCase()] = row.dossier as unknown as TickerDossier;
  }

  // Repair pass, runs on EVERY call regardless of whether backfill actually happens below --
  // this is what lets re-invoking this same admin endpoint on an edition that's already at its
  // play-count minimum still fix a real gap: any play already in `existing.plays` (e.g. a
  // BACKFILL ticker added by an earlier call, before this repair pass existed) that never got a
  // nighthawk_play_outcomes row synced. Running this BEFORE the minPlays early-return below is
  // the whole point -- without it, a second call against an already-at-minimum edition would
  // never reach a sync call, since the only one used to live inside the backfilled-only branch
  // further down. See syncOutcomeRows above for the full defect this closes.
  await syncOutcomeRows(editionFor, finalPlays, dossiers);

  const minPlays = effectiveMinPublishPlays();
  if (finalPlays.length >= minPlays) {
    return { ok: true, status: "noop_already_at_minimum", editionFor, playsCount: finalPlays.length };
  }

  const snapshotRows = await fetchNighthawkCandidateSnapshots(editionFor, { stage: "rank_governor" });
  if (!snapshotRows.length) return { ok: false, status: "no_rank_governor_snapshot", editionFor };
  const pool = reconstructScoredPoolFromRankGovernorRows(snapshotRows);

  const result = await backfillThinEditionPlays({ finalPlays, ranked: pool, dossiers, minPlays });
  if (!result.notes.length) {
    return { ok: true, status: "noop_no_eligible_pool", editionFor, playsCount: finalPlays.length };
  }

  const govPenaltyByTicker = new Map(pool.map((c) => [c.ticker.toUpperCase(), c.govPenalty ?? 0]));
  const qualityFloorNote = computeQualityFloorNote(result.plays, minPlays);

  await upsertNighthawkEdition({
    edition_for: existing.edition_for,
    session_date: existing.session_date,
    recap_headline: existing.recap_headline,
    recap_summary: existing.recap_summary,
    market_recap: existing.market_recap,
    plays: result.plays,
    meta: {
      ...existing.meta,
      quality_floor_note: qualityFloorNote,
      post_publish_backfill: {
        at: new Date().toISOString(),
        notes: result.notes,
      },
    },
  });

  const addedTickers = result.plays
    .filter((p) => p.selection_tier === "BACKFILL")
    .map((p) => p.ticker.toUpperCase());

  void insertNighthawkCandidateSnapshots(
    buildRankFinalSnapshotRows(editionFor, result.plays, govPenaltyByTicker)
  ).catch((err) => {
    console.warn("[nighthawk/post-publish-backfill] rank_final snapshot write failed:", err);
    alertCandidateSnapshotWriteFailure("rank_final:post_publish_backfill", editionFor, err);
  });

  // Re-sync with the FINAL play list (the early repair pass above only covered `finalPlays`,
  // the pre-backfill set) -- this is what actually creates the new BACKFILL tickers' outcome
  // rows. Re-syncing the pre-existing ones again alongside them is a safe no-op (see
  // syncOutcomeRows above).
  await syncOutcomeRows(editionFor, result.plays, dossiers);

  return {
    ok: true,
    status: "backfilled",
    editionFor,
    playsCount: result.plays.length,
    addedTickers,
    notes: result.notes,
  };
}
