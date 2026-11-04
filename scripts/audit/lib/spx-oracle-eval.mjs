/**
 * SPX desk vs Polygon oracle — same RTH/off-hours convention as data-validator.mjs:
 * live index snapshot during RTH, prior daily close off-hours; percent tolerance not raw points.
 */

import { inRthOpenWindow } from "../../gha-et-window.mjs";

/**
 * Whether to compare desk spot to Polygon's live index snapshot (true) or prior close (false).
 * When Polygon marketstatus is missing or disagrees with the ET cash window, prefer the ET gate
 * so a failed status fetch never compares a live desk to yesterday's close mid-session.
 */
export function resolveSpxOracleRth(marketStatusPayload, now = new Date()) {
  const etOpen = inRthOpenWindow(now);
  if (marketStatusPayload?.market === "open") return true;
  if (marketStatusPayload?.market === "closed" && !etOpen) return false;
  return etOpen;
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
