/**
 * SPX desk vs Polygon oracle — same RTH/off-hours convention as data-validator.mjs:
 * live index snapshot during RTH, prior daily close off-hours; percent tolerance not raw points.
 */

/** @returns {{ verdict: "pass" | "fail" | "skip"; pct?: number; tolPct?: number; rth?: boolean; groundTruth?: string }} */
export function spxOracleVerdict(deskSpx, oracle, opts = false) {
  const desk = Number(deskSpx);
  const gt = Number(oracle);
  if (!(desk > 0 && gt > 0)) return { verdict: "skip" };
  const normalized =
    typeof opts === "boolean"
      ? { rth: opts, groundTruth: opts ? "live" : "prev-close" }
      : { rth: Boolean(opts.rth), groundTruth: opts.groundTruth ?? (opts.rth ? "live" : "prev-close") };
  const pct = (Math.abs(gt - desk) / gt) * 100;
  const tolPct =
    normalized.rth || normalized.groundTruth === "live" || normalized.groundTruth === "session-close"
      ? 0.3
      : 1.5;
  return {
    verdict: pct <= tolPct ? "pass" : "fail",
    pct,
    tolPct,
    rth: normalized.rth,
    groundTruth: normalized.groundTruth,
  };
}
