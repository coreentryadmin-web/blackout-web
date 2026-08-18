/**
 * Scan-budget rule for the per-OCC option-trades fan-out.
 *
 * Split out of `option-trades.ts` purely so it is TESTABLE: that module carries `server-only`,
 * which throws the moment a test imports it. Same convention as `gex-intraday-adjust-core.ts`.
 */

/**
 * Should the per-contract scan stop before starting the NEXT contract?
 *
 * Pure and exported so the one rule that decides between "some prints" and "no prints" is testable
 * without a network, a clock or a rate limiter. Two invariants it encodes:
 *   - the FIRST contract always runs, whatever the budget — a deadline that returns zero contracts
 *     is just the caller's empty-timeout failure moved one layer down; and
 *   - an unusable budget (NaN, negative) must not stop the scan, or a bad env value would silently
 *     reduce every result to a single contract.
 */
export function shouldStopContractScan(
  contractsScanned: number,
  elapsedMs: number,
  budgetMs: number
): boolean {
  if (contractsScanned <= 0) return false;
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) return false;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return false;
  return elapsedMs >= budgetMs;
}
