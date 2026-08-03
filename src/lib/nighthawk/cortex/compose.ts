// NIGHT HAWK CORTEX — the evidence composer (design doc §0/§2).
//
// composeCortexEvidence(input) is PURE over a CortexInputs snapshot: no IO, no
// Date.now() — the clock arrives as input.now (threaded by fetch.ts / the caller),
// so any verdict is exactly reproducible from its persisted snapshot (the §3.1
// calibration loop depends on this). Structure:
//
//   1. every source module derives EvidenceItems from its slice (pure);
//   2. each item decays exponentially by its half-life from asOf vs now — stale
//      evidence self-silences, and beyond ABSENT_AFTER_HALF_LIVES it is demoted to
//      absent outright (§0 "evidence decay" / §3.4 "alpha that expires");
//   3. supports are capped PER SOURCE (§0 veto asymmetry: one loud bullish signal
//      can never buy an entry), vetoes are unbounded hard blocks, opposes carry
//      their named-constant weights (each already bounded at emission);
//   4. score = Σ(decayed, capped supports) − Σ(decayed opposes); vetoes ride
//      alongside — a vetoed play keeps its score for the calibration ledger, but
//      the gate stack blocks on vetoes.length > 0 regardless of score (§2 wiring).

import type {
  CortexConviction,
  CortexInputs,
  CortexSourceFamily,
  CortexSourceFn,
  CortexSourceId,
  CortexVerdict,
  EvidenceItem,
} from "./types";
import { CORTEX_SOURCE_FAMILY, CORTEX_SOURCES } from "./types";
import { deriveCatalystNewsEvidence, CATALYST_SUPPORT_CAP } from "./sources/catalyst-news";
import { deriveDarkPoolConfluenceEvidence, DARKPOOL_SUPPORT_CAP } from "./sources/darkpool-confluence";
import { deriveFlowQualityEvidence, FLOW_SUPPORT_CAP } from "./sources/flow-quality";
import { deriveGexWallsEvidence, GEX_WALLS_SUPPORT_CAP } from "./sources/gex-walls";
import { deriveOpeningHarvestEvidence, OPENING_HARVEST_SUPPORT_CAP } from "./sources/opening-harvest";
import { deriveSectorHeatEvidence, SECTOR_HEAT_SUPPORT_CAP } from "./sources/sector-heat";
import { deriveVexCharmEvidence, VEX_CHARM_SUPPORT_CAP } from "./sources/vex-charm";
import { deriveWallTrendEvidence, WALL_TREND_SUPPORT_CAP } from "./sources/wall-trend";

/** Evidence older than 3 half-lives is treated as ABSENT, not merely faint: at 3
 *  half-lives the decayed contribution is ≤12.5% of its raw weight — below that the
 *  honest statement is "this source cannot answer right now", and pretending a
 *  microscopic weight is an answer would hide recorder/reader outages from the
 *  verdict's absent list (§0 "stale evidence self-silences"). */
export const ABSENT_AFTER_HALF_LIVES = 3;

/** Score floor for conviction A: 2.0 ≈ the structural gex-walls unit (1.0) PLUS a
 *  fresh flagship wall-trend read (1.25) net of any opposition — an A requires the
 *  dealer landscape AND its lifecycle to both argue for the play, or equivalent
 *  breadth across the smaller sources. (Theoretical fresh max ≈ 5.3; realistic
 *  well-supported verdicts land 2–3.5.) Display never exceeds A — see conviction. */
export const CONVICTION_A_MIN_SCORE = 2;

/** Score floor for conviction B: 0.75 = one full mid-tier signal (an aligned flow
 *  cluster / catalyst leg) net of opposition — a real edge beyond noise, but not a
 *  structural argument. Below it the verdict is a C ("nothing here earns size"). */
export const CONVICTION_B_MIN_SCORE = 0.75;

/** NH-R9 contested floor: 0.75 = one full mid-tier signal's worth (same magnitude
 *  as CONVICTION_B_MIN_SCORE, deliberately) — below this on EITHER side is "one
 *  small source disagreeing", which is normal and not worth flagging; at or above
 *  it on BOTH sides is two real, independent arguments actively fighting. */
export const CONTESTED_MIN_MAGNITUDE = 0.75;

/** Per-source SUPPORT caps (design §0 "supporting evidence is capped per source
 *  (max +N)"). Values are each source module's own exported cap constant — the cap
 *  lives next to the weights it bounds; this table only assembles them. Opposes are
 *  not additionally capped here: each oppose weight is already a bounded named
 *  constant at emission, and the design's asymmetry deliberately lets negative
 *  evidence accumulate (one loud bearish fact can kill an entry — §0). */
export const SOURCE_SUPPORT_CAPS: Record<CortexSourceId, number> = {
  "gex-walls": GEX_WALLS_SUPPORT_CAP,
  "wall-trend": WALL_TREND_SUPPORT_CAP,
  "flow-quality": FLOW_SUPPORT_CAP,
  "sector-heat": SECTOR_HEAT_SUPPORT_CAP,
  "catalyst-news": CATALYST_SUPPORT_CAP,
  "vex-charm": VEX_CHARM_SUPPORT_CAP,
  "darkpool-confluence": DARKPOOL_SUPPORT_CAP,
  "opening-harvest": OPENING_HARVEST_SUPPORT_CAP,
};

/**
 * NH-R11 fix: an AGGREGATE cap over the dealer-positioning family (gex-walls +
 * wall-trend + vex-charm + darkpool-confluence — types.ts CortexSourceFamily doc),
 * on top of each member's own per-source cap. 2.75 sits just above the documented
 * "flagship" two-source case (a fresh gex-walls read near its 1.0 cap plus a fresh
 * wall-trend read near its 1.5 cap ≈ 2.5 — design §0's own worked example), so a
 * legitimate structural argument from the two core dealer reads is untouched. It
 * bites only when 3+ of the family are simultaneously near their individual caps —
 * i.e. when the SAME dealer-book fact is being counted four different ways instead
 * of once. Families with no entry here (order-flow, context) are uncapped beyond
 * their existing per-source caps — flow-quality/sector-heat/catalyst-news/opening-
 * harvest each read a genuinely distinct evidentiary channel (see CORTEX_SOURCE_FAMILY).
 */
export const FAMILY_SUPPORT_CAPS: Partial<Record<CortexSourceFamily, number>> = {
  "dealer-positioning": 2.75,
};

/** The source registry, in CORTEX_SOURCES order (deterministic evidence/narrative
 *  ordering — never a weighting statement). */
const SOURCE_REGISTRY: Record<CortexSourceId, CortexSourceFn> = {
  "gex-walls": deriveGexWallsEvidence,
  "wall-trend": deriveWallTrendEvidence,
  "flow-quality": deriveFlowQualityEvidence,
  "sector-heat": deriveSectorHeatEvidence,
  "catalyst-news": deriveCatalystNewsEvidence,
  "vex-charm": deriveVexCharmEvidence,
  "darkpool-confluence": deriveDarkPoolConfluenceEvidence,
  "opening-harvest": deriveOpeningHarvestEvidence,
};

/** Exponential half-life decay factor. Exported for the decay unit tests. */
export function cortexDecayFactor(ageSec: number, halfLifeSec: number): number {
  if (!(halfLifeSec > 0)) return 1; // undecayable evidence (defensive; sources always set > 0)
  return 2 ** (-Math.max(0, ageSec) / halfLifeSec);
}

function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/** Signed score rendering for the narrative header ("+1.85" / "-0.6" / "0"). */
function fmtSigned(v: number): string {
  if (v > 0) return `+${v}`;
  return `${v}`;
}

export function composeCortexEvidence(input: CortexInputs): CortexVerdict {
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) {
    // A snapshot without a valid clock cannot be composed deterministically —
    // programmer error at the call site, never a silent "now = Date.now()" rescue.
    throw new TypeError(`composeCortexEvidence: invalid input.now "${input.now}"`);
  }

  const vetoes: EvidenceItem[] = [];
  const supports: EvidenceItem[] = [];
  const opposes: EvidenceItem[] = [];
  const absent: string[] = [];

  for (const source of CORTEX_SOURCES) {
    const items = SOURCE_REGISTRY[source](input);
    if (items.length === 0) {
      // Defensive: a source must always disclose — an empty return is an absence.
      absent.push(`${source}: no evidence emitted`);
      continue;
    }
    for (const item of items) {
      if (item.stance === "absent") {
        absent.push(`${source}: ${item.detail}`);
        continue;
      }
      const asOfMs = Date.parse(item.asOf);
      if (!Number.isFinite(asOfMs)) {
        // Unstamped evidence cannot decay honestly → it cannot participate (§0:
        // the composite is recomputed from live asOf stamps, never from trust).
        absent.push(`${source}: evidence had no valid asOf stamp`);
        continue;
      }
      const ageSec = Math.max(0, (nowMs - asOfMs) / 1000);
      if (ageSec > item.halfLifeSec * ABSENT_AFTER_HALF_LIVES) {
        absent.push(`${source}: evidence stale (older than ${ABSENT_AFTER_HALF_LIVES} half-lives) — self-silenced`);
        continue;
      }
      const effective = round(item.weight * cortexDecayFactor(ageSec, item.halfLifeSec), 3);
      const decayed: EvidenceItem = { ...item, weight: effective };
      if (item.stance === "veto") vetoes.push(decayed);
      else if (item.stance === "supports") supports.push(decayed);
      else opposes.push(decayed);
    }
  }

  // Per-source support caps (§0): if one source's decayed supports sum past its
  // cap, scale them proportionally so the table still shows every item, honestly
  // re-weighted, rather than silently dropping the overflow.
  const supportSumBySource = new Map<CortexSourceId, number>();
  for (const s of supports) {
    supportSumBySource.set(s.source, (supportSumBySource.get(s.source) ?? 0) + s.weight);
  }
  for (const [source, sum] of supportSumBySource) {
    const cap = SOURCE_SUPPORT_CAPS[source];
    if (sum > cap && sum > 0) {
      const scale = cap / sum;
      for (const s of supports) {
        if (s.source === source) s.weight = round(s.weight * scale, 3);
      }
    }
  }

  // Family caps (NH-R11, §0 above SOURCE_SUPPORT_CAPS): applied AFTER per-source
  // capping, on top of it — a second, coarser ceiling over the already-capped
  // per-source contributions so correlated sources in the same family can't stack
  // past what one dealer-book fact is worth in aggregate.
  const supportSumByFamily = new Map<CortexSourceFamily, number>();
  for (const s of supports) {
    const family = CORTEX_SOURCE_FAMILY[s.source];
    supportSumByFamily.set(family, (supportSumByFamily.get(family) ?? 0) + s.weight);
  }
  for (const [family, sum] of supportSumByFamily) {
    const cap = FAMILY_SUPPORT_CAPS[family];
    if (cap != null && sum > cap && sum > 0) {
      const scale = cap / sum;
      for (const s of supports) {
        if (CORTEX_SOURCE_FAMILY[s.source] === family) s.weight = round(s.weight * scale, 3);
      }
    }
  }

  const supportTotal = supports.reduce((acc, s) => acc + s.weight, 0);
  const opposeTotal = opposes.reduce((acc, o) => acc + o.weight, 0);
  const score = round(supportTotal - opposeTotal, 2);

  // NH-R9: a genuine internal disagreement — both sides material — reads
  // differently from a quiet composite even when they happen to net near zero
  // (see CortexVerdict.contested doc). Computed on the RAW (pre-round) totals so
  // the flag isn't sensitive to the score's own 2dp display rounding.
  const contested = supportTotal >= CONTESTED_MIN_MAGNITUDE && opposeTotal >= CONTESTED_MIN_MAGNITUDE;

  // Conviction banding. A vetoed play wears a C no matter its score — a band is a
  // sizing statement and a blocked play must never read as size-worthy. Display is
  // capped at A while the A+ inversion stands (NIGHTHAWK-0DTE-DECISION.md C-1).
  let conviction: CortexConviction;
  if (vetoes.length > 0) conviction = "C";
  else if (score >= CONVICTION_A_MIN_SCORE) conviction = "A";
  else if (score >= CONVICTION_B_MIN_SCORE) conviction = "B";
  else conviction = "C";

  // Catalyst-confirmed flow upgrades conviction one band (design §1 BIE) — the only
  // support catalyst-news emits IS that upgrade signal. Never past A (C-1), never on
  // a vetoed play (a block is a block).
  const catalystConfirmed = supports.some((s) => s.source === "catalyst-news" && s.weight > 0);
  if (catalystConfirmed && vetoes.length === 0) {
    conviction = conviction === "C" ? "B" : "A";
  }

  // ---------------------------------------------------------------------------
  // Narrative — deterministic member-facing "why" lines. Every numeric token comes
  // from the evidence details (whose numbers trace to inputs — guarded by
  // narrative.guard.test.ts) or from the computed score/weights themselves.
  // ---------------------------------------------------------------------------
  const narrative: string[] = [];
  narrative.push(
    `CORTEX ${input.ticker} ${input.direction}: ` +
      (vetoes.length > 0
        ? `BLOCKED by ${vetoes.length} veto${vetoes.length === 1 ? "" : "es"} (net score ${fmtSigned(score)})`
        : `net score ${fmtSigned(score)}`) +
      `, conviction ${conviction}.`
  );
  if (contested) {
    narrative.push(
      `CONTESTED: +${round(supportTotal, 2)} support vs -${round(opposeTotal, 2)} oppose are both material — ` +
        "sources genuinely disagree, not merely quiet."
    );
  }
  for (const v of vetoes) narrative.push(`VETO [${v.source}] ${v.detail}`);
  for (const s of supports) narrative.push(`+${s.weight} [${s.source}] ${s.detail}`);
  for (const o of opposes) narrative.push(`-${o.weight} [${o.source}] ${o.detail}`);
  for (const a of absent) narrative.push(`ABSENT [${a.split(":")[0]}] ${a.slice(a.indexOf(":") + 1).trim()}`);

  return {
    ticker: input.ticker,
    direction: input.direction,
    asOf: new Date(nowMs).toISOString(),
    vetoes,
    score,
    supports,
    opposes,
    absent,
    contested,
    conviction,
    narrative,
  };
}
