#!/usr/bin/env node
/**
 * CRON DST AUDIT — does each cron's fixed-UTC schedule still satisfy the ET wall-clock
 * gate its route applies, in BOTH halves of the year?
 *
 * WHY THIS EXISTS. EventBridge rules (`aws_cloudwatch_event_rule.schedule_expression`) fire on a
 * FIXED UTC clock — classic Rules have no timezone support at all. Half the cron routes gate on
 * America/New_York wall-clock. The ET offset moves twice a year, so a schedule that satisfies its
 * own gate under EDT (UTC-4) can miss it entirely under EST (UTC-5) — and the failure is SILENT:
 * the cron fires on time, the route self-skips, and returns HTTP 200. `stale_after_min` cannot see
 * it, because nothing is late and nothing errors.
 *
 * The measured instance: `x-autopost` fires on seven fixed UTC hours and its route matches seven
 * EVEN ET hours. Under EDT all seven land on even ET hours. Under EST every one lands on an odd ET
 * hour and the job goes dark for the ~4 months from the November change to the March change.
 *
 * The fix pattern that already works in this repo is a TWO-UTC-HOUR schedule (`15 13,14 * * 1-5`)
 * paired with a DST-aware `inEtWindow` guard that self-skips the off-band fire. This script exists
 * so that pattern is verified by arithmetic rather than by reading a cron by eye — which is how
 * this class of bug survives in the first place.
 *
 * Usage:  node scripts/audit/cron-dst-audit.mjs [--infra=../blackout-infra] [--json]
 * Exits non-zero if any job with an ET gate has zero satisfying fires in either offset.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const INFRA = (args.find((a) => a.startsWith("--infra=")) || "").split("=")[1] || "../blackout-infra";
const MANIFEST = path.join(INFRA, "terraform/modules/crons/cron-jobs.json");

// ---------------------------------------------------------------------------
// Cron expansion. Standard 5-field (min hour dom mon dow), which is what both the
// railway.*.toml files and the registry's `schedule_cron_utc` mirror use.
// ---------------------------------------------------------------------------

/** Expand one cron field into the explicit set of values it matches. */
function expandField(field, min, max) {
  const out = new Set();
  for (const part of String(field).split(",")) {
    // `*/n`, `a-b/n`, `a-b`, `a`, and the `a/n` form EventBridge/Railway also accept.
    const [rangePart, stepRaw] = part.split("/");
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isFinite(step) || step < 1) throw new Error(`bad step in "${part}"`);
    let lo, hi;
    if (rangePart === "*") {
      lo = min; hi = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-").map(Number);
      lo = a; hi = b;
    } else {
      lo = Number(rangePart);
      // `30/15` means "from 30, every 15, to the end of the field" — not a single value.
      hi = stepRaw ? max : lo;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error(`bad range in "${part}"`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

/** Every (dowUtc, hourUtc, minuteUtc) a 5-field UTC cron fires at, across one week. */
function expandCron(expr) {
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`expected 5 cron fields, got ${f.length}: "${expr}"`);
  const [minF, hourF, domF, monF, dowF] = f;
  const minutes = expandField(minF, 0, 59);
  const hours = expandField(hourF, 0, 23);
  // Day-of-month/month are `*` for every schedule in this repo; if one is ever narrowed we must
  // not silently pretend it fires daily, so refuse rather than approximate.
  if (domF !== "*" || monF !== "*") throw new Error(`day-of-month/month narrowing unsupported: "${expr}"`);
  const dows = dowF === "*" ? [0, 1, 2, 3, 4, 5, 6] : expandField(dowF, 0, 7).map((d) => d % 7);
  const fires = [];
  for (const d of [...new Set(dows)].sort()) {
    for (const h of hours) for (const m of minutes) fires.push({ dowUtc: d, hourUtc: h, minuteUtc: m });
  }
  return fires;
}

/** Shift a UTC fire into ET at a fixed offset (-4 = EDT, -5 = EST). Carries the day rollover. */
function toEt(fire, offsetHours) {
  const totalMin = fire.hourUtc * 60 + fire.minuteUtc + offsetHours * 60;
  const dayShift = Math.floor(totalMin / (24 * 60));
  const mins = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
  return {
    dowEt: (((fire.dowUtc + dayShift) % 7) + 7) % 7,
    hourEt: Math.floor(mins / 60),
    minuteEt: mins % 60,
    minsEt: mins,
  };
}

const hm = (h, m) => h * 60 + m;
const isWeekdayEt = (e) => e.dowEt >= 1 && e.dowEt <= 5;

// ---------------------------------------------------------------------------
// The ET gate each route actually applies, transcribed from the route source.
// `gate: null` means the route applies NO ET wall-clock gate — it cannot be
// DST-broken, and saying so explicitly is the point (an uninspected route must
// never land in the "fine" column by default).
// ---------------------------------------------------------------------------

const GATES = {
  "x-autopost": {
    desc: "isPostWindow(): ET hour ∈ {8,10,12,14,16,18,20} Mon–Fri, {10,14} Sat/Sun",
    src: "src/lib/x-content-schedule.ts",
    gate: (e) =>
      e.dowEt === 0 || e.dowEt === 6
        ? [10, 14].includes(e.hourEt)
        : [8, 10, 12, 14, 16, 18, 20].includes(e.hourEt),
  },
  "nighthawk-morning-confirm": {
    desc: "inEtWindow(9:10 +35m) → ET ∈ [9:10, 9:45] weekdays",
    src: "src/features/nighthawk/lib/et-window.ts",
    gate: (e) => isWeekdayEt(e) && e.minsEt >= hm(9, 10) && e.minsEt <= hm(9, 45),
  },
  "nighthawk-outcomes": {
    desc: "inEtWindow(16:30 +90m) → ET ∈ [16:30, 18:00] weekdays",
    src: "src/features/nighthawk/lib/et-window.ts",
    gate: (e) => isWeekdayEt(e) && e.minsEt >= hm(16, 30) && e.minsEt <= hm(18, 0),
  },
  "spx-signal-observe": {
    desc: "isSpxEngineCronWindow(): ET ∈ [7:00, 16:15) weekdays (+ trading-day gate)",
    src: "src/features/spx/lib/spx-play-session-guards.ts",
    gate: (e) => isWeekdayEt(e) && e.minsEt >= hm(7, 0) && e.minsEt < hm(16, 15),
  },
  "swing-discovery": {
    desc: "scan-cadence phase windows: PRE_OPEN/MIDDAY/POWER_HOUR/POST_CLOSE/OVERNIGHT (ET)",
    src: "src/lib/swing/scan-cadence.ts",
    gate: (e) =>
      isWeekdayEt(e) &&
      [
        [hm(6, 0), hm(9, 15)],
        [hm(12, 0), hm(13, 0)],
        [hm(15, 0), hm(16, 0)],
        [hm(16, 15), hm(20, 0)],
        [hm(20, 0), hm(24, 0)],
      ].some(([s, en]) => e.minsEt >= s && e.minsEt < en),
  },
  "darkpool-discord": {
    desc: "isEtCashRth(): ET ∈ [9:30, 16:00] weekdays (DARKPOOL_DISCORD_RTH_ONLY, default on)",
    src: "src/lib/et-market-hours.ts",
    gate: (e) => isWeekdayEt(e) && e.minsEt >= hm(9, 30) && e.minsEt <= hm(16, 0),
  },
  "helix-discord-digest": {
    desc: "isEtCashRth(): ET ∈ [9:30, 16:00] weekdays (HELIX_DISCORD_DIGEST_RTH_ONLY, default on)",
    src: "src/lib/et-market-hours.ts",
    gate: (e) => isWeekdayEt(e) && e.minsEt >= hm(9, 30) && e.minsEt <= hm(16, 0),
  },
  "thermal-discord": {
    desc: "isEtCashRth(): ET ∈ [9:30, 16:00] weekdays (THERMAL_DISCORD_RTH_ONLY, default on)",
    src: "src/lib/et-market-hours.ts",
    gate: (e) => isWeekdayEt(e) && e.minsEt >= hm(9, 30) && e.minsEt <= hm(16, 0),
  },


  // --- The rest of the ET-gated fleet. Found by extracting every route's SKIP REASON rather than by
  // --- grepping for "America/New_York", which is wrong in both directions: a route that formats an ET
  // --- date for a dedup key mentions the zone but does not gate on it (gex-alerts), and a route whose
  // --- gate arrives through a helper does not mention it at all (swing-discovery, market-regime-detector).
  // --- Every one of these fires on the wide 11-21 UTC band, which brackets both the [9:30,16:00] RTH gate
  // --- and the [7:00,16:15) SPX-engine gate under EDT *and* EST. That band width is what absorbs the DST
  // --- shift; the jobs that break are the ones pinned to one or two specific UTC hours.
  "spx-evaluate": {
    desc: "isSpxEngineCronWindow(): ET ∈ [7:00, 16:15) weekdays (+ trading-day gate)",
    src: "src/features/spx/lib/spx-play-session-guards.ts",
    gate: (e) => isWeekdayEt(e) && e.minsEt >= hm(7, 0) && e.minsEt < hm(16, 15),
  },
  "spx-issues-sync": {
    desc: "isSpxEngineCronWindow(): ET ∈ [7:00, 16:15) weekdays (+ trading-day gate)",
    src: "src/features/spx/lib/spx-play-session-guards.ts",
    gate: (e) => isWeekdayEt(e) && e.minsEt >= hm(7, 0) && e.minsEt < hm(16, 15),
  },
  "data-integrity": {
    desc: "isSpxEngineCronWindow(): ET ∈ [7:00, 16:15) weekdays (+ trading-day gate)",
    src: "src/features/spx/lib/spx-play-session-guards.ts",
    gate: (e) => isWeekdayEt(e) && e.minsEt >= hm(7, 0) && e.minsEt < hm(16, 15),
  },
  "data-correctness": {
    desc: "isSpxEngineCronWindow(): ET ∈ [7:00, 16:15) weekdays (+ trading-day gate)",
    src: "src/features/spx/lib/spx-play-session-guards.ts",
    gate: (e) => isWeekdayEt(e) && e.minsEt >= hm(7, 0) && e.minsEt < hm(16, 15),
  },
  "provider-health-reconcile": {
    desc: "isSpxEngineCronWindow(): ET ∈ [7:00, 16:15) weekdays (+ trading-day gate)",
    src: "src/features/spx/lib/spx-play-session-guards.ts",
    gate: (e) => isWeekdayEt(e) && e.minsEt >= hm(7, 0) && e.minsEt < hm(16, 15),
  },
  "market-regime-detector": {
    desc: "isSpxEngineCronWindow(): ET ∈ [7:00, 16:15) weekdays (+ trading-day gate)",
    src: "src/features/spx/lib/spx-play-session-guards.ts",
    gate: (e) => isWeekdayEt(e) && e.minsEt >= hm(7, 0) && e.minsEt < hm(16, 15),
  },
  "bie-full-state-snapshot": {
    desc: "isEtCashRth(): ET ∈ [9:30, 16:00] weekdays",
    src: "src/lib/et-market-hours.ts",
    gate: (e) => isWeekdayEt(e) && e.minsEt >= hm(9, 30) && e.minsEt <= hm(16, 0),
  },
  "coaching-alerts": {
    desc: "isEtCashRth(): ET ∈ [9:30, 16:00] weekdays",
    src: "src/lib/et-market-hours.ts",
    gate: (e) => isWeekdayEt(e) && e.minsEt >= hm(9, 30) && e.minsEt <= hm(16, 0),
  },
  "vector-walls-warm": {
    desc: "isEtCashRth(): ET ∈ [9:30, 16:00] weekdays",
    src: "src/lib/et-market-hours.ts",
    gate: (e) => isWeekdayEt(e) && e.minsEt >= hm(9, 30) && e.minsEt <= hm(16, 0),
  },
  "vector-universe-snapshot": {
    desc: "isEtCashRth(): ET ∈ [9:30, 16:00] weekdays",
    src: "src/lib/et-market-hours.ts",
    gate: (e) => isWeekdayEt(e) && e.minsEt >= hm(9, 30) && e.minsEt <= hm(16, 0),
  },
  "vector-full-state-snapshot": {
    desc: "isEtCashRth(): ET ∈ [9:30, 16:00] weekdays",
    src: "src/lib/et-market-hours.ts",
    gate: (e) => isWeekdayEt(e) && e.minsEt >= hm(9, 30) && e.minsEt <= hm(16, 0),
  },
  "vector-dark-pool-warm": {
    desc: "isEtCashRth(): ET ∈ [9:30, 16:00] weekdays",
    src: "src/lib/et-market-hours.ts",
    gate: (e) => isWeekdayEt(e) && e.minsEt >= hm(9, 30) && e.minsEt <= hm(16, 0),
  },
  "vector-bead-record": {
    desc: "isEtCashRth(): ET ∈ [9:30, 16:00] weekdays",
    src: "src/lib/et-market-hours.ts",
    gate: (e) => isWeekdayEt(e) && e.minsEt >= hm(9, 30) && e.minsEt <= hm(16, 0),
  },
  "meridian-warm": {
    desc: "isEtExtendedWarmHours(): ET ∈ [4:00, 20:00] weekdays",
    src: "src/lib/et-market-hours.ts",
    gate: (e) => isWeekdayEt(e) && e.minsEt >= hm(4, 0) && e.minsEt <= hm(20, 0),
  },
  "nighthawk-playbook": {
    desc: "isInEditionWindow(): ET ∈ [17:30, 19:30] trading days (17:30 + 120m catch-up)",
    src: "src/features/nighthawk/lib/edition-stale.ts",
    gate: (e) => isWeekdayEt(e) && e.minsEt >= hm(17, 30) && e.minsEt <= hm(19, 30),
  },

  // --- Inspected and found to apply NO ET wall-clock gate. -------------------
  "gex-alerts": {
    desc: "NO ET gate — America/New_York used only for the per-day dedup key (etDate()); run gate is GEX_ALERTS_PUSH + VAPID",
    src: "src/app/api/cron/gex-alerts/route.ts",
    gate: null,
  },
  "socket-health": {
    desc: "NO ET gate — inOptionsMarketHours() only decides whether to seed the pulse snapshot; the probe always runs",
    src: "src/app/api/cron/socket-health/route.ts",
    gate: null,
  },
};

// ---------------------------------------------------------------------------
// Inputs: railway.*.toml (schedule source of truth, per blackout-infra's
// sync-cron-schedules.mjs), the generated EventBridge manifest, and the
// registry's `schedule_cron_utc` mirror.
// ---------------------------------------------------------------------------

function readRailwaySchedules(root) {
  const out = new Map();
  for (const f of readdirSync(root)) {
    const m = /^railway\.(.+)\.toml$/.exec(f);
    if (!m) continue;
    const src = readFileSync(path.join(root, f), "utf8");
    // Two spellings are in use across these files: `cronSchedule = "…"` and a
    // `[[cron]]` table with `schedule = "…"`.
    const s = /(?:cronSchedule|schedule)\s*=\s*"([^"]+)"/.exec(src);
    if (s) out.set(m[1], s[1]);
  }
  return out;
}

function readManifest(file) {
  const out = new Map();
  if (!existsSync(file)) return null;
  for (const j of JSON.parse(readFileSync(file, "utf8")).jobs) out.set(j.key, j.railway_schedule);
  return out;
}

function readRegistryMirror(file) {
  const src = readFileSync(file, "utf8");
  const out = new Map();
  // Entries are object literals; pair each `key:` with the `schedule_cron_utc:` that follows it
  // before the next `key:`.
  const blocks = src.split(/\n  \{\n/).slice(1);
  for (const b of blocks) {
    const k = /key:\s*"([^"]+)"/.exec(b);
    const c = /schedule_cron_utc:\s*"([^"]+)"/.exec(b);
    const l = /schedule_label:\s*"([^"]+)"/.exec(b);
    if (k) out.set(k[1], { cron: c ? c[1] : null, label: l ? l[1] : null });
  }
  return out;
}

const railway = readRailwaySchedules(".");
const manifest = readManifest(MANIFEST);
const registry = readRegistryMirror("src/lib/cron-registry.ts");
if (!manifest) {
  console.error(`Cannot read ${MANIFEST} — pass --infra=<path to blackout-infra checkout>.`);
  console.error("Refusing to report a DST verdict without the deployed schedule.");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Evaluate.
// ---------------------------------------------------------------------------

const rows = [];
for (const [key, g] of Object.entries(GATES)) {
  const deployed = manifest.get(key) ?? null;
  const source = railway.get(key) ?? null;
  const reg = registry.get(key) ?? { cron: null, label: null };
  const row = {
    key,
    deployed_utc_cron: deployed,
    railway_source_cron: source,
    registry_mirror_cron: reg.cron,
    registry_label: reg.label,
    gates_on: g.desc,
    gate_src: g.src,
  };

  if (!deployed) {
    row.verdict = "UNSCHEDULED";
    row.edt_hits = null;
    row.est_hits = null;
    row.note = "No entry in the deployed EventBridge manifest — this route never fires on a timer, so it has no DST exposure. Absence, not health.";
    rows.push(row);
    continue;
  }

  let fires;
  try {
    fires = expandCron(deployed);
  } catch (err) {
    row.verdict = "UNPARSEABLE";
    row.note = `Could not expand "${deployed}": ${err.message}`;
    rows.push(row);
    continue;
  }

  row.total_fires_per_week = fires.length;
  if (g.gate === null) {
    row.verdict = "NO ET GATE";
    row.edt_hits = "n/a";
    row.est_hits = "n/a";
    row.note = "Route applies no ET wall-clock gate, so a UTC/ET drift cannot silence it.";
    rows.push(row);
    continue;
  }

  const edt = fires.filter((f) => g.gate(toEt(f, -4))).length;
  const est = fires.filter((f) => g.gate(toEt(f, -5))).length;
  row.edt_hits = edt;
  row.est_hits = est;
  row.verdict =
    edt === 0 || est === 0 ? "BROKEN" : edt === est ? "OK" : "ASYMMETRIC";
  if (row.verdict === "BROKEN") {
    row.note = `Zero satisfying fires under ${edt === 0 ? "EDT" : "EST"} — the job goes silently dark for that half of the year (route self-skips, HTTP 200, nothing alerts).`;
  } else if (row.verdict === "ASYMMETRIC") {
    row.note = `Fires land in-window in both offsets but at different counts (EDT ${edt} vs EST ${est}) — not dark, but the effective cadence changes across the DST boundary.`;
  } else {
    row.note = "Satisfies its own ET gate identically in both offsets.";
  }
  rows.push(row);
}


// ---------------------------------------------------------------------------
// CHECK B — ET INTENT. A route with no ET gate cannot be silenced by DST, but its
// schedule can still drift away from the ET time its label/comment claims. That
// failure is worse in one respect: the job still RUNS, on the wrong side of the
// event it was scheduled around, and emits output that looks valid.
//
// `target_et` is the ET wall-clock the job's own schedule_label (or route header)
// declares. `must_be_after` marks jobs whose correctness depends on being past a
// session boundary — a post-close job that fires pre-close reads an unsettled tape.
// ---------------------------------------------------------------------------

const INTENTS = {
  "banger-discovery":   { target_et: "16:15", label: "4:15 PM ET weekdays (post-close)", must_be_after: hm(16, 0), why: "runBangerCommit screens Polygon grouped-daily (gain%/volume/close-strength) for TODAY and COMMITS positions. Before the 16:00 ET close those rows are an unsettled partial session." },
  "gex-eod-snapshot":   { target_et: "16:10", label: "~4:10 PM ET weekdays (post-close)", must_be_after: hm(16, 0), self_correcting: "appendGexEodSnapshot is idempotent per ET trading day and LAST-WRITE-WINS: it drops the day's existing entry and appends the fresh one. The pre-close 15:10 ET write under EST is overwritten by the 16:10 ET one an hour later, so the stored close is correct in both offsets. railway.gex-eod-snapshot.toml documents this dual-band intent explicitly — it is deliberate, not drift. RESIDUAL (narrow): if the second fire returns null (cold matrix / empty chain / Redis miss it treats as a skip, not a failure) the pre-close value survives as that day's close, and only under EST.", why: "appendGexEodSnapshot persists the day's CLOSE levels." },
  "x-growth":           { target_et: "13:00-22:00 UTC", label: "Hourly 13:00-22:00 UTC weekdays", must_be_after: null, utc_labelled: true, why: "Outbound social cadence. A fixed-UTC band cannot hold an ET clock year-round, so the intent is the UTC band and the label must say so in both offsets." },
  "x-replies":          { target_et: "13:00-22:00 UTC", label: "Hourly :20 past, 13:00-22:00 UTC weekdays", must_be_after: null, utc_labelled: true, why: "Outbound social cadence. As x-growth: the intent is the UTC band." },
  "x-analytics":        { target_et: "23:30 UTC", label: "Daily 23:30 UTC", must_be_after: null, utc_labelled: true, why: "Metrics pull. A point-in-time UTC job; its ET rendering moves with daylight saving." },
  "largo-morning-brief":{ target_et: "09:25", label: "9:25 AM ET weekdays", must_be_after: null, why: "Pre-open member push; label states an ET time." },
  "zerodte-grade":      { target_et: "16:00-18:00", label: "Every 15 min post-close (16:00-18:00 ET band)", must_be_after: hm(16, 0), why: "Grades the 0DTE ledger after the close." },
  "banger-live-sync":   { target_et: "RTH 09:30-16:00", label: "~Every 5 min (market hours)", must_be_after: null, covers: [hm(9, 30), hm(16, 0)], why: "Live marks during the session. A deliberately WIDE band: correct as long as it brackets RTH in both offsets, which is the intended design, not drift." },
  // Added 2026-08-23 (SLAYER-MAP §8 item 8) — it was DEPLOYED and in neither table, so the audit
  // had never evaluated it and its clean exit said nothing about it. Verified UTC-labelled rather
  // than assumed: the route (`/api/cron/spx-signal-weight-optimize`) applies NO ET gate at all —
  // its window is `observed_at > now - 30 days`, a rolling ABSOLUTE-time lookback, so there is no
  // gate to stop being satisfied (form A) and nothing it must land relative to (form B). A
  // 30-day accuracy report is insensitive to a one-hour shift. Registry mirror `0 22 * * 1-5`
  // matches the deployed manifest exactly.
  "spx-signal-weight-optimize": { target_et: "22:00 UTC", label: "Nightly 10 PM UTC", must_be_after: null, utc_labelled: true, why: "Ranked per-signal alpha report over a rolling 30-day window. Pure duration lookback, no ET calendar boundary — the intent is the UTC time and the label says so." },
};

const intentRows = [];
for (const [key, it] of Object.entries(INTENTS)) {
  const deployed = manifest.get(key) ?? null;
  const reg = registry.get(key) ?? { cron: null, label: null };
  const row = { key, deployed_utc_cron: deployed, declared_et: it.target_et, declared_label: reg.label ?? it.label, why: it.why };
  if (!deployed) {
    row.verdict = "UNSCHEDULED";
    row.note = "Not in the deployed manifest — the label describes a schedule that does not exist.";
    intentRows.push(row);
    continue;
  }
  const fires = expandCron(deployed);
  const span = (off) => {
    const ets = fires.map((f) => toEt(f, off)).filter(isWeekdayEt);
    if (!ets.length) return { first: null, last: null, ets: [] };
    const sorted = ets.map((e) => e.minsEt).sort((a, b) => a - b);
    return { first: sorted[0], last: sorted[sorted.length - 1], ets };
  };
  const fmtm = (m) => (m == null ? "—" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  const edt = span(-4), est = span(-5);
  row.edt_et_span = `${fmtm(edt.first)}–${fmtm(edt.last)}`;
  row.est_et_span = `${fmtm(est.first)}–${fmtm(est.last)}`;
  if (it.must_be_after != null) {
    // The job's LAST fire is what it ultimately runs on; its FIRST fire is what it may run on early.
    const edtEarly = edt.first != null && edt.first < it.must_be_after;
    const estEarly = est.first != null && est.first < it.must_be_after;
    const edtSafe = edt.last != null && edt.last >= it.must_be_after;
    const estSafe = est.last != null && est.last >= it.must_be_after;
    if (!edtSafe || !estSafe) {
      row.verdict = "BROKEN";
      row.note = `No fire lands after ${fmtm(it.must_be_after)} ET under ${!edtSafe ? "EDT" : "EST"}.`;
    } else if (edtEarly || estEarly) {
      // An early fire is only a DEFECT if nothing later corrects it. A job whose writer is
      // idempotent-and-last-write-wins is repaired by its own next fire, so calling it broken would
      // be a false positive — and a false positive here costs more than the finding is worth.
      const early = fmtm(estEarly ? est.first : edt.first);
      const which = estEarly && !edtEarly ? "EST" : "EDT";
      if (it.self_correcting) {
        row.verdict = "OK (self-correcting)";
        row.note = `Earliest fire is ${early} ET under ${which}, before the ${fmtm(it.must_be_after)} ET boundary — but a later fire always corrects it. ${it.self_correcting}`;
      } else {
        row.verdict = estEarly && !edtEarly ? "EARLY UNDER EST" : "EARLY";
        row.note = `Earliest fire is ${early} ET under ${which} — BEFORE the ${fmtm(it.must_be_after)} ET boundary this job depends on, and nothing later corrects it.`;
      }
    } else {
      row.verdict = "OK";
      row.note = "Every fire lands after the boundary in both offsets.";
    }
  } else if (it.covers) {
    // Band intent: the claim is "covers RTH", not "starts at a fixed ET time". A wide fixed-UTC
    // band that brackets the ET window in BOTH offsets satisfies its label year-round.
    const [cs, ce] = it.covers;
    const edtOk = edt.first != null && edt.first <= cs && edt.last >= ce;
    const estOk = est.first != null && est.first <= cs && est.last >= ce;
    row.verdict = edtOk && estOk ? "OK" : "BAND GAP";
    row.note = edtOk && estOk
      ? `Fire span brackets the ${fmtm(cs)}-${fmtm(ce)} ET band in both offsets — the shift is absorbed by the band width, which is the intended design.`
      : `Fire span does NOT cover the ${fmtm(cs)}-${fmtm(ce)} ET band under ${!edtOk ? "EDT" : "EST"}.`;
  } else if (it.utc_labelled) {
    // UTC-LABELLED INTENT — and this branch exists because the check could not previously pass.
    //
    // The old rule was `edt.first === est.first ? OK : LABEL DRIFTS`. For a fixed-UTC cron those two
    // differ by exactly one hour BY DEFINITION, so the verdict was unfalsifiable: no edit to any
    // label could ever clear it. Worse, it never read a label at all — it quoted `target_et` from
    // this file and called that "the label".
    //
    // Meanwhile `src/lib/cron-registry.ts` had ALREADY been fixed to state the UTC schedule and
    // BOTH ET renderings, with a comment explaining why. So the audit was scolding the registry for
    // a lie the registry no longer told, and the only way to satisfy it was to change a schedule —
    // which for these routes is outbound social cadence, not a docs fix.
    //
    // A check that stays red after you do exactly what it asked teaches people to ignore it. So
    // this branch checks THE THING IT IS NAMED FOR: does the deployed label actually declare both
    // renderings? The schedule still shifts an hour — that is inherent to fixed-UTC and is not a
    // defect — but the documentation either owns that or it does not, and that is decidable.
    const label = String(row.declared_label ?? "");
    const namesUtc = /\bUTC\b/.test(label);
    const namesBoth = /\bEDT\b/.test(label) && /\bEST\b/.test(label);
    if (namesUtc && namesBoth) {
      row.verdict = "OK (UTC-labelled)";
      row.note = `Fires on a fixed UTC schedule and the label says so, naming both renderings (${row.edt_et_span} ET under EDT, ${row.est_et_span} ET under EST). The ET placement shifts an hour across the changeover — inherent to fixed-UTC scheduling, and documented rather than hidden.`;
    } else {
      row.verdict = "LABEL DRIFTS";
      row.note = `Fires on a fixed UTC schedule (${row.edt_et_span} ET under EDT, ${row.est_et_span} ET under EST) but the label does not declare both renderings: ${label || "(no label)"}. State the UTC time and both ET equivalents, or the label is true for only half the year.`;
    }
  } else {
    row.verdict = edt.first === est.first ? "OK" : "LABEL DRIFTS";
    row.note =
      edt.first === est.first
        ? "ET placement identical in both offsets."
        : `Label says ${it.target_et}, but the fixed-UTC cron lands at ${row.edt_et_span} ET under EDT and ${row.est_et_span} ET under EST — the label is true for only half the year.`;
  }
  intentRows.push(row);
}

// Registry-vs-deployed disagreement is its own defect class: a mirror that lies.
const mismatches = [];
for (const [key, reg] of registry) {
  if (!reg.cron) continue;
  const deployed = manifest.get(key) ?? null;
  if (deployed == null) mismatches.push({ key, registry: reg.cron, deployed: "(absent)", kind: "registry claims a schedule the deployed manifest does not have" });
  else if (deployed !== reg.cron) mismatches.push({ key, registry: reg.cron, deployed, kind: "registry mirror disagrees with the deployed schedule" });
}

/**
 * COVERAGE — which DEPLOYED jobs this audit never looked at.
 *
 * `GATES` and `INTENTS` are hand-curated. A job that is deployed and in neither table is not
 * reported as OK — it is not reported AT ALL, and the run still exits 0. That is the same
 * absence-as-health shape this audit exists to catch, sitting inside the instrument: a reader sees
 * a clean sweep and has no way to know it covered 26 of 39 jobs.
 *
 * Measured 2026-08-23: 39 deployed, 26 covered, 13 unlisted. Most are warmers and cleanups with no
 * ET-relative intent, which is why nobody noticed — but "probably harmless" is a judgment nobody
 * has recorded, and this section is where it would go.
 *
 * Deliberately does NOT fail the run. Classifying a job needs its route read, and the owner of
 * each is the lane that ships it; a hard failure here would turn one lane's unclassified job into
 * every other lane's red build. Loud and visible, not blocking.
 */
const coveredKeys = new Set([...Object.keys(GATES), ...Object.keys(INTENTS)]);
const unaudited = [...manifest.keys()].filter((k) => !coveredKeys.has(k)).sort();

if (JSON_OUT) {
  console.log(JSON.stringify({ rows, intentRows, mismatches, coverage: { deployed: manifest.size, covered: manifest.size - unaudited.length, unaudited } }, null, 2));
} else {
  const pad = (s, n) => String(s ?? "—").padEnd(n);
  // Widths DERIVED from the data, not literals. `spx-signal-weight-optimize` (26 chars) exactly
  // filled the old 27-wide route column and the cron ran into it with no space; the next longer
  // key would have overlapped it. A table that silently stops being a table is a bad place to read
  // a verdict off.
  const routeW = Math.max(27, ...[...rows, ...intentRows].map((r) => String(r.key).length + 2));
  console.log("ET-GATED CRON — DST ALIGNMENT");
  console.log("EventBridge classic Rules fire on FIXED UTC (no timezone support). EDT = UTC-4, EST = UTC-5.\n");
  console.log(pad("route", routeW) + pad("deployed UTC cron", 30) + pad("EDT", 6) + pad("EST", 6) + "verdict");
  console.log("-".repeat(96));
  for (const r of rows) {
    console.log(pad(r.key, routeW) + pad(r.deployed_utc_cron, 30) + pad(r.edt_hits, 6) + pad(r.est_hits, 6) + r.verdict);
  }
  console.log("\nPER-ROUTE DETAIL");
  for (const r of rows) {
    console.log(`\n  ${r.key}  [${r.verdict}]`);
    console.log(`    deployed (EventBridge) : ${r.deployed_utc_cron ?? "(none — unscheduled)"}`);
    console.log(`    source (railway toml)  : ${r.railway_source_cron ?? "(none)"}`);
    console.log(`    registry mirror        : ${r.registry_mirror_cron ?? "(none)"}   label: ${r.registry_label ?? "(none)"}`);
    console.log(`    gates on               : ${r.gates_on}`);
    console.log(`    gate source            : ${r.gate_src}`);
    if (r.total_fires_per_week != null) console.log(`    fires/week             : ${r.total_fires_per_week}  →  in-window EDT ${r.edt_hits} · EST ${r.est_hits}`);
    console.log(`    ${r.note}`);
  }
  console.log("\n\nCHECK B — ET INTENT (routes with NO ET gate: they still run, just at the wrong ET time)");
  console.log(pad("route", routeW) + pad("deployed UTC cron", 27) + pad("ET span EDT", 15) + pad("ET span EST", 15) + "verdict");
  console.log("-".repeat(96));
  for (const r of intentRows) {
    console.log(pad(r.key, routeW) + pad(r.deployed_utc_cron, 27) + pad(r.edt_et_span, 15) + pad(r.est_et_span, 15) + r.verdict);
  }
  for (const r of intentRows) {
    if (r.verdict === "OK") continue;
    console.log(`\n  ${r.key}  [${r.verdict}]  declared: ${r.declared_label}`);
    console.log(`    ${r.note}`);
    console.log(`    why it matters: ${r.why}`);
  }

  if (mismatches.length) {
    console.log(
    `\nCOVERAGE — ${manifest.size - unaudited.length} of ${manifest.size} deployed jobs are in GATES or INTENTS`
  );
  if (unaudited.length) {
    console.log(
      `  ${unaudited.length} deployed job(s) are in NEITHER table. They are UNAUDITED, not OK — this ` +
        `run says nothing about them:`
    );
    for (const k of unaudited) console.log(`    ${k}`);
    console.log(
      "  Add each to GATES (it applies an ET gate) or INTENTS (it has an ET-relative intent, or is " +
        "UTC-labelled and should say so), after reading its route. Absence from both tables is a gap " +
        "in this audit, never a verdict about the job."
    );
  }
  console.log("\nREGISTRY `schedule_cron_utc` vs DEPLOYED MANIFEST");
    for (const m of mismatches) console.log(`  ${pad(m.key, 27)} registry=${pad(m.registry, 26)} deployed=${pad(m.deployed, 26)} — ${m.kind}`);
  }
}

const broken = [...rows, ...intentRows].filter((r) => r.verdict === "BROKEN" || r.verdict === "EARLY UNDER EST" || r.verdict === "EARLY" || r.verdict === "BAND GAP");
process.exit(broken.length ? 1 : 0);
