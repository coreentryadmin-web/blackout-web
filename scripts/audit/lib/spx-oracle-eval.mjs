/**
 * SPX desk vs Polygon oracle — live index snapshot during RTH; off-hours prefer the
 * indices snapshot's session close (desk still carries today's last print after the
 * bell — comparing to /prev is yesterday's bar and false-fails on any |day move| > tol).
 */

/** Prefer session close off-hours; fall back to prior daily bar when snapshot has no session. */
export function pickOffHoursSpxOracleGroundTruth(sessionClose, prevClose) {
  const session = Number(sessionClose);
  const prev = Number(prevClose);
  if (session > 0) return { oracle: session, label: "session-close" };
  if (prev > 0) return { oracle: prev, label: "prev-close" };
  return { oracle: null, label: "" };
}

/** @returns {{ verdict: "pass" | "fail" | "skip"; pct?: number; tolPct?: number; rth?: boolean }} */
export function spxOracleVerdict(deskSpx, oracle, rth) {
  const desk = Number(deskSpx);
  const gt = Number(oracle);
  if (!(desk > 0 && gt > 0)) return { verdict: "skip" };
  const pct = (Math.abs(gt - desk) / gt) * 100;
  const tolPct = rth ? 0.3 : 1.5;
  return {
    verdict: pct <= tolPct ? "pass" : "fail",
    pct,
    tolPct,
    rth: Boolean(rth),
  };
}
