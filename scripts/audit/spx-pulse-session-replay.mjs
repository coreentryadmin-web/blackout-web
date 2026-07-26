// SPX PULSE — synthetic RTH session replay (proof harness, 2026-07-26).
//
// Drives the REAL SPX Pulse engine (src/features/spx/lib/spx-pulse.ts) + the REAL shared
// curation pipeline (src/features/vector/lib/vector-pulse.ts) through a scripted Monday RTH
// session, exactly the way SpxPulseRail does on every live desk tick — same functions, same
// order, same cooldown → (kind,level) dedup → global rate-cap. It fabricates NOTHING about the
// engine: it only supplies a synthetic sequence of desk SNAPSHOTS (the inputs a live desk would
// produce) and prints the feed the rail would show. This is the off-hours proof that the Pulse
// lights up during RTH, without touching the live SPX desk.
//
// Run:  node --import tsx scripts/audit/spx-pulse-session-replay.mjs
//   or: node --import tsx scripts/audit/spx-pulse-session-replay.mjs --json

import {
  detectSpxPulseSignals,
  advanceWallBreakTracker,
  emptyWallBreakTracker,
  sweepToPulseSignal,
  detectSpxPlaySignals,
  gammaCenterOfMass,
} from "@/features/spx/lib/spx-pulse";
import {
  filterFreshPulseSignals,
  dedupeByKindLevel,
  applyGlobalRateCap,
  signalTier,
} from "@/features/vector/lib/vector-pulse";
import { kindView } from "@/features/spx/lib/spx-pulse-view";

const JSON_OUT = process.argv.includes("--json");

// July is EDT (UTC-4). Convert an ET minute-of-day → epoch ms on Mon 2026-07-27.
const ET_OFFSET_MIN = 4 * 60;
const BASE_UTC = Date.UTC(2026, 6, 27, 0, 0, 0);
const atFor = (etMin) => BASE_UTC + (etMin + ET_OFFSET_MIN) * 60_000;
const iso = (ms) => new Date(ms).toISOString();
const etClock = (etMin) => `${String(Math.floor(etMin / 60)).padStart(2, "0")}:${String(etMin % 60).padStart(2, "0")}`;

// Build a snapshot from a compact spec; magnetStrike uses the REAL gammaCenterOfMass helper.
function snap(spec) {
  const walls = spec.walls ?? [];
  return {
    at: atFor(spec.et),
    price: spec.price ?? null,
    gammaFlip: spec.flip ?? null,
    aboveFlip: spec.price != null && spec.flip != null ? spec.price >= spec.flip : null,
    kingCall: spec.kingCall ?? null,
    kingPut: spec.kingPut ?? null,
    walls,
    magnetStrike: gammaCenterOfMass(walls),
    vix: spec.vix ?? null,
    vixTermStructure: spec.term ?? null,
    pin: spec.pin ?? { pin: null, pinPct: null, pinBand: null },
    macroPhase: null, // fed via macroEvents below in the live rail; kept null here for a clean arc
    etMinute: spec.et,
    gexStale: false,
    feedStalled: false,
  };
}

const K_CALL = { strike: 6050, netGex: 800_000_000 };
const K_PUT = { strike: 5950, netGex: -600_000_000 };
const wallsBase = [
  { strike: 6050, netGex: 800_000_000, kind: "resistance" },
  { strike: 6020, netGex: 300_000_000, kind: "resistance" },
  { strike: 5970, netGex: -250_000_000, kind: "support" },
  { strike: 5950, netGex: -600_000_000, kind: "support" },
];

// ── The scripted session. Each row is one desk poll. Comments name the event it should trigger. ──
const ticks = [
  // 09:31 seed — no prior snapshot, nothing fires (seed-don't-fire discipline).
  snap({ et: 571, price: 5996, flip: 6000, kingCall: K_CALL, kingPut: K_PUT, walls: wallsBase, vix: 18.5, term: "contango", pin: { pin: 6000, pinPct: 0.6, pinBand: [5980, 6020] } }),
  // 09:33 REGIME FLIP ↑ — spot 6004 crosses γ-flip 6000 by +4 (≥3 hysteresis) → LONG GAMMA.
  snap({ et: 573, price: 6004, flip: 6000, kingCall: K_CALL, kingPut: K_PUT, walls: wallsBase, vix: 18.4, term: "contango", pin: { pin: 6000, pinPct: 0.6, pinBand: [5980, 6020] } }),
  // 09:40 MAGNET SHIFT + WALL BUILD — 6050 call wall swells 800M→1.25B (+56%) and a 6080 wall
  // appears, dragging the |γ|-weighted centre of mass up >10 pts.
  snap({ et: 580, price: 6006, flip: 6000, kingCall: { strike: 6050, netGex: 1_250_000_000 }, kingPut: K_PUT,
    walls: [ { strike: 6080, netGex: 500_000_000, kind: "resistance" }, { strike: 6050, netGex: 1_250_000_000, kind: "resistance" }, { strike: 6020, netGex: 300_000_000, kind: "resistance" }, { strike: 5970, netGex: -250_000_000, kind: "support" }, { strike: 5950, netGex: -600_000_000, kind: "support" } ],
    vix: 18.3, term: "contango", pin: { pin: 6000, pinPct: 0.62, pinBand: [5985, 6025] } }),
  // 09:50 PIN SHIFT — EOD pin re-solves 6000 → 6010 (Δ+10 ≥5).
  snap({ et: 590, price: 6008, flip: 6000, kingCall: { strike: 6050, netGex: 1_250_000_000 }, kingPut: K_PUT,
    walls: [ { strike: 6080, netGex: 500_000_000, kind: "resistance" }, { strike: 6050, netGex: 1_250_000_000, kind: "resistance" }, { strike: 6020, netGex: 300_000_000, kind: "resistance" }, { strike: 5970, netGex: -250_000_000, kind: "support" }, { strike: 5950, netGex: -600_000_000, kind: "support" } ],
    vix: 18.6, term: "contango", pin: { pin: 6010, pinPct: 0.64, pinBand: [5995, 6030] } }),
  // 10:01 SESSION PHASE — crosses 10:00 (opening drive resolved).
  snap({ et: 601, price: 6012, flip: 6000, kingCall: { strike: 6050, netGex: 1_250_000_000 }, kingPut: K_PUT,
    walls: [ { strike: 6080, netGex: 500_000_000, kind: "resistance" }, { strike: 6050, netGex: 1_250_000_000, kind: "resistance" }, { strike: 6020, netGex: 300_000_000, kind: "resistance" }, { strike: 5970, netGex: -250_000_000, kind: "support" }, { strike: 5950, netGex: -600_000_000, kind: "support" } ],
    vix: 18.7, term: "contango", pin: { pin: 6010, pinPct: 0.64, pinBand: [5995, 6030] } }),
  // 10:05 VOL REGIME — VIX 18.7 → 20.3 crosses the 20 line up.
  snap({ et: 605, price: 6018, flip: 6000, kingCall: { strike: 6050, netGex: 1_250_000_000 }, kingPut: K_PUT,
    walls: [ { strike: 6080, netGex: 500_000_000, kind: "resistance" }, { strike: 6050, netGex: 1_250_000_000, kind: "resistance" }, { strike: 6020, netGex: 300_000_000, kind: "resistance" }, { strike: 5970, netGex: -250_000_000, kind: "support" }, { strike: 5950, netGex: -600_000_000, kind: "support" } ],
    vix: 20.3, term: "contango", pin: { pin: 6010, pinPct: 0.64, pinBand: [5995, 6030] } }),
  // 10:10 wall-break hold #1 — spot 6060 breaks the 6050 king call wall (not yet held).
  snap({ et: 610, price: 6060, flip: 6000, kingCall: { strike: 6050, netGex: 1_250_000_000 }, kingPut: K_PUT,
    walls: [ { strike: 6050, netGex: 1_250_000_000, kind: "resistance" }, { strike: 5950, netGex: -600_000_000, kind: "support" } ],
    vix: 20.5, term: "contango", pin: { pin: 6010, pinPct: 0.6, pinBand: [5995, 6030] } }),
  // 10:12 wall-break hold #2.
  snap({ et: 612, price: 6062, flip: 6000, kingCall: { strike: 6050, netGex: 1_250_000_000 }, kingPut: K_PUT,
    walls: [ { strike: 6050, netGex: 1_250_000_000, kind: "resistance" }, { strike: 5950, netGex: -600_000_000, kind: "support" } ],
    vix: 20.6, term: "contango", pin: { pin: 6010, pinPct: 0.6, pinBand: [5995, 6030] } }),
  // 10:14 WALL BREAK — held 3 consecutive polls above 6050 → confirmed break (Tier 1).
  snap({ et: 614, price: 6065, flip: 6000, kingCall: { strike: 6050, netGex: 1_250_000_000 }, kingPut: K_PUT,
    walls: [ { strike: 6050, netGex: 1_250_000_000, kind: "resistance" }, { strike: 5950, netGex: -600_000_000, kind: "support" } ],
    vix: 20.4, term: "contango", pin: { pin: 6010, pinPct: 0.6, pinBand: [5995, 6030] } }),
  // 10:16 carries the play FIRE (no new structural event — price/walls/pin unchanged).
  snap({ et: 616, price: 6063, flip: 6000, kingCall: { strike: 6050, netGex: 1_250_000_000 }, kingPut: K_PUT,
    walls: [ { strike: 6050, netGex: 1_250_000_000, kind: "resistance" }, { strike: 5950, netGex: -600_000_000, kind: "support" } ],
    vix: 20.4, term: "contango", pin: { pin: 6010, pinPct: 0.6, pinBand: [5995, 6030] } }),
  // 10:20 carries a large flow-tape SWEEP (Tier 3).
  snap({ et: 620, price: 6068, flip: 6000, kingCall: { strike: 6050, netGex: 1_250_000_000 }, kingPut: K_PUT,
    walls: [ { strike: 6050, netGex: 1_250_000_000, kind: "resistance" }, { strike: 5950, netGex: -600_000_000, kind: "support" } ],
    vix: 20.2, term: "contango", pin: { pin: 6010, pinPct: 0.6, pinBand: [5995, 6030] } }),
  // 14:01 SESSION PHASE — crosses 14:00 (charm/vanna window).
  snap({ et: 841, price: 6070, flip: 6000, kingCall: { strike: 6050, netGex: 1_250_000_000 }, kingPut: K_PUT,
    walls: [ { strike: 6050, netGex: 1_250_000_000, kind: "resistance" }, { strike: 5950, netGex: -600_000_000, kind: "support" } ],
    vix: 19.8, term: "backwardation", pin: { pin: 6050, pinPct: 0.7, pinBand: [6035, 6065] } }),
  // 15:01 SESSION PHASE — crosses 15:00 (power hour).
  snap({ et: 901, price: 6055, flip: 6000, kingCall: { strike: 6050, netGex: 1_250_000_000 }, kingPut: K_PUT,
    walls: [ { strike: 6050, netGex: 1_250_000_000, kind: "resistance" }, { strike: 5950, netGex: -600_000_000, kind: "support" } ],
    vix: 19.5, term: "backwardation", pin: { pin: 6050, pinPct: 0.78, pinBand: [6040, 6060] } }),
];

// Sweeps off the flow tape (Tier 3) — keyed to a tick's clock. sweepToPulseSignal timestamps
// from alerted_at, so a fresh print reads at its real minute, not "now".
const sweeps = [
  { et: 620, brief: { has_sweep: true, premium: 2_100_000, option_type: "call", direction: "BUY", strike: 6075, expiry: "2026-07-27", trade_count: 900, alerted_at: iso(atFor(620)) } },
];

// Play lifecycle (Tier 3) — armed → fired → closed.
const plays = [
  { et: 611, slice: { action: "BUY", direction: "long", open_play: null, contractLabel: "6060C 0DTE" } },      // ARMED
  { et: 615, slice: { action: "BUY", direction: "long", open_play: { direction: "long", entry_price: 6061 }, contractLabel: "6060C 0DTE" } }, // FIRED
  { et: 901, slice: { action: null, direction: null, open_play: null, contractLabel: null } },                  // CLOSED
];

// ── Run the pipeline exactly like SpxPulseRail ──
const seen = {};
const dedup = {};
let rateLedger = [];
let wallTracker = emptyWallBreakTracker();
let prevSnap = null;
// Seed the play state with a "scanning" slice (what the desk shows at mount) + playSeeded=true,
// so the FIRST real transition (arm) fires instead of being swallowed by the seed-don't-fire rule.
let prevPlay = { action: null, direction: null, open_play: null, contractLabel: null };
let playSeeded = true;
let lastEt = -1;

const emittedAll = [];

function curate(raw, now) {
  if (!raw.length) return [];
  const cooled = filterFreshPulseSignals(raw, seen, now);
  Object.assign(seen, cooled.seen);
  const deduped = dedupeByKindLevel(cooled.fresh, dedup, now);
  Object.assign(dedup, deduped.seen);
  const capped = applyGlobalRateCap(deduped.kept, rateLedger, now);
  rateLedger = capped.recent;
  return capped.emitted;
}

for (const s of ticks) {
  const now = s.at;
  const raw = detectSpxPulseSignals(prevSnap, s);
  const { tracker, breaks } = advanceWallBreakTracker(wallTracker, s);
  wallTracker = tracker;
  raw.push(...breaks);
  // Each sweep/play fires exactly once, on the first poll whose ET minute reaches its time
  // (window (lastEt, thisEt]) — mirrors a real desk delivering the print/transition on the
  // next poll after it happens.
  for (const sw of sweeps) {
    if (sw.et > lastEt && sw.et <= s.etMinute) {
      const sig = sweepToPulseSignal(sw.brief, now);
      if (sig) raw.push(sig);
    }
  }
  for (const p of plays) {
    if (p.et > lastEt && p.et <= s.etMinute) {
      const ev = detectSpxPlaySignals(prevPlay, p.slice, now, playSeeded);
      playSeeded = true;
      prevPlay = p.slice;
      raw.push(...ev);
    }
  }
  lastEt = s.etMinute;
  prevSnap = s;
  const emitted = curate(raw, now);
  for (const e of emitted) emittedAll.push({ et: s.etMinute, ev: e });
}

// ── Render ──
if (JSON_OUT) {
  console.log(JSON.stringify({ emitted: emittedAll.map((r) => ({ et: etClock(r.et), tier: signalTier(r.ev), kind: r.ev.kind, tone: r.ev.tone, line: r.ev.line, implication: r.ev.implication, level: r.ev.level, magnitude: r.ev.magnitude })) }, null, 2));
} else {
  console.log("\n  ⚡ SPX PULSE — synthetic Monday RTH session replay (REAL engine + curation pipeline)\n");
  console.log("  Each row is what the live rail would render on that desk poll. Nothing about the");
  console.log("  detection is faked — only the input snapshots are scripted.\n");
  console.log("  ── time ── T ─ event ────────────────────────────────────────────────────────────────\n");
  const byKind = {};
  for (const { et, ev } of emittedAll) {
    const view = kindView(ev.kind);
    const tier = signalTier(ev);
    byKind[ev.kind] = (byKind[ev.kind] ?? 0) + 1;
    const chips = (ev.magnitude ?? []).map((m) => m.label).join("  ");
    console.log(`  ${etClock(et)} ET  T${tier}  ${view.icon} ${view.badge.padEnd(12)} ${ev.line}`);
    if (ev.implication) console.log(`             ↳ ${ev.implication}${chips ? `   [ ${chips} ]` : ""}`);
  }
  console.log("\n  ── summary ─────────────────────────────────────────────────────────────────────────\n");
  const kinds = Object.keys(byKind).sort();
  for (const k of kinds) console.log(`   ${String(byKind[k]).padStart(2)} ×  ${kindView(k).badge}  (${k})`);
  console.log(`\n   ${emittedAll.length} events across ${ticks.length} polls · ${kinds.length} distinct event kinds fired\n`);
}
