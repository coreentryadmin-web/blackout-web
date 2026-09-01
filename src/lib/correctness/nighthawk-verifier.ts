import "server-only";

import {
  type CheckResult,
  type MetricScore,
  type TickerScore,
  fractionalDiff,
  rollUpMetricStatus,
  worstStatus,
} from "@/lib/correctness/types";
import { fetchLatestNighthawkEdition, fetchNighthawkPulledPlays, fetchStagedDossiers } from "@/lib/db";
import { applyNighthawkPullOverlay } from "@/features/nighthawk/lib/pull-overlay";
import { rowToNightHawkEdition } from "@/features/nighthawk/lib/edition-builder";
import type { PlaybookPlay } from "@/features/nighthawk/lib/types";
import {
  parseOptionsContract,
  evaluatePlayAgainstChain,
  fetchEditionChains,
  chainQuoteForParsedPlay,
  playPremiumWithinChainBand,
  type EditionChainData,
} from "@/features/nighthawk/lib/option-chain-prompt";
import { todayEt } from "@/lib/et-date";
import { validatePlayGeometry } from "@/features/nighthawk/lib/play-constraints";
import { MAX_OPTION_PREMIUM_PER_SHARE } from "@/features/nighthawk/lib/constants";

// ---------------------------------------------------------------------------
// NIGHT HAWK (evening plays scanner / published editions) data-correctness verifier — priority #4.
//
// Re-audits the LATEST PUBLISHED edition against the DOSSIER SNAPSHOT each play was built from. These
// are INDEPENDENT checks written here — they do NOT import the unmerged auto/nighthawk-grounding module.
//
//   L2 invariant (grounding) — every published play's ticker MUST have a staged dossier snapshot for
//      that edition (a play with no dossier was not grounded in any data); ranks are 1..N unique;
//      premium-cap flag agrees with entry_premium ≤ MAX_OPTION_PREMIUM_PER_SHARE; conviction/direction are in-vocabulary.
//   L2 invariant (geometry, task #146) — a published play's PERSISTED entry_range/target/stop must
//      still satisfy the SAME direction-aware geometry rule validatePlayGeometry() enforces at the
//      publish gate (LONG: target above / stop below the entry mid; SHORT: reversed; corrupt entry
//      ranges rejected). Until this task, target/stop LEVELS had zero independent post-publish
//      validation — only entry_premium was chain-confirmed (L4 below). See the dedicated comment
//      above that check for why it calls the REAL gate function rather than reimplementing it.
//   L1 shadow-recompute (dossier cross-check) — the per-play numbers the edition surfaces
//      (flow_streak_days, iv_rank) must equal the dossier snapshot's own values (the play can't claim
//      a flow streak / IV rank the dossier it was built from doesn't carry). Independent re-read.
//   L4 cross-provider (chain-confirm, CAPPED + GATED) — for a small sample of plays, parse the strike+
//      side from the options_play narrative and confirm it against a freshly-fetched ATM chain: strike
//      present ⇒ OI floor met (not contradicted), and the play's entry_premium is within the chain
//      bid/ask band (premium vs chain ask). This is the only layer that touches a live provider; it is
//      capped and behind CORRECTNESS_NIGHTHAWK_CHAIN (default ON, set =0 to skip in tight runs).
//
// RATE DISCIPLINE: the edition + dossiers are DB readers (one read each). The chain-confirm layer is
// the only upstream touch — it is CAPPED to CORRECTNESS_NIGHTHAWK_SAMPLE plays (default 3), fetches ONE
// ATM chain per sampled ticker through the existing rate-limited Polygon/UW funnel (fetchEditionChains),
// and is fully gateable. NO per-play fan-out beyond the cap; editions are evaluated once per run. The
// geometry check is pure/in-process (parsePlayLevels + arithmetic) — zero I/O, runs on every play.
//
// HONESTY: dossier cross-checks are SHADOW-RECOMPUTES against the snapshot (the play vs the data it
// was built from — proves internal grounding, not that the snapshot itself was objectively right). The
// geometry check is an INVARIANT, not a shadow-recompute: it re-derives the gate's own pass/fail
// verdict against what is actually PERSISTED and served today, so it cannot prove the gate's threshold
// math is objectively correct (play-geometry.test.ts already unit-tests that exhaustively as a pure
// function) — it proves the persisted record STILL satisfies the invariant the gate is supposed to
// guarantee, catching drift the gate itself can never see (DB corruption, a serialization bug, or a
// write path that bypassed the gate entirely). The chain-confirm is the strongest claim: a strike
// either IS liquid in the live chain or it isn't.
// ---------------------------------------------------------------------------

const VALID_CONVICTION = new Set(["A", "B", "C", "A+", "B+", "C+"]);

function chainConfirmEnabled(): boolean {
  return process.env.CORRECTNESS_NIGHTHAWK_CHAIN !== "0";
}
function chainSample(): number {
  const raw = Number(process.env.CORRECTNESS_NIGHTHAWK_SAMPLE);
  return Number.isFinite(raw) && raw >= 0 ? Math.min(Math.floor(raw), 8) : 3;
}

/** Premium vs live chain is only meaningful for the active session edition (today / next). */
function editionPremiumCheckApplicable(editionFor: string): boolean {
  if (!editionFor) return false;
  const today = todayEt();
  if (editionFor >= today) {
    const aheadMs =
      new Date(`${editionFor}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime();
    return aheadMs <= 2 * 86_400_000;
  }
  const ageMs = new Date(`${today}T00:00:00`).getTime() - new Date(`${editionFor}T00:00:00`).getTime();
  return ageMs / 86_400_000 <= 1;
}

function mk(
  layer: CheckResult["layer"],
  metric: string,
  outcome: CheckResult["outcome"],
  detail: string,
  extra: Partial<CheckResult> = {}
): CheckResult {
  return {
    id: `NIGHTHAWK:${metric}:${layer}:${extra.id ?? Math.abs(hashStr(detail)).toString(36)}`,
    layer,
    metric,
    outcome,
    detail,
    ...extra,
  };
}
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** Scale-slip detector for L4 chain-confirm — NOT an intraday theta check.
 *  Entry above ask is normal hours later on same-day expiry; only flag 5×+ slips or sub-half-bid. */
export function isPremiumChainScaleMismatch(entry: number, bid: number | null, ask: number): boolean {
  const lo = bid != null && bid > 0 ? bid * 0.5 : 0;
  if (entry < lo) return true;
  if (ask > 0 && entry > ask * 5) return true;
  return false;
}
function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function groupMetrics(ticker: string, checks: CheckResult[]): MetricScore[] {
  const byMetric = new Map<string, CheckResult[]>();
  for (const c of checks) {
    const arr = byMetric.get(c.metric) ?? [];
    arr.push(c);
    byMetric.set(c.metric, arr);
  }
  const scores: MetricScore[] = [];
  for (const [metric, mchecks] of byMetric.entries()) {
    const { status, independentlyConfirmed } = rollUpMetricStatus(mchecks);
    scores.push({ ticker, metric, status, independentlyConfirmed, checks: mchecks });
  }
  return scores;
}

/** Pull a numeric snapshot field from a dossier blob, trying a few key aliases. */
function dossierNum(dossier: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    if (k in dossier) {
      const n = num(dossier[k]);
      if (n != null) return n;
    }
  }
  // flow_streak is nested.
  const fs = dossier.flow_streak as Record<string, unknown> | undefined;
  if (fs && keys.includes("flow_streak_days")) {
    const n = num(fs.streak_days ?? fs.days ?? fs.streak);
    if (n != null) return n;
  }
  return null;
}

/**
 * Re-audit the latest published Night Hawk edition vs its dossier snapshot. Returns a TickerScore under
 * the synthetic "NIGHTHAWK" ticker. Never throws.
 */
export async function verifyNightHawk(_marketOpen: boolean): Promise<TickerScore> {
  const ticker = "NIGHTHAWK";
  const checks: CheckResult[] = [];

  let edition = null as Awaited<ReturnType<typeof fetchLatestNighthawkEdition>>;
  try {
    edition = await fetchLatestNighthawkEdition();
  } catch {
    edition = null;
  }
  if (!edition || !Array.isArray(edition.plays) || edition.plays.length === 0) {
    const skip: CheckResult = {
      id: "NIGHTHAWK:edition:freshness:cold",
      layer: "freshness",
      metric: "freshness",
      outcome: "skipped",
      detail: edition
        ? `Latest edition (${edition.edition_for}) is recap-only / has no ranked plays — nothing to chain-audit this run.`
        : "No published Night Hawk edition found — nothing to verify.",
    };
    return { ticker, status: "skipped", metrics: groupMetrics(ticker, [skip]) };
  }

  const editionFor = edition.edition_for ?? "";
  // Same pull overlay as /api/market/nighthawk/edition — latch lives on outcome rows,
  // not the published edition JSON. Chain-confirm must not sample latched tickers.
  let editionWithOverlay = rowToNightHawkEdition(edition);
  if (editionFor && edition.plays.length > 0) {
    try {
      const pulledRows = await fetchNighthawkPulledPlays(editionFor);
      editionWithOverlay = applyNighthawkPullOverlay(editionWithOverlay, pulledRows);
    } catch {
      /* fail-soft — same as edition route */
    }
  }

  const plays = editionWithOverlay.plays as PlaybookPlay[];

  // Staged dossier snapshots for this edition.
  let dossiers: Array<{ ticker: string; dossier: Record<string, unknown>; scored: Record<string, unknown> | null }> = [];
  try {
    dossiers = editionFor ? await fetchStagedDossiers(editionFor) : [];
  } catch {
    dossiers = [];
  }
  const dossierByTicker = new Map(dossiers.map((d) => [d.ticker.toUpperCase(), d]));

  // ── L2 INVARIANT: ranks 1..N unique ──────────────────────────────────────
  {
    const ranks = plays.map((p) => Number(p.rank)).filter((r) => Number.isFinite(r));
    const unique = new Set(ranks);
    const ok = unique.size === plays.length && Math.min(...ranks) === 1 && Math.max(...ranks) === plays.length;
    checks.push(
      mk(
        "invariant",
        "ranks",
        ok ? "consistency-only" : "flag",
        ok
          ? `Edition ${editionFor}: ${plays.length} plays ranked 1..${plays.length}, unique.`
          : `Edition ${editionFor}: ranks are not a clean 1..${plays.length} unique sequence (got ${[...unique].sort((a, b) => a - b).join(",")}).`,
        { id: "ranks-unique", expected: plays.length, actual: unique.size }
      )
    );
  }

  // ── L2 INVARIANT: every play grounded in a dossier snapshot ───────────────
  if (dossiers.length === 0) {
    checks.push(
      mk(
        "invariant",
        "grounding",
        "skipped",
        `No staged dossiers found for edition ${editionFor} (staging may be pruned post-publish) — per-play grounding cross-check not assertable this run.`,
        { id: "play-has-dossier" }
      )
    );
  } else {
    const ungrounded = plays.filter((p) => !dossierByTicker.has(String(p.ticker).toUpperCase()));
    checks.push(
      mk(
        "invariant",
        "grounding",
        ungrounded.length === 0 ? "consistency-only" : "flag",
        ungrounded.length === 0
          ? `All ${plays.length} published plays have a staged dossier snapshot (grounded).`
          : `${ungrounded.length} published play(s) have NO dossier snapshot (${ungrounded.map((p) => p.ticker).join(", ")}) — a play surfaced with no underlying data.`,
        { id: "play-has-dossier", expected: 0, actual: ungrounded.length }
      )
    );
  }

  // ── L2 INVARIANT: premium-cap flag agrees with entry_premium; vocab sane ──
  {
    let capMismatch = 0;
    let badVocab = 0;
    const capDetail: string[] = [];
    for (const p of plays) {
      if (p.entry_premium != null && Number.isFinite(p.entry_premium)) {
        const impliedOk = p.entry_premium <= MAX_OPTION_PREMIUM_PER_SHARE;
        if (p.premium_cap_ok != null && p.premium_cap_ok !== impliedOk) {
          capMismatch++;
          if (capDetail.length < 4) capDetail.push(`${p.ticker} prem $${p.entry_premium} cap_ok=${p.premium_cap_ok}`);
        }
        // entry_cost_per_contract == entry_premium × 100.
        if (p.entry_cost_per_contract != null) {
          const expectCost = Math.round(p.entry_premium * 100 * 100) / 100;
          if (Math.abs(p.entry_cost_per_contract - expectCost) > 0.5) {
            capMismatch++;
            if (capDetail.length < 4) capDetail.push(`${p.ticker} cost ${p.entry_cost_per_contract}!=${expectCost}`);
          }
        }
      }
      if (p.conviction && !VALID_CONVICTION.has(String(p.conviction).toUpperCase())) badVocab++;
    }
    checks.push(
      mk(
        "invariant",
        "premium",
        capMismatch === 0 ? "consistency-only" : "flag",
        capMismatch === 0
          ? `premium_cap_ok flags + entry_cost_per_contract reconcile with entry_premium across all plays (cap $${MAX_OPTION_PREMIUM_PER_SHARE}).`
          : `${capMismatch} premium inconsistency(ies): ${capDetail.join("; ")} — a cap flag or cost is wrong.`,
        { id: "premium-cap-consistent", expected: 0, actual: capMismatch }
      )
    );
    checks.push(
      mk(
        "sanity-bound",
        "conviction",
        badVocab === 0 ? "consistency-only" : "flag",
        badVocab === 0
          ? "All play convictions are in-vocabulary (A/B/C grades)."
          : `${badVocab} play(s) carry an out-of-vocabulary conviction grade.`,
        { id: "conviction-vocab", expected: 0, actual: badVocab }
      )
    );
  }

  // ── L2 INVARIANT: published target/stop still satisfy the publish-gate geometry rule (task #146) ─
  // Re-parses each PUBLISHED play's persisted entry_range/target/stop via parsePlayLevels() (by calling
  // validatePlayGeometry() itself, which parses internally) and re-checks the exact direction-aware
  // rule the live publish gate (validatePlayGeometry, src/lib/nighthawk/play-constraints.ts) enforces
  // BEFORE a play is allowed to publish: LONG target must sit above / stop below the entry-range mid;
  // SHORT is reversed; an unparseable target/stop or a corrupt entry range (non-positive bound, or
  // width > 20% of mid — the class PR #207 shipped once) drops the play outright.
  //
  // Deliberately calls the REAL validatePlayGeometry() rather than reimplementing the geometry rule
  // from scratch (contrast flows-verifier.ts's flow-anomaly shadow-recompute, which intentionally does
  // NOT import the code it is checking). The two situations are different: that check exists to catch a
  // REGRESSION IN THE GATE'S OWN THRESHOLD MATH, so a from-scratch re-derivation was required — importing
  // the code under test would let a bug in it be structurally mirrored in the very check meant to catch
  // it. This check exists to catch DRIFT BETWEEN GATE TIME AND READ TIME on already-published data: did
  // the persisted record a member is looking at right now still pass the same gate a play must have
  // passed to publish? A published play failing this is proof of one of three things — the gate was
  // bypassed by some other write path, the persisted JSON was corrupted after publish, or a serialization
  // round-trip mangled a level — none of which a from-scratch reimplementation would catch any better
  // than the real function (both would parse the same persisted strings), while a duplicated copy of the
  // gate's own thresholds (e.g. the 20%-of-mid corruption band) would silently drift out of sync with a
  // deliberate future change to validatePlayGeometry and start producing false flags. play-geometry.test.ts
  // already unit-tests validatePlayGeometry's own logic exhaustively as a pure function — this layer's
  // job is narrower and different: prove today's SERVED numbers still satisfy it, not re-litigate whether
  // the rule itself is correctly implemented.
  {
    let corrupted = 0;
    const detail: string[] = [];
    for (const p of plays) {
      const verdict = validatePlayGeometry(p);
      if (!verdict.ok) {
        corrupted++;
        if (detail.length < 5) detail.push(`${p.ticker} (rank ${p.rank}): ${verdict.drops.join("; ")}`);
      }
    }
    checks.push(
      mk(
        "invariant",
        "geometry",
        corrupted === 0 ? "consistency-only" : "flag",
        corrupted === 0
          ? `All ${plays.length} published plays' persisted entry/target/stop still satisfy validatePlayGeometry's direction-aware geometry gate (target/stop correctly ordered vs. entry mid; entry range not corrupt) — the same invariant enforced at publish time.`
          : `${corrupted} published play(s) have persisted target/stop that FAIL validatePlayGeometry's geometry gate post-publish: ${detail.join(" | ")} — the gate was bypassed at publish time, or the levels were corrupted/mangled after.`,
        { id: "published-geometry-gate", expected: 0, actual: corrupted }
      )
    );
  }

  // ── L1 SHADOW-RECOMPUTE: play numbers vs the dossier snapshot they came from ─
  if (dossiers.length > 0) {
    let mismatches = 0;
    let compared = 0;
    const detail: string[] = [];
    for (const p of plays) {
      const d = dossierByTicker.get(String(p.ticker).toUpperCase());
      if (!d) continue;
      // flow_streak_days vs dossier.flow_streak.streak_days
      if (p.flow_streak_days != null && Number.isFinite(p.flow_streak_days)) {
        const dv = dossierNum(d.dossier, "flow_streak_days");
        if (dv != null) {
          compared++;
          if (Math.abs(dv - p.flow_streak_days) > 0.5) {
            mismatches++;
            if (detail.length < 5) detail.push(`${p.ticker} flow_streak play=${p.flow_streak_days} dossier=${dv}`);
          }
        }
      }
      // iv_rank vs dossier.iv_rank (tolerate small rounding).
      if (p.iv_rank != null && Number.isFinite(p.iv_rank)) {
        const dv = dossierNum(d.dossier, "iv_rank");
        if (dv != null) {
          compared++;
          const fd = fractionalDiff(dv, p.iv_rank);
          if (fd > 0.05 && Math.abs(dv - p.iv_rank) > 2) {
            mismatches++;
            if (detail.length < 5) detail.push(`${p.ticker} iv_rank play=${p.iv_rank} dossier=${dv}`);
          }
        }
      }
    }
    checks.push(
      mk(
        "shadow-recompute",
        "play_vs_dossier",
        compared === 0 ? "skipped" : mismatches === 0 ? "consistency-only" : "flag",
        compared === 0
          ? "Dossier snapshots carry no comparable flow_streak/iv_rank fields this edition — play-vs-dossier cross-check skipped."
          : mismatches === 0
            ? `Per-play flow_streak_days + iv_rank match the dossier snapshot each play was built from (${compared} comparisons).`
            : `${mismatches} play number(s) DISAGREE with their dossier snapshot: ${detail.join("; ")} — a play claims a value its source data doesn't carry.`,
        { id: "play-vs-dossier", expected: 0, actual: mismatches }
      )
    );
  }

  // ── L4 CROSS-PROVIDER: chain-confirm a sample of strikes (capped + gated) ──
  if (!chainConfirmEnabled() || chainSample() === 0) {
    checks.push(
      mk(
        "cross-provider",
        "strike",
        "consistency-only",
        "Chain-confirm disabled (CORRECTNESS_NIGHTHAWK_CHAIN=0) — strikes are dossier-grounded but NOT live-chain confirmed this run.",
        { id: "strike-chain-confirm" }
      )
    );
  } else {
    // Sample the top-ranked actionable plays whose options_play has a parseable strike.
    // Pulled plays stay visible at their rank with a reason badge (pull-overlay) — they are
    // already excluded from the actionable surface, so chain-confirm must not flag them.
    const parseable = plays
      .filter((p) => !p.pulled)
      .map((p) => ({ play: p, parsed: parseOptionsContract(p.options_play ?? "") }))
      .filter((x) => x.parsed != null)
      .sort((a, b) => Number(a.play.rank) - Number(b.play.rank))
      .slice(0, chainSample());

    if (parseable.length === 0) {
      checks.push(
        mk(
          "cross-provider",
          "strike",
          "consistency-only",
          "No play's options_play narrative carries a parseable strike — chain-confirm not applicable this run (strikes remain dossier-grounded).",
          { id: "strike-chain-confirm" }
        )
      );
    } else {
      const sampleTickers = Array.from(new Set(parseable.map((x) => x.play.ticker.toUpperCase())));
      let chains: Record<string, EditionChainData> = {};
      try {
        chains = await fetchEditionChains({ stockTickers: sampleTickers, dossiers: [] });
      } catch {
        chains = {};
      }

      let confirmed = 0;
      let contradicted = 0;
      let premiumMismatch = 0;
      let unmatched = 0;
      const contraDetail: string[] = [];
      const premDetail: string[] = [];
      const publishedAtMs = Date.parse(edition.published_at ?? "");
      const premiumFresh =
        Number.isFinite(publishedAtMs) && Date.now() - publishedAtMs <= 4 * 60 * 60 * 1000;
      for (const { play, parsed } of parseable) {
        const chain = chains[play.ticker.toUpperCase()];
        if (!chain || !chain.rows.length) {
          unmatched++;
          continue;
        }
        const verdict = evaluatePlayAgainstChain(play.options_play ?? "", chain.rows);
        if (verdict.contradicted) {
          contradicted++;
          // Every real generator (formatOptionsPlay, grounding.ts, play-backfill.ts) already
          // writes options_play with the ticker as its own leading word ("MSTR $138 CALL @
          // $6.08 — Sep 4"), so unconditionally prepending play.ticker duplicated it in the
          // alert ("MSTR MSTR $138 CALL..." — caught live in #website-logs). Only prepend when
          // it's genuinely missing, so a future/edge-case source that doesn't self-prefix still
          // reads correctly.
          if (contraDetail.length < 5) {
            const detail = play.options_play ?? "";
            const tickerUpper = play.ticker.toUpperCase();
            contraDetail.push(
              detail.toUpperCase().startsWith(tickerUpper) ? detail : `${play.ticker} ${detail}`
            );
          }
          continue;
        }
        if (verdict.verified) {
          confirmed++;
          // Premium vs chain — only for freshly published editions with a fully parseable
          // contract (strike+side+expiry). Uses the SAME quote resolver as publish grounding;
          // the old first-row matcher false-flagged when multiple expiries share a strike
          // (NVDA $3.42 vs $1.86 on the wrong expiry). Overnight gaps still move premiums, so
          // also gate on published_at freshness (4h).
          if (
            premiumFresh &&
            play.entry_premium != null &&
            parsed &&
            editionPremiumCheckApplicable(editionFor)
          ) {
            const quote = chainQuoteForParsedPlay(parsed, chain.rows);
            if (quote && !playPremiumWithinChainBand(play.entry_premium, quote)) {
              premiumMismatch++;
              if (premDetail.length < 5) {
                premDetail.push(
                  `${play.ticker} entry $${play.entry_premium} vs chain ref $${quote.ref.toFixed(2)} (bid/ask ${quote.bid}/${quote.ask})`
                );
              }
            }
          }
        } else {
          unmatched++; // present in neither / longer-dated than the ATM window — not a contradiction
        }
      }

      checks.push(
        mk(
          "cross-provider",
          "strike",
          contradicted === 0 ? (confirmed > 0 ? "pass" : "consistency-only") : "flag",
          contradicted === 0
            ? confirmed > 0
              ? `${confirmed}/${parseable.length} sampled play strikes INDEPENDENTLY CONFIRMED in the live chain (strike present + OI floor met); ${unmatched} outside the ATM/front-expiry window (not contradicted).`
              : `Sampled play strikes could not be matched in the narrow ATM window (${unmatched} outside it) — no contradiction, but none confirmed this run.`
            : `${contradicted} sampled play(s) are CONTRADICTED by the live chain (strike present but OI below the liquidity floor): ${contraDetail.join("; ")}.`,
          {
            id: "strike-chain-confirm",
            expected: 0,
            actual: contradicted,
            independentlyConfirmed: contradicted === 0 && confirmed > 0,
          }
        )
      );

      if (premiumMismatch > 0 || confirmed > 0) {
        checks.push(
          mk(
            "cross-provider",
            "premium",
            premiumMismatch === 0 ? "pass" : "flag",
            premiumMismatch === 0
              ? `Sampled play entry premiums sit within the live chain bid/ask band (confirmed against ${confirmed} matched strike(s)).`
              : `${premiumMismatch} play premium(s) are OUTSIDE the chain bid/ask band: ${premDetail.join("; ")} — entry premium doesn't match the live market (scale/quote error).`,
            { id: "premium-vs-chain-ask", expected: 0, actual: premiumMismatch, independentlyConfirmed: premiumMismatch === 0 }
          )
        );
      }
    }
  }

  const metrics = groupMetrics(ticker, checks);
  return { ticker, status: worstStatus(metrics.map((m) => m.status)), metrics };
}
