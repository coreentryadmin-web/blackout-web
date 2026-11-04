/**
 * SPX desk vs Polygon oracle — same RTH/off-hours convention as data-validator.mjs:
 * live index snapshot during RTH; when Polygon reports closed, prefer the index snapshot's
 * session close (desk still shows today's session level right after the bell — /prev is
 * yesterday and false-fails on any >1.5% day); fall back to prior daily close overnight.
 */

/** @typedef {{ value?: number; session?: { close?: number } }} PolygonIndexRow */

/**
 * @param {{ rth: boolean; indexRow?: PolygonIndexRow | null; prevClose?: number | null }} input
 * @returns {{ oracle: number | null; gtLabel: string; rth: boolean }}
 */
export function spxPolygonGroundTruth({ rth, indexRow, prevClose }) {
  if (rth) {
    const oracle = num(indexRow?.value) ?? num(indexRow?.session?.close);
    return { oracle, gtLabel: "live", rth: true };
  }
  const sessionClose = num(indexRow?.session?.close) ?? num(indexRow?.value);
  if (sessionClose != null) {
    return { oracle: sessionClose, gtLabel: "session-close", rth: false };
  }
  return { oracle: num(prevClose), gtLabel: "prev-close", rth: false };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
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
