/**
 * SPX play quality flags for RTH four-engine audits.
 * Cross-replica lock contention returns degradedPlayPayload() (assessed:false,
 * available:false) while a peer evaluates — that is AMBER warming, not RED defect.
 */

/**
 * @param {Record<string, unknown> | null | undefined} play
 * @returns {{ code: string, severity: string, detail: string } | null}
 */
export function spxDegradedFlag(play) {
  if (!play?.degraded) return null;
  if (play.assessed === false && play.available === false) {
    return {
      code: "WARMING",
      severity: "AMBER",
      detail: "Desk warming — play eval in flight",
    };
  }
  return {
    code: "DEGRADED",
    severity: "RED",
    detail: "Degraded play payload",
  };
}
