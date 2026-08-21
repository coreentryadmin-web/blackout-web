/**
 * Does a bead row's REAL data survive the swell mapping, or is it flattened before it reaches pixels?
 *
 * Member report (2026-08-19), SPY 765 put wall: "how could this actually be true .. I can imagine at
 * the start of the day the node was strong, so it painted big and contrast, but it got continued
 * throughout the day which is absolutely false right?"
 *
 * Two independent questions hide inside that, and only measurement separates them:
 *   1. Did the wall really persist all session? (data question — recorder side)
 *   2. If it did, does its real variation reach the screen? (paint question — renderer side)
 *
 * So this reads the SAME per-bucket series the client renders from, then runs the REAL production
 * `rowPeakRefs`/`rowSwellMul` over it — imported, never reimplemented, so the numbers are the ones
 * the chart actually uses — and converts the resulting multipliers into DRAWN PIXELS at realistic
 * peak half-heights. A swell span that lands under ~1px is a bar the eye reads as uniform no matter
 * how much the underlying wall moved.
 *
 * Read-only. ONE temp Clerk user, deleted in a `finally`. Never prints secrets.
 *
 * Run from the REPO ROOT:
 *   NODE_USE_ENV_PROXY=1 node --import tsx scripts/audit/vector-row-swell-probe.mts \
 *     [--ticker=SPY] [--session=YYYY-MM-DD] [--strike=765] [--side=put|call] [--json]
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { rowPeakRefs, rowSwellMul } from "../../src/features/vector/lib/vector-wall-rail-core";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const argv = process.argv.slice(2);
const arg = (n: string, d: string) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const TICKER = arg("ticker", "SPY").toUpperCase();
const SESSION = arg("session", "");
const STRIKE = Number(arg("strike", "0"));
const SIDE = arg("side", "put") === "call" ? "callWalls" : "putWalls";
const JSON_OUT = argv.includes("--json");

/** Realistic peak half-heights at ordinary desk zooms — the clamp keeps beads inside a bar. */
const PEAK_HALF_PX = [2.0, 2.5, 3.0, 4.0];

type Wall = { strike: number; pct: number; notional: number };
type Snap = { time: number; modeled?: boolean; walls?: { putWalls?: Wall[]; callWalls?: Wall[] } };

const quantile = (sorted: number[], f: number) => sorted[Math.floor(f * (sorted.length - 1))]!;

const session = await mintClerkPremiumSession({ appUrl: BASE });
try {
  if (!SESSION) throw new Error("--session=YYYY-MM-DD is required (the chart owns the displayed session)");
  const url = `${BASE}/api/market/vector/wall-history?ticker=${encodeURIComponent(TICKER)}&horizon=all&session=${encodeURIComponent(SESSION)}`;
  const res = await fetch(url, { headers: { Cookie: session.cookieHeader } });
  if (!res.ok) throw new Error(`wall-history ${res.status}`);
  const body = (await res.json()) as { history?: Snap[] };
  const history = body.history ?? [];
  if (!history.length) throw new Error("empty history — wrong session date?");

  // Pick the strike to study: the caller's, else the row with the highest median share, which is
  // the one a member is most likely to be pointing at when they say "that bar never changes".
  let strike = STRIKE;
  if (!strike) {
    const medians = new Map<number, number[]>();
    for (const s of history) for (const w of s.walls?.[SIDE] ?? []) {
      if (!medians.has(w.strike)) medians.set(w.strike, []);
      medians.get(w.strike)!.push(w.pct);
    }
    let best = 0, bestMed = -1;
    for (const [k, v] of medians) {
      v.sort((a, b) => a - b);
      const med = v[Math.floor(v.length / 2)]!;
      if (v.length > history.length * 0.5 && med > bestMed) { bestMed = med; best = k; }
    }
    strike = best;
  }

  const pts = history.map((s) => ({
    time: s.time,
    modeled: !!s.modeled,
    pct: s.walls?.[SIDE]?.find((w) => w.strike === strike)?.pct ?? 0,
  }));
  const present = pts.filter((p) => p.pct > 0);

  // The REAL production mapping, not a copy of it.
  const peaks = rowPeakRefs(pts);
  const swells = pts.map((p, i) => rowSwellMul(p.pct, peaks[i]!));
  const sortedSwell = [...swells].sort((a, b) => a - b);
  const pcts = present.map((p) => p.pct).sort((a, b) => a - b);

  const out = {
    ticker: TICKER,
    session: SESSION,
    side: SIDE,
    strike,
    snapshots: history.length,
    modeled: history.filter((s) => s.modeled).length,
    presentIn: present.length,
    pct: { min: pcts[0], median: quantile(pcts, 0.5), max: pcts[pcts.length - 1]!, ratio: pcts[pcts.length - 1]! / pcts[0]! },
    swell: {
      min: quantile(sortedSwell, 0),
      p10: quantile(sortedSwell, 0.1),
      p50: quantile(sortedSwell, 0.5),
      p90: quantile(sortedSwell, 0.9),
      max: quantile(sortedSwell, 1),
    },
    drawnPx: PEAK_HALF_PX.map((half) => ({
      peakHalfPx: half,
      p10Px: quantile(sortedSwell, 0.1) * half,
      p90Px: quantile(sortedSwell, 0.9) * half,
      deltaPx: (quantile(sortedSwell, 0.9) - quantile(sortedSwell, 0.1)) * half,
    })),
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`${TICKER} ${strike} ${SIDE === "putWalls" ? "put" : "call"} wall — ${SESSION}`);
    console.log(`snapshots ${out.snapshots} (${out.modeled} modeled), strike present in ${out.presentIn}`);
    console.log(`pct    min ${out.pct.min!.toFixed(2)}  median ${out.pct.median!.toFixed(2)}  max ${out.pct.max.toFixed(2)}  (${out.pct.ratio.toFixed(2)}x)`);
    console.log(`swell  min ${out.swell.min!.toFixed(3)}  p10 ${out.swell.p10!.toFixed(3)}  p50 ${out.swell.p50!.toFixed(3)}  p90 ${out.swell.p90!.toFixed(3)}  max ${out.swell.max!.toFixed(3)}`);
    console.log("");
    console.log("peak half-height   p10..p90 drawn      delta");
    for (const d of out.drawnPx) {
      const flag = d.deltaPx < 1 ? "   <- under 1px: reads as a uniform bar" : "";
      console.log(`  ${d.peakHalfPx.toFixed(1)}px            ${d.p10Px.toFixed(2)}..${d.p90Px.toFixed(2)}px        ${d.deltaPx.toFixed(2)}px${flag}`);
    }
  }
} finally {
  await session.cleanup();
  console.error("temp Clerk user deleted");
}
