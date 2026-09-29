/**
 * Pure helpers for `swing-regime-gate-recall-probe.mjs` — see that script's header for the full WHY.
 * Deliberately network/DB-free so the move/bucket math is unit-testable in isolation and never
 * silently reimplemented/drifted inside the live harness itself.
 */

/**
 * Sign-aligned % price move, "bull"/"bear" vocabulary (the FLOW accumulation engine's own
 * `direction` field, shared by 0DTE/Swing/Vector/Helix) — a "bear" candidate's favorable move is a
 * PRICE DECLINE, so its raw pct is sign-flipped. Never fabricates a result from missing/invalid
 * prices — returns null instead, same discipline as every other sign-aligned helper in this
 * toolkit (`gradeForgoneMove`, `signAlignedMovePct`).
 */
export function signAlignedMovePctBullBear({ fromPrice, toPrice, direction }) {
  if (
    fromPrice == null || !Number.isFinite(fromPrice) || fromPrice <= 0 ||
    toPrice == null || !Number.isFinite(toPrice) || toPrice <= 0
  ) {
    return null;
  }
  const rawPct = ((toPrice - fromPrice) / fromPrice) * 100;
  return direction === "bear" ? -rawPct : rawPct;
}

/**
 * Classify a graded candidate's forward move as favorable (cleared the threshold, sign-aligned) or
 * not. Returns null (never a fabricated boolean) when `movePct` itself is null — i.e. the position
 * couldn't be priced at either end.
 */
export function classifyForwardOutcome({ movePct, favThresholdPct }) {
  if (movePct == null || !Number.isFinite(movePct)) return null;
  return movePct >= favThresholdPct ? "favorable" : "unfavorable";
}

/**
 * Summarize one group of graded candidates: population, favorable count/rate, mean sign-aligned
 * move. Rows with a null `movePct` are excluded from the n (a candidate this harness could not
 * price at either end is not evidence either way) — the caller is expected to report the excluded
 * count separately rather than let it silently vanish.
 */
export function summarizeGroup(rows) {
  const usable = rows.filter((r) => r.movePct != null && Number.isFinite(r.movePct));
  if (usable.length === 0) {
    return { n: 0, favorableCount: 0, favorablePct: null, meanMovePct: null };
  }
  const favorableCount = usable.filter((r) => r.outcome === "favorable").length;
  const meanMovePct = usable.reduce((s, r) => s + r.movePct, 0) / usable.length;
  return {
    n: usable.length,
    favorableCount,
    favorablePct: (100 * favorableCount) / usable.length,
    meanMovePct,
  };
}

/**
 * The core comparison this probe exists to make: split graded candidates by whether the REAL
 * `evaluateRegimeGate` (v2/gates.ts) would have BLOCKED them (pass=false — RISK_OFF or UNKNOWN
 * band) vs let them CLEAR (pass=true — NEUTRAL or RISK_ON), then summarize each side's forward
 * outcome. A gate genuinely separating good from bad setups should show BLOCKED grading materially
 * worse (lower favorable rate / more negative mean move) than CLEAR; if the two summaries land
 * close together, the gate is splitting an ARBITRARY half rather than the genuinely-bad one — the
 * exact question this tool was built to answer (never assumed from the gate's own design intent).
 */
export function compareRegimeGateGroups(rows) {
  const blockedRows = rows.filter((r) => r.gatePass === false);
  const clearRows = rows.filter((r) => r.gatePass === true);
  const blocked = summarizeGroup(blockedRows);
  const clear = summarizeGroup(clearRows);
  const deltaFavorablePp =
    blocked.favorablePct != null && clear.favorablePct != null ? blocked.favorablePct - clear.favorablePct : null;
  const deltaMeanMovePct =
    blocked.meanMovePct != null && clear.meanMovePct != null ? blocked.meanMovePct - clear.meanMovePct : null;
  return { blocked, clear, deltaFavorablePp, deltaMeanMovePct };
}
