/**
 * A/B the bead swell NORMALIZER against a real session.
 *
 * Member report (2026-08-19), SPX: "a strong bead which was strong gets continued throughout the
 * day .. when it weakens, it has to paint small beads .. but it is not doing that .. and because of
 * this, the other levels' beads point-in-time do not show strength like big and contrast."
 *
 * That is two separate complaints and they have two separate causes, both in the denominator:
 *
 *   1. WITHIN a row, `rowPeakRefs` is a RUNNING peak — each bucket is compared to the highest that
 *      wall has been SO FAR. A wall that builds gradually is therefore always near its own running
 *      max, so t stays ~1 and it paints at full swell all session by construction. The contrast
 *      only appears AFTER a spike, and only for the buckets that follow it.
 *
 *   2. ACROSS rows, every row is normalized to ITSELF. A 25%-of-book wall and a 2%-of-book wall
 *      both reach t = 1 on their own rows, so they paint the same size. There is no cross-row
 *      contrast available at all — which is precisely the second half of the report.
 *
 * This measures the shipped mapping against two candidates on the SAME real data, and reports the
 * resulting size distribution per row plus the cross-row separation between a dominant wall and a
 * weak one. No opinion is encoded — it prints what each denominator does.
 *
 *   SHIPPED   t = pct / runningPeak(row)
 *   ROW-MAX   t = pct / sessionPeak(row)        fixes (1), leaves (2)
 *   BOOK-MAX  t = pct / sessionPeak(all rows)   fixes (1) and (2) with one shared denominator
 *
 * Read-only. ONE temp Clerk user, deleted in a `finally`. Never prints secrets.
 *
 * Run from the REPO ROOT:
 *   NODE_USE_ENV_PROXY=1 node --import tsx scripts/audit/vector-swell-normalization-ab.mts \
 *     --ticker=SPX --session=YYYY-MM-DD [--side=put|call] [--rows=6] [--json]
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import {
  rowPeakRefs,
  rowSwellMul,
  BOOK_SWELL_FLOOR,
  BOOK_SWELL_EXP,
} from "../../src/features/vector/lib/vector-wall-rail-core";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const argv = process.argv.slice(2);
const arg = (n: string, d: string) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const TICKER = arg("ticker", "SPX").toUpperCase();
const SESSION = arg("session", "");
const SIDE = arg("side", "put") === "call" ? "callWalls" : "putWalls";
const ROWS = Number(arg("rows", "6"));
const JSON_OUT = argv.includes("--json");

type Wall = { strike: number; pct: number };
type Snap = { time: number; walls?: { putWalls?: Wall[]; callWalls?: Wall[] } };

const q = (sorted: number[], f: number) => sorted[Math.floor(f * (sorted.length - 1))]!;

const session = await mintClerkPremiumSession({ appUrl: BASE });
try {
  if (!SESSION) throw new Error("--session=YYYY-MM-DD is required");
  const res = await fetch(
    `${BASE}/api/market/vector/wall-history?ticker=${encodeURIComponent(TICKER)}&horizon=all&session=${encodeURIComponent(SESSION)}`,
    { headers: { Cookie: session.cookieHeader } }
  );
  if (!res.ok) throw new Error(`wall-history ${res.status}`);
  const history = ((await res.json()) as { history?: Snap[] }).history ?? [];
  if (!history.length) throw new Error("empty history — wrong session date?");

  // Per-strike series, aligned to the snapshot index so every row has the same length.
  const byStrike = new Map<number, number[]>();
  history.forEach((s, i) => {
    for (const w of s.walls?.[SIDE] ?? []) {
      if (!byStrike.has(w.strike)) byStrike.set(w.strike, new Array(history.length).fill(0));
      byStrike.get(w.strike)![i] = w.pct;
    }
  });

  // Study the rows a member actually sees: the strongest by session peak.
  const ranked = [...byStrike.entries()]
    .map(([strike, series]) => ({ strike, series, peak: Math.max(...series) }))
    .sort((a, b) => b.peak - a.peak)
    .slice(0, ROWS);

  // ONE shared denominator across every row — this is what creates cross-row contrast.
  const bookPeak = Math.max(...ranked.map((r) => r.peak));

  const out = ranked.map(({ strike, series, peak }) => {
    const running = rowPeakRefs(series.map((pct) => ({ pct })));
    const shipped = series.map((pct, i) => rowSwellMul(pct, running[i]!));
    const rowMax = series.map((pct) => rowSwellMul(pct, peak));
    const bookMax = series.map((pct) =>
      rowSwellMul(pct, bookPeak, { floor: BOOK_SWELL_FLOOR, exp: BOOK_SWELL_EXP })
    );
    const stat = (v: number[]) => {
      const s = [...v].sort((a, b) => a - b);
      return { p10: q(s, 0.1), p50: q(s, 0.5), p90: q(s, 0.9) };
    };
    return {
      strike,
      peakPct: peak,
      sharePct: peak / bookPeak,
      shipped: stat(shipped),
      rowMax: stat(rowMax),
      bookMax: stat(bookMax),
    };
  });

  if (JSON_OUT) {
    console.log(JSON.stringify({ ticker: TICKER, session: SESSION, side: SIDE, bookPeak, rows: out }, null, 2));
  } else {
    console.log(`${TICKER} ${SIDE === "putWalls" ? "put" : "call"} walls — ${SESSION}, ${history.length} snapshots`);
    console.log(`book peak share: ${bookPeak.toFixed(2)}%`);
    console.log("");
    console.log("                        SHIPPED (running row peak)    ROW-MAX (session row peak)    BOOK-MAX (one denominator)");
    console.log("strike   peak%   p10   p50   p90        p10   p50   p90        p10   p50   p90");
    for (const r of out) {
      const f = (s: { p10: number; p50: number; p90: number }) =>
        `${s.p10.toFixed(2)}  ${s.p50.toFixed(2)}  ${s.p90.toFixed(2)}`;
      console.log(
        `${String(r.strike).padStart(6)}  ${r.peakPct.toFixed(1).padStart(5)}   ${f(r.shipped)}       ${f(r.rowMax)}       ${f(r.bookMax)}`
      );
    }
    console.log("");
    // The one number that answers the member's second complaint directly.
    const strongest = out[0]!, weakest = out[out.length - 1]!;
    console.log(`cross-row separation, strongest (${strongest.strike}, peak ${strongest.peakPct.toFixed(1)}%) vs weakest (${weakest.strike}, peak ${weakest.peakPct.toFixed(1)}%), at each row's p50:`);
    console.log(`  SHIPPED  ${strongest.shipped.p50.toFixed(2)} vs ${weakest.shipped.p50.toFixed(2)}  -> ${(strongest.shipped.p50 / weakest.shipped.p50).toFixed(2)}x`);
    console.log(`  ROW-MAX  ${strongest.rowMax.p50.toFixed(2)} vs ${weakest.rowMax.p50.toFixed(2)}  -> ${(strongest.rowMax.p50 / weakest.rowMax.p50).toFixed(2)}x`);
    console.log(`  BOOK-MAX ${strongest.bookMax.p50.toFixed(2)} vs ${weakest.bookMax.p50.toFixed(2)}  -> ${(strongest.bookMax.p50 / weakest.bookMax.p50).toFixed(2)}x`);
  }
} finally {
  await session.cleanup();
  console.error("temp Clerk user deleted");
}
