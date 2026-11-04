/**
 * SPX desk vs Polygon oracle — same RTH/off-hours convention as data-validator.mjs:
 * live index snapshot during RTH; off-hours prior close overnight/pre-open, **today's session
 * close** after the 4 PM ET bell (/prev still points at the prior session until the next day).
 */

import { etParts, isTradingDayEt, todayEtYmd } from "../../gha-et-window.mjs";

/** After RTH close on a trading day, members still see today's index — not yesterday's /prev. */
export function offHoursUsesSessionClose(now = new Date()) {
  const ymd = todayEtYmd(now);
  if (!isTradingDayEt(ymd)) return false;
  return etParts(now).mins >= 16 * 60;
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
