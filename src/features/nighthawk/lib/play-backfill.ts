import { mapClaudePlayToEdition } from "./claude-edition";
import { MAX_OPTION_PREMIUM_PER_SHARE } from "./constants";
import { buildDeterministicThesis } from "./deterministic-edition";
import type { TickerDossier } from "./dossier";
import { effectiveMeritScore, effectiveMinPublishPlays } from "./edition-quality";
import { tieredMinOi } from "./grounding";
import { parseOptionsContract } from "./option-contract-parse";
import { validatePlayGeometry } from "./play-constraints";
import { capGatePromotedConviction } from "./publish-gates";
import { buildDirectionalStockLevels, computeRiskReward } from "./play-levels";
import {
  fetchEditionChains,
  type ChainStrikeRow,
  type EditionChainData,
} from "./option-chain-prompt";
import type { ScoredCandidate } from "./scorer";
import type { PlaybookPlay } from "./types";
import { todayEtYmd } from "@/lib/providers/spx-session";

/**
 * Pick the nearest affordable, liquid chain contract for a directional play.
 *
 * `asOfEtYmd` (defaults to today's ET date) is the hard expiry floor: any row whose expiry is
 * on or before that date is excluded before ranking, never merely de-prioritized. Without this,
 * a chain row that is already expired (or expires same-day) can still be picked when it happens
 * to be the nearest-strike/cheapest-ask candidate — this is exactly how a live BACKFILL/
 * gate-promoted PLTR play recommended "PLTR $197.5 Call 2026-10-23" inside an edition published
 * for target trading day 2026-10-26 (confirmed dead via legacy-marks: mark/bid/ask all null) —
 * `resolveTickerChainRows`'s Polygon snapshot is *usually* non-expired-only, but a chain fetched
 * right at/after a Friday close can still momentarily carry that day's own contract. This mirrors
 * the guard `pickChainContract` (deterministic-edition.ts) already enforces for the organic path
 * ("Swing never trades a same-day expiry") — backfill had no equivalent, so it inherited none of
 * that protection. Deliberately just the expiry floor, not pickChainContract's full 2-10 DTE
 * band: that band has soft fallback pools (shortDated/longDated) for when nothing in the ideal
 * window qualifies, whereas "already expired" has no such fallback anywhere in either picker —
 * it is the one hard, unconditional exclusion both pickers share.
 */
export function pickAffordableChainContract(
  ticker: string,
  direction: "long" | "short",
  chain: EditionChainData | undefined,
  asOfEtYmd?: string
): { options_play: string; entry_premium: number } | null {
  if (!chain?.rows?.length) return null;
  const side = direction === "short" ? "put" : "call";
  const spot = chain.spot > 0 ? chain.spot : 0;
  const today = asOfEtYmd ?? todayEtYmd();

  const minOi = spot > 0 ? tieredMinOi(spot) : 500;
  const affordable = (row: ChainStrikeRow): number | null => {
    if (row.expiry <= today) return null;
    const ask = side === "put" ? row.put_ask : row.call_ask;
    const oi = side === "put" ? row.put_oi : row.call_oi;
    if (ask == null || !Number.isFinite(ask) || ask <= 0 || ask > MAX_OPTION_PREMIUM_PER_SHARE) return null;
    if (oi < minOi) return null;
    return Number(ask.toFixed(2));
  };

  const candidates = [...chain.rows]
    .map((row) => ({ row, premium: affordable(row) }))
    .filter((c): c is { row: ChainStrikeRow; premium: number } => c.premium != null)
    .sort((a, b) => {
      const distA = spot > 0 ? Math.abs(a.row.strike - spot) : 0;
      const distB = spot > 0 ? Math.abs(b.row.strike - spot) : 0;
      if (distA !== distB) return distA - distB;
      return a.row.expiry.localeCompare(b.row.expiry);
    });

  const best = candidates[0];
  if (!best) return null;
  const sideLabel = side === "put" ? "Put" : "Call";
  return {
    options_play: `${ticker} $${best.row.strike} ${sideLabel} ${best.row.expiry}, entry prem ~$${best.premium.toFixed(2)}`,
    entry_premium: best.premium,
  };
}

/**
 * Retroactive repair pass (2026-10-24, Ask Largo/Legacy standing mandate — live repro, Monday
 * 2026-10-26 edition). `pickAffordableChainContract`'s own expiry floor above only runs at
 * GENERATION time — an edition already PUBLISHED before that floor shipped can still carry an
 * already-dead BACKFILL contract in its persisted `plays`, and nothing else downstream catches
 * it: `morning-confirm-verdict.ts` checks entry-trigger geometry, never contract liveness, so a
 * BACKFILL play whose own options contract already expired relative to `editionFor` sails through
 * untouched all the way to market open. Live repro: `edition_for: "2026-10-26"` carried a
 * BACKFILL PLTR play recommending "PLTR $197.5 Call 2026-10-23" — already expired, confirmed dead
 * via legacy-marks (mark/bid/ask all null) — three days before the edition's own target day.
 *
 * PURE — chains are an input, same "no network inside the testable function" split every sibling
 * function in this file already uses (see `selectBackfillPlays`'s own comment). Deliberately
 * BACKFILL-only, mirroring the admin republish route's own documented scope boundary ("never
 * touches an already-published QUALIFIED play") — an organically-QUALIFIED play went through the
 * real discovery/scoring pipeline and its contract is the pipeline's actual pick, not backfill's
 * synthetic one; repairing it here would be a different, unaudited failure mode, not this one.
 * A BACKFILL play whose replacement contract can't be resolved is DROPPED, never left stale and
 * never replaced with a placeholder — the exact same skip-rather-than-placeholder discipline
 * `selectBackfillPlays` already applies when backfilling a thin edition in the first place.
 */
export function repairStaleBackfillPlays(params: {
  /** Edition's own target trading day — the expiry floor, same value `editionFor` means
   *  everywhere else in this file. */
  editionFor: string;
  plays: PlaybookPlay[];
  chains: Record<string, EditionChainData>;
  /** Anchors year-inference for a bare "Mon DD" options_play label — pass the edition's own
   *  publish instant (mirrors `resolveLegacyPlayOcc`'s documented convention), never real "now"
   *  for a possibly-old edition. */
  referenceDate?: Date;
}): { plays: PlaybookPlay[]; repairedTickers: string[]; droppedTickers: string[] } {
  const { editionFor, plays, chains, referenceDate } = params;
  const repairedTickers: string[] = [];
  const droppedTickers: string[] = [];
  const result: PlaybookPlay[] = [];

  for (const play of plays) {
    if (play.selection_tier !== "BACKFILL") {
      result.push(play);
      continue;
    }
    const expiry = parseOptionsContract(play.options_play, referenceDate)?.expiryYmd ?? null;
    // No parseable expiry, or still live as of the edition's own target day — leave untouched.
    if (expiry == null || expiry > editionFor) {
      result.push(play);
      continue;
    }
    const ticker = play.ticker.toUpperCase();
    const direction = play.direction?.toLowerCase() === "short" ? "short" : "long";
    const contract = pickAffordableChainContract(ticker, direction, chains[ticker], editionFor);
    if (!contract) {
      droppedTickers.push(ticker);
      continue;
    }
    repairedTickers.push(ticker);
    result.push({ ...play, options_play: contract.options_play, entry_premium: contract.entry_premium });
  }

  return { plays: result, repairedTickers, droppedTickers };
}

/**
 * STRUCTURAL-ONLY backfill eligibility (2026-09-28 redesign, operator-approved — replaces the old
 * rankedCandidateMeritEligible, which required the SAME score+tier bar as the organic path and
 * made backfill a no-op on any night where the whole pool scored weakly, not just a gate-rejection
 * rescue). Backfill exists specifically to admit a candidate that did NOT clear the merit bar, so
 * checking that bar here would defeat the point. What it must still clear is "this is a real,
 * safe, gradeable trade, not a guess":
 *   - not trading-halted (mirrors deterministic-edition.ts's own main-loop check — a halted name
 *     has no live market to enter at all, backfill or not).
 * Score/tier are deliberately NOT checked here. Sector-concentration risk is respected by
 * ranking the eligible pool on effectiveMeritScore (governor-demoted), never raw score, in
 * backfillThinEditionPlays below — a name the cross-edition governor already discounted for
 * over-representation stays discounted for backfill purposes too, it is never bypassed.
 * "Completed scoring" and "resolves a real, liquid, affordable, geometry-valid contract" are
 * enforced by construction: the caller only ever passes candidates from the already-scored
 * `ranked` pool, and backfillThinEditionPlays itself skips (never placeholder-publishes) any
 * candidate that can't resolve a real contract or fails the geometry gate.
 */
export function backfillCandidateEligible(scored: ScoredCandidate): boolean {
  return !scored.trading_halt;
}

/**
 * PURE selection logic (2026-09-28, extracted from backfillThinEditionPlays so it's testable
 * without a network-dependent chain fetch — same split `buildDeterministicEditionPlays` already
 * uses: chains are an INPUT, never fetched internally). Given an already-eligible, already-ranked
 * pool plus their resolved chains, builds up to `minPlays` backfill plays. Every rejection reason
 * (no dossier, no contract, failed geometry) is a plain `continue` with a console.warn — the
 * candidate is simply not added, never published as a placeholder.
 */
export function selectBackfillPlays(params: {
  finalPlays: PlaybookPlay[];
  pool: ScoredCandidate[];
  dossiers: Record<string, TickerDossier>;
  chains: Record<string, EditionChainData>;
  minPlays: number;
  /** Edition's own target trading day (edition_for) — the expiry floor threaded into
   *  pickAffordableChainContract below. Defaults to today's ET date when omitted. */
  asOfEtYmd?: string;
}): { plays: PlaybookPlay[]; notes: string[] } {
  const { finalPlays, dossiers, chains, minPlays, asOfEtYmd } = params;
  const used = new Set(finalPlays.map((p) => p.ticker.toUpperCase()));
  const notes: string[] = [];
  const backfilled: PlaybookPlay[] = [...finalPlays];
  // effectiveMeritScore, not raw score: a candidate the cross-edition sector-concentration
  // governor already demoted stays demoted here too — backfill ranks AFTER that risk control is
  // applied, it does not let a capped sector jump back ahead of an uncapped one by reverting to
  // raw score. Sorted here (not by the caller) so this — the part the operator specifically
  // required ("rank the remaining eligible candidates after those risk controls are applied") —
  // is covered by a pure, direct unit test rather than trusted-by-construction in the
  // network-touching wrapper.
  const pool = [...params.pool].sort((a, b) => effectiveMeritScore(b) - effectiveMeritScore(a));

  for (const scored of pool) {
    if (used.has(scored.ticker.toUpperCase())) continue;
    if (backfilled.length >= minPlays) break;
    const ticker = scored.ticker.toUpperCase();
    const dossier = dossiers[ticker];
    if (!dossier) continue;

    // No placeholder contracts: a backfill candidate with no real, liquid, affordable contract
    // is skipped outright, never published with an options_play of "-". This is the concrete
    // "prevent obviously bad/invalid contracts" guard — pickAffordableChainContract already
    // enforces the liquidity floor (tieredMinOi) and the $35/share premium cap; here we simply
    // refuse to fall through when it returns null instead of silently degrading to stock-only.
    const contract = pickAffordableChainContract(ticker, scored.direction, chains[ticker], asOfEtYmd);
    if (!contract) {
      console.warn(`[nighthawk/backfill] skipped ${ticker} — no real liquid/affordable contract`);
      continue;
    }
    const support = dossier.tech?.support_levels?.[0];
    const resistance = dossier.tech?.resistance_levels?.[0];
    const spot = dossier.tech?.price ?? chains[ticker]?.spot;
    const levels = buildDirectionalStockLevels({
      direction: scored.direction,
      support,
      resistance,
      spot,
    });
    // Same narrative builder every organically-qualified play (buildPlay) and last-resort rescue
    // play (buildRescuePlays) already use, both in deterministic-edition.ts — before this, a
    // backfill play's thesis/key_signal were both just `dossier.tech?.summary` (a bare technical
    // one-liner, e.g. "BB holding above VWAP.") with no catalyst quote, R:R context, or watch
    // flags, reading noticeably thinner than an organic pick even though buildDeterministicThesis
    // needs nothing selectBackfillPlays doesn't already have in scope (scored, dossier, levels).
    const { thesis, key_signal } = buildDeterministicThesis(scored, dossier, levels);
    // BUG FIX (Ask Largo standing mandate, 2026-10-25): mapClaudePlayToEdition (claude-edition.ts)
    // never sets `rr_ratio` — only the two organic-path builders (buildPlay/buildRescuePlays,
    // deterministic-edition.ts) compute it via computeRiskReward and attach it. buildDeterministicThesis
    // above ALREADY computes the identical number (same function, same `levels`) to embed in the
    // "R:R X:1" sentence of `thesis` — it just never reaches the structured field for this path. Live
    // repro: 2026-10-26 edition, PLTR (selection_tier BACKFILL) — thesis read "R:R 0.9:1 (acceptable)"
    // while `rr_ratio` was absent, so PlaybookBriefingPanel.tsx's "R:R" stat (gated on
    // `play.rr_ratio != null`) and play-explainer.ts's "Risk/reward ratio: X" line both silently
    // omitted it for a BACKFILL-tier play only — the same fact present in prose, missing from the
    // structured field. Fix mirrors buildRescuePlays' own call shape exactly, so the two numbers can
    // never disagree with each other.
    const rr_ratio =
      computeRiskReward({
        direction: scored.direction === "short" ? "SHORT" : "LONG",
        entry_range: levels.entry_range,
        target: levels.target,
        stop: levels.stop,
      }) ?? undefined;
    const play = {
      ...mapClaudePlayToEdition(
        {
          ticker,
          type: "stock",
          direction: scored.direction === "long" ? "LONG" : "SHORT",
          conviction: scored.conviction,
          key_signal,
          entry_range: levels.entry_range,
          target: levels.target,
          stop: levels.stop,
          options_play: contract.options_play,
          entry_premium: contract.entry_premium,
          score: scored.score,
        },
        backfilled.length + 1,
        dossiers
      ),
      // mapClaudePlayToEdition derives `thesis` from the SAME raw `key_signal` it's given (no
      // separate thesis field on ClaudePlayRaw) — override with buildDeterministicThesis's own
      // richer, distinct thesis text rather than letting the compact key_signal double as both.
      thesis,
      rr_ratio,
    };
    // Defense in depth: skip backfill candidates that still fail geometry (e.g. resistance ≤ support).
    if (!validatePlayGeometry(play).ok) {
      console.warn(`[nighthawk/backfill] skipped ${ticker} — levels fail geometry gate`);
      continue;
    }
    backfilled.push(
      capGatePromotedConviction({
        ...play,
        gate_promoted: true,
        selection_tier: "BACKFILL",
        gate_warnings: [
          `Ranked-pool merit fill (#${backfilled.length + 1} by score ${Math.round(effectiveMeritScore(scored))}) — verify entry geometry before acting`,
        ],
      }),
    );
    used.add(ticker);
    notes.push(
      `Merit backfill ${ticker} (merit ${Math.round(effectiveMeritScore(scored))}) — chain-grounded contract.`
    );
  }

  if (!notes.length) return { plays: finalPlays, notes: [] };

  const reranked = backfilled.map((p, i) => ({ ...p, rank: i + 1 }));
  return {
    plays: reranked,
    notes: [
      `Thin edition backfill: added ${notes.length} ranked-pool play(s) to reach minimum ${minPlays}.`,
      ...notes,
    ],
  };
}

/**
 * When critic/grounding/merit filter leaves fewer than the ops minimum, backfill from the
 * next-best ranked candidates (same universe as synthesis, sorted by governor-adjusted
 * effectiveMeritScore so the cross-edition sector cap is respected, never bypassed) with
 * chain-grounded contracts. Every backfill play is gate_promoted, carries selection_tier:
 * "BACKFILL" (distinct from an organically-qualified play), and an honest warning — never
 * silent filler, and never a placeholder: a candidate with no resolvable contract is skipped,
 * not published with a "-" options_play. Thin I/O wrapper around selectBackfillPlays — fetches
 * chains for the eligible pool, then hands off to the pure selection logic above.
 */
export async function backfillThinEditionPlays(params: {
  finalPlays: PlaybookPlay[];
  ranked: ScoredCandidate[];
  dossiers: Record<string, TickerDossier>;
  minPlays?: number;
  /** Edition's own target trading day (edition_for) — threaded down to pickAffordableChainContract
   *  as the hard expiry floor. Every call site has this value in scope; omitting it falls back to
   *  today's ET date rather than failing, since "today" is still a correct (if less precise) floor. */
  editionFor?: string;
}): Promise<{ plays: PlaybookPlay[]; notes: string[] }> {
  const minPlays = params.minPlays ?? effectiveMinPublishPlays();
  if (params.finalPlays.length >= minPlays) {
    return { plays: params.finalPlays, notes: [] };
  }

  const used = new Set(params.finalPlays.map((p) => p.ticker.toUpperCase()));
  // Dedupe + structural eligibility only — selectBackfillPlays does the governor-respecting sort.
  const pool = params.ranked
    .filter((r) => !used.has(r.ticker.toUpperCase()))
    .filter((r) => backfillCandidateEligible(r));
  if (!pool.length) return { plays: params.finalPlays, notes: [] };

  const dossierList = pool
    .map((r) => params.dossiers[r.ticker.toUpperCase()])
    .filter((d): d is TickerDossier => Boolean(d));

  const chains = await fetchEditionChains({
    stockTickers: pool.map((r) => r.ticker),
    dossiers: dossierList,
  });

  return selectBackfillPlays({
    finalPlays: params.finalPlays,
    pool,
    dossiers: params.dossiers,
    chains,
    minPlays,
    asOfEtYmd: params.editionFor,
  });
}
