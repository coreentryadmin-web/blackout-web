/**
 * HELIX signal-population A/B — what did #2723 do to the two persisted signals?
 *
 * THE QUESTION. #2723 found that the index feed's print times were unreadable rather than absent,
 * and signal eligibility went 1500/5000 -> 5000/5000 in one deploy. `MARKET-OPEN-VALIDATION.md`
 * §5k calls the consequence "the risky half" and asks for before/after FIRING counts. Eligibility
 * is not firing: a print being scannable says nothing about whether it clears a threshold. This
 * harness answers the firing question by replaying BOTH real detectors over the SAME live session
 * twice — once on the population the detectors saw before the fix, once on the whole tape.
 *
 * WHAT IT FOUND, AND WHY THE RUNBOOK NEEDED CORRECTING (live prod tape, 2026-08-23, one session,
 * 363 min, 67 five-minute steps):
 *
 *   SPLIT FLOW saturates.  SPX 24 -> 67 firings of 67 steps; SPY 23 -> 65. At mid-session SPX's
 *   legs are $246,955,657 call and $186,889,748 put against a $500,000-per-leg threshold — 494x
 *   and 374x over. A signal that fires on every scan of a name carries no information about it.
 *
 *   VELOCITY moves the OTHER WAY.  Total ticker-firings 239 -> 220, and SPX 13 -> 1. §5k predicts
 *   the opposite in as many words ("expect the radars to fire on SPX/SPY for the first time ever",
 *   "a large jump is the fix working"), so a reader running it as written tomorrow sees velocity
 *   NOT firing on SPX and concludes the deploy does not carry the fix.
 *
 *   The reason is the third defect the parse was hiding, and it is member-facing. The old detectors
 *   saw 39 of SPX's 3118 prints — 1.3%. EVERY one of those 13 firings was `recent=3, prior=0,
 *   ratio=3.0`: three prints in a 15-minute window against a LITERALLY EMPTY prior window, cleared
 *   by the `max(1, prior)` floor. The same instants on the full population read `recent=34,
 *   prior=86, ratio=0.40`. SPX was never quiet-then-spiking; it was falsely spiking off a 1.3%
 *   sample, and the Velocity Radar was showing members a spike the full tape contradicts.
 *
 *   The control that makes this trustworthy: SPY (16.3% visible) KEEPS its real spike — 15:51 reads
 *   `recent=42, prior=9` on the full population and fires in both runs — while losing the
 *   artifacts, 13 -> 6. Had every firing vanished, the honest reading would have been that the
 *   replay was broken, not that the signal was.
 *
 * WHAT THIS HARNESS DOES NOT DO. It does not retune anything. `SPLIT_MIN_LEG` ($500K/leg) and the
 * velocity `max(1, prior)` floor are threshold decisions on a persisted, GRADED signal — changing
 * when a signal fires breaks continuity of the record on top of whatever it corrects — and they are
 * the coordinator's call. This measures the cost so the call can be made on numbers.
 *
 * SCOPE. ONE session. The window requested is 168h but the member tape returns a single session's
 * prints, so every number here is n=1 and the harness prints its span rather than implying more.
 *
 * READ-ONLY against production. One temp Clerk user, deleted in a `finally`. Never prints a secret.
 *
 * Usage (Node 20, from the repo root):
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *     node --import tsx scripts/audit/helix-signal-population-ab.mjs [--step=5] [--limit=5000]
 *                                                 [--focus=SPX,SPY] [--base=URL] [--json]
 */
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { writerGroup } from "./lib/helix-tape-inventory-eval.mjs";
import {
  printedBy,
  visibleShare,
  compareRuns,
  saturationVerdict,
} from "./lib/helix-signal-population-ab-eval.mjs";

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const flag = (n) => argv.includes(`--${n}`);

const BASE = arg("base", process.env.VALIDATE_BASE ?? "https://blackouttrades.com");
const LIMIT = Number(arg("limit", 5000));
const SINCE_HOURS = Number(arg("since-hours", 168));
const STEP_MS = Number(arg("step", 5)) * 60 * 1000;
const FOCUS = arg("focus", "SPX,SPY").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
const AS_JSON = flag("json");

const session = await mintClerkPremiumSession({ appUrl: BASE });
if (session.skip) {
  // SKIP, not FAIL — a missing credential is not a product verdict.
  console.log(`SKIP: ${session.reason}`);
  process.exit(0);
}

try {
  // The REAL detectors and the REAL time helper. A harness that reimplements either measures a
  // product nobody ships — the same rule this toolkit applies to executionRouteKey.
  const SRC = new URL("../../src/", import.meta.url).pathname;
  const { detectVelocitySpikes, detectSplitFlow, signalEligible } = await import(
    `${SRC}features/helix/lib/helix-signal-detection.ts`
  );
  const { flowEventTimeMs } = await import(`${SRC}lib/flow-timestamp.ts`);

  const qs = new URLSearchParams({ limit: String(LIMIT), since_hours: String(SINCE_HOURS) });
  const res = await fetch(`${BASE}/api/market/flows?${qs}`, { headers: { Cookie: session.cookieHeader } });
  if (!res.ok) {
    console.error(`FAIL: GET /api/market/flows -> HTTP ${res.status}`);
    process.exit(1);
  }
  const flows = ((await res.json()).flows ?? []).filter((f) => f && f.ticker);

  // The BEFORE cohort by WRITER, never by blanking event_at — see trap 2 in the eval module.
  const before = flows.filter((f) => writerGroup(f) === "A");

  const times = flows.map(flowEventTimeMs).filter((t) => t != null).sort((a, b) => a - b);
  if (times.length < 2) {
    console.log("INSUFFICIENT DATA: fewer than 2 dated prints on the tape — nothing to replay.");
    process.exit(0);
  }
  const t0 = times[0];
  const t1 = times[times.length - 1];
  // Start one prior-window in, so the first step has a populated prior window to divide by rather
  // than an empty one — otherwise the replay manufactures exactly the artifact it is measuring.
  const start = t0 + 30 * 60 * 1000;

  const replay = (pop) => {
    // `steps` is carried on EACH detector's stats, not just on the parent: `compareRuns` needs the
    // denominator beside the count, and reading it off the parent silently yielded `undefined`
    // steps and a `null%` rate that printed as a plausible-looking blank rather than an error.
    const stats = {
      steps: 0,
      velocity: { steps: 0, firedSteps: 0, tickerFirings: 0, byTicker: new Map() },
      split: { steps: 0, firedSteps: 0, tickerFirings: 0, byTicker: new Map() },
    };
    for (let now = start; now <= t1; now += STEP_MS) {
      const seen = printedBy(pop, now, flowEventTimeMs);
      const v = detectVelocitySpikes(seen, now);
      const s = detectSplitFlow(seen, now);
      stats.steps++;
      for (const [key, hits] of [["velocity", v], ["split", s]]) {
        stats[key].steps++;
        if (hits.length) stats[key].firedSteps++;
        stats[key].tickerFirings += hits.length;
        for (const h of hits) stats[key].byTicker.set(h.ticker, (stats[key].byTicker.get(h.ticker) ?? 0) + 1);
      }
    }
    return stats;
  };

  const A = replay(before);
  const B = replay(flows);

  const top = (m) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6);
  const focus = FOCUS.map((t) => ({
    ticker: t,
    share: visibleShare(flows.filter((f) => f.ticker === t), before.filter((f) => f.ticker === t)),
    velocity_before: A.velocity.byTicker.get(t) ?? 0,
    velocity_after: B.velocity.byTicker.get(t) ?? 0,
    split_before: A.split.byTicker.get(t) ?? 0,
    split_after: B.split.byTicker.get(t) ?? 0,
  }));

  const report = {
    base: BASE,
    session_span_min: Math.round((t1 - t0) / 60000),
    session_from: new Date(t0).toISOString(),
    session_to: new Date(t1).toISOString(),
    steps: B.steps,
    step_minutes: STEP_MS / 60000,
    rows: flows.length,
    eligible: flows.filter(signalEligible).length,
    before_population: before.length,
    velocity: compareRuns(A.velocity, B.velocity),
    split: compareRuns(A.split, B.split),
    split_saturation: Object.fromEntries(
      FOCUS.map((t) => {
        const fired = B.split.byTicker.get(t) ?? 0;
        return [t, saturationVerdict(fired, B.steps)];
      })
    ),
    focus,
  };

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const L = (s = "") => console.log(s);
    L(`HELIX SIGNAL-POPULATION A/B — ${BASE}`);
    L(`  ${flows.length} rows · ${report.eligible} eligible · BEFORE cohort ${before.length} (writer A)`);
    L(`  ONE session: ${report.session_from} .. ${report.session_to} (${report.session_span_min} min, ${B.steps} x ${report.step_minutes}min steps)`);
    L();
    for (const [name, cmp, a, b] of [["VELOCITY", report.velocity, A.velocity, B.velocity], ["SPLIT FLOW", report.split, A.split, B.split]]) {
      L(`## ${name}   ticker-firings ${cmp.before} -> ${cmp.after}  (${cmp.direction}${cmp.delta ? `, ${cmp.delta > 0 ? "+" : ""}${cmp.delta}` : ""})`);
      L(`  fired on ${a.firedSteps}/${a.steps} steps (${cmp.beforeStepPct}%)  ->  ${b.firedSteps}/${b.steps} (${cmp.afterStepPct}%)`);
      L(`  before top: ${top(a.byTicker).map(([k, n]) => `${k}:${n}`).join(" ") || "(none)"}`);
      L(`  after  top: ${top(b.byTicker).map(([k, n]) => `${k}:${n}`).join(" ") || "(none)"}`);
      L();
    }
    L(`## SATURATION   (a signal that fires on every scan carries no information)`);
    for (const [t, v] of Object.entries(report.split_saturation)) {
      if (!v) { L(`  ${t.padEnd(5)} too few steps for a verdict`); continue; }
      L(`  ${t.padEnd(5)} split flow fires on ${v.rate}% of scans${v.saturated ? "   !! SATURATED" : ""}`);
    }
    L();
    L(`## WHY EACH FOCUS TICKER MOVED   (a firing delta is unreadable without the visible share)`);
    for (const f of focus) {
      L(`  ${f.ticker.padEnd(5)} old detectors saw ${f.share.visible}/${f.share.total} prints (${f.share.pct}%)`);
      L(`        velocity ${f.velocity_before} -> ${f.velocity_after}   ·   split ${f.split_before} -> ${f.split_after}`);
    }
    L();
    L(`  n=1 session. Thresholds are NOT tuned here — SPLIT_MIN_LEG and the velocity max(1, prior)`);
    L(`  floor gate a persisted, graded signal and are the coordinator's call.`);
  }
} finally {
  await session.cleanup?.();
}
