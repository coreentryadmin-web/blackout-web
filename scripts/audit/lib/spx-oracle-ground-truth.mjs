/**
 * Which Polygon SPX reference to use for desk oracle checks (full-site-deep-audit).
 *
 * `/prev` is the PRIOR session's daily bar — after today's cash close the desk correctly
 * shows TODAY's settle, so comparing to `/prev` false-fails on any session with >1.5% move
 * (RTH deep audit 2026-11-04: desk 7683 vs prev 7568).
 */
import { todayEtYmd, isTradingDayEt, etParts } from "../../gha-et-window.mjs";

/** @returns {"live" | "today-close" | "prev-close"} */
export function spxOracleGroundTruthPlan({ rth, now = new Date() }) {
  if (rth) return "live";
  const today = todayEtYmd(now);
  if (isTradingDayEt(today) && etParts(now).mins >= 16 * 60) return "today-close";
  return "prev-close";
}

/**
 * @param {{ polyBase: string; polyKey: string; rth: boolean; now?: Date; fetchFn?: typeof fetch }}
 * @returns {Promise<{ value: number | null; label: string }>}
 */
export async function resolvePolygonSpxOracleGroundTruth({
  polyBase,
  polyKey,
  rth,
  now = new Date(),
  fetchFn = fetch,
}) {
  const base = polyBase.replace(/\/$/, "");
  const plan = spxOracleGroundTruthPlan({ rth, now });

  if (plan === "live") {
    const polyRes = await fetchFn(`${base}/v3/snapshot/indices?ticker.any_of=I:SPX&apiKey=${polyKey}`);
    if (polyRes.ok) {
      const poly = await polyRes.json();
      const row = (poly.results ?? []).find((r) => r.ticker === "I:SPX");
      const value = row?.value ?? row?.session?.close ?? null;
      if (value != null && Number(value) > 0) return { value: Number(value), label: "live" };
    }
    return { value: null, label: "live" };
  }

  if (plan === "today-close") {
    const today = todayEtYmd(now);
    const dayRes = await fetchFn(
      `${base}/v2/aggs/ticker/I:SPX/range/1/day/${today}/${today}?adjusted=true&apiKey=${polyKey}`
    );
    if (dayRes.ok) {
      const day = await dayRes.json();
      const c = day?.results?.[0]?.c;
      if (c != null && Number(c) > 0) return { value: Number(c), label: "today-close" };
    }
    const snapRes = await fetchFn(`${base}/v3/snapshot/indices?ticker.any_of=I:SPX&apiKey=${polyKey}`);
    if (snapRes.ok) {
      const poly = await snapRes.json();
      const row = (poly.results ?? []).find((r) => r.ticker === "I:SPX");
      const value = row?.session?.close ?? row?.value ?? null;
      if (value != null && Number(value) > 0) return { value: Number(value), label: "today-close" };
    }
    return { value: null, label: "today-close" };
  }

  const prevRes = await fetchFn(`${base}/v2/aggs/ticker/I:SPX/prev?apiKey=${polyKey}`);
  if (prevRes.ok) {
    const prev = await prevRes.json();
    const c = prev?.results?.[0]?.c;
    if (c != null && Number(c) > 0) return { value: Number(c), label: "prev-close" };
  }
  return { value: null, label: "prev-close" };
}
