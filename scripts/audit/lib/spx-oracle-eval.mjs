/**
 * SPX desk vs Polygon oracle — same RTH/off-hours convention as data-validator.mjs:
 * live index snapshot during RTH; after the bell prefer snapshot session close (desk still
 * carries today's last print while /prev lags one session); prior daily close only when
 * snapshot has no usable print (overnight / missing feed).
 */

/**
 * @param {number} deskSpx
 * @param {number} oracle
 * @param {boolean | { rth?: boolean; groundTruth?: "live" | "session-close" | "prev-close" }} options
 * @returns {{ verdict: "pass" | "fail" | "skip"; pct?: number; tolPct?: number; rth?: boolean; groundTruth?: string }}
 */
export function spxOracleVerdict(deskSpx, oracle, options = false) {
  const desk = Number(deskSpx);
  const gt = Number(oracle);
  if (!(desk > 0 && gt > 0)) return { verdict: "skip" };

  let rth = false;
  let groundTruth = "prev-close";
  if (typeof options === "boolean") {
    rth = options;
    groundTruth = rth ? "live" : "prev-close";
  } else {
    rth = Boolean(options.rth);
    groundTruth = options.groundTruth ?? (rth ? "live" : "prev-close");
  }

  const pct = (Math.abs(gt - desk) / gt) * 100;
  const tolPct = groundTruth === "prev-close" ? 1.5 : 0.3;
  return {
    verdict: pct <= tolPct ? "pass" : "fail",
    pct,
    tolPct,
    rth,
    groundTruth,
  };
}
