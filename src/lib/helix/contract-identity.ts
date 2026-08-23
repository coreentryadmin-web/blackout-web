/**
 * ONE definition of "these two prints are on the SAME CONTRACT" for the HELIX lane.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────
 *
 * Three HELIX surfaces each built this key themselves, and all three quantised the strike to the
 * nearest DOLLAR (`Math.round(strike)`):
 *
 *   - `helix-strike-leaders.ts`   `countMatchingContractHits` — the "N hits in last 15 min"
 *                                 magnitude line under Top Prints.
 *   - `helix-discord-format.ts`   `contractStackHitsFromFlows` — the Repeat Hits embed timeline,
 *                                 which also produces the hit count fed to the milestone gate.
 *   - `helix-discord-milestone.ts` `helixContractKey` — the cache key holding "which milestone has
 *                                 this contract already posted".
 *
 * A whole-market equity tape has half-dollar strikes, so a dollar-quantised key merges two real,
 * separately-traded contracts. MEASURED on 5000 live prints (72h, 2026-08-23): 99 prints (2.0%)
 * carry a non-integer strike, and 3 of 1685 rounded keys each collapse two distinct contracts —
 * `INTC 92.5P`+`INTC 93P`, `INTC 91.5P`+`INTC 92P`, `QQQ 712.5C`+`QQQ 713C`, all 2026-08-21.
 *
 * The same defect points in OPPOSITE directions depending on the surface, which is why it survived:
 *   - In the UI and the embed it OVERSTATES — hits on 92.5P are counted toward 93P, so a "×4 hits
 *     on this contract" line can describe two contracts. Repeat conviction is the exact thing that
 *     line is read for.
 *   - In the milestone gate it SUPPRESSES — the two contracts share one counter, so once 92.5P has
 *     posted its 3rd-hit milestone, a genuine 3rd hit on 93P finds `lastPosted: 3` and never posts.
 *     Nothing errors and nothing is logged; the alert simply does not arrive.
 *
 * ── WHY 1/1000 OF A DOLLAR AND NOT EXACT EQUALITY ───────────────────────────────────────────────
 *
 * The dollar rounding was not arbitrary — several upstream endpoints serve unrounded floats
 * (CLAUDE.md records `7499.360000000001`), and an exact `===` on such a value would SPLIT one real
 * contract into two keys, which is the mirror-image bug. So this quantises at the precision the
 * instrument actually has: OCC encodes the strike in mills, and `occ-contract-id.ts` — one file
 * over, shipped, and correct — already uses `Math.round(strike * 1000)`. The lane therefore already
 * knew the right precision; the three call sites above simply used a coarser one.
 *
 * `buildOccContractId` itself is not reusable as a grouping key: it enforces `^[A-Z]{1,6}$` on the
 * root and maps SPX→SPXW, so any ticker it rejects would return `null` and silently group with
 * every other rejected ticker.
 */
import { normalizeFlowExpiry } from "@/lib/largo/flow-strike-stacks";

export type FlowContractIdentity = {
  ticker: string;
  strike: number | string | null | undefined;
  expiry: string | null | undefined;
  option_type: string | null | undefined;
};

/**
 * Strike quantised to mills — absorbs float noise, keeps 92.5 and 93 apart. Null if unusable.
 *
 * `Number(null)`, `Number(undefined ?? "")` and `Number("")` are all `0`, a perfectly finite
 * number, so a bare `Number.isFinite` guard would hand every strikeless row the key for a strike of
 * 0 — the exact "group unrelated rows together" failure this module exists to prevent. Non-positive
 * strikes are rejected outright, matching `buildOccContractId`'s `strike <= 0` guard.
 */
export function strikeMills(strike: number | string | null | undefined): number | null {
  if (strike == null) return null;
  if (typeof strike === "string" && strike.trim() === "") return null;
  const n = Number(strike);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000);
}

/** CALL/PUT collapsed to a single character, matching what every call site did inline. */
export function contractSide(optionType: string | null | undefined): "C" | "P" {
  return String(optionType || "").toUpperCase().startsWith("C") ? "C" : "P";
}

/**
 * Identity of a CONTRACT — deliberately NOT the identity of a print. `flowCompositeKey` in
 * `helix-flow-merge.ts` answers "is this the same PRINT" and includes the timestamp; this answers
 * "is this the same tradeable contract", which is what repeat-hit counting and the milestone gate
 * need. Keeping them separate is why neither can be widened into the other by accident.
 *
 * Returns `null` when the strike is unusable, so a caller can never group unrelated rows under a
 * shared `NaN` key.
 */
export function flowContractKey(flow: FlowContractIdentity): string | null {
  const mills = strikeMills(flow.strike);
  if (mills == null) return null;
  const ticker = String(flow.ticker || "").toUpperCase();
  // normalizeFlowExpiry, not `.slice(0, 10)`: it also folds US-format dates, so a pool that mixes
  // `2026-08-21` and `8/21/2026` groups instead of splitting.
  const expiry = normalizeFlowExpiry(String(flow.expiry || ""));
  return `${ticker}|${mills}|${expiry}|${contractSide(flow.option_type)}`;
}

/**
 * Same key, but never null — an unusable strike gets its OWN component rather than dropping the
 * row. For callers that must key SOMETHING (a cache bucket) and for which grouping every malformed
 * row together would be worse than keeping them apart. Callers that can refuse should use
 * `flowContractKey` and refuse; do not reach for this to paper over bad input.
 */
export function flowContractKeyOrUnknown(flow: FlowContractIdentity): string {
  const key = flowContractKey(flow);
  if (key != null) return key;
  const ticker = String(flow.ticker || "").toUpperCase();
  const expiry = normalizeFlowExpiry(String(flow.expiry || ""));
  return `${ticker}|nostrike|${expiry}|${contractSide(flow.option_type)}`;
}

/** True when both rows name the same contract. False when either strike is unusable. */
export function sameFlowContract(a: FlowContractIdentity, b: FlowContractIdentity): boolean {
  const ka = flowContractKey(a);
  if (ka == null) return false;
  return ka === flowContractKey(b);
}
