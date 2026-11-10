/** Upstream throttle — a cold matrix during an open circuit is not a desk numeric bug. */
export function shouldSkipGexColdDuringRth(integrityIssueWouldFire: boolean, circuitOpen: boolean): boolean {
  return integrityIssueWouldFire && circuitOpen;
}
