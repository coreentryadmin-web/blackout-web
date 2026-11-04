/**
 * Polygon ground truth for SPX desk oracle checks.
 * RTH mode follows GitHub Actions `inRthOpenWindow()` (09:00–16:15 ET), not Polygon
 * `marketstatus` alone — after 16:00 ET regular session is closed but the deep audit
 * still runs with live desk prices until 16:15.
 */
import { inRthOpenWindow, todayEtYmd } from "../../gha-et-window.mjs";

/**
 * @param {{ polyBase: string; polyKey: string; now?: Date }} opts
 * @returns {Promise<{ oracle: number | null; gtLabel: string; rth: boolean }>}
 */
export async function fetchSpxPolygonOracle({ polyBase, polyKey, now = new Date() }) {
  const base = polyBase.replace(/\/$/, "");
  const rth = inRthOpenWindow(now);

  if (rth) {
    const polyRes = await fetch(`${base}/v3/snapshot/indices?ticker.any_of=I:SPX&apiKey=${polyKey}`);
    if (!polyRes.ok) return { oracle: null, gtLabel: "live", rth: true };
    const poly = await polyRes.json();
    const row = (poly.results ?? []).find((r) => r.ticker === "I:SPX");
    const oracle = Number(row?.value ?? row?.session?.close);
    return { oracle: oracle > 0 ? oracle : null, gtLabel: "live", rth: true };
  }

  const ymd = todayEtYmd(now);
  const dayRes = await fetch(
    `${base}/v2/aggs/ticker/I:SPX/range/1/day/${ymd}/${ymd}?adjusted=true&apiKey=${polyKey}`
  );
  if (dayRes.ok) {
    const day = await dayRes.json();
    const c = Number(day?.results?.[0]?.c);
    if (c > 0) return { oracle: c, gtLabel: "today-close", rth: false };
  }

  const prevRes = await fetch(`${base}/v2/aggs/ticker/I:SPX/prev?apiKey=${polyKey}`);
  if (prevRes.ok) {
    const prev = await prevRes.json();
    const c = Number(prev?.results?.[0]?.c);
    if (c > 0) return { oracle: c, gtLabel: "prev-close", rth: false };
  }

  return { oracle: null, gtLabel: "prev-close", rth: false };
}
