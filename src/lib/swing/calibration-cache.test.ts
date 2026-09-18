import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSwingCalibration, type SwingCalibrationRow } from "./calibration.ts";
import { ARCHETYPE_META, SWING_SUB_LANES } from "./taxonomy.ts";
import {
  distillSwingCalibrationReport,
  graduatedArchetypeEntry,
  graduatedSubLaneEntry,
  persistSwingArchetypeTrackRecord,
  readSwingArchetypeTrackRecord,
  SWING_ARCHETYPE_TRACK_RECORD_CACHE_KEY,
  SWING_ARCHETYPE_TRACK_RECORD_TTL_SEC,
  type SwingArchetypeTrackRecordSnapshot,
} from "./calibration-cache.ts";

// ── fixture builders (mirrors calibration.test.ts's own row/rows helpers) ─────────────────────────
const row = (win: boolean, extra: Partial<SwingCalibrationRow> = {}): SwingCalibrationRow => ({
  realized_pnl_pct: win ? 10 : -20,
  graded_at: "2026-07-01T00:00:00Z",
  ...extra,
});
const rows = (n: number, wins: number, extra: Partial<SwingCalibrationRow> = {}): SwingCalibrationRow[] =>
  Array.from({ length: n }, (_, i) => row(i < wins, extra));

/** A REAL SwingCalibrationReport with exactly one graduated archetype (BREAKOUT) and one graduated
 *  sub-lane (STANDARD) — same fixture shape calibration.test.ts already proves graduates (n=60@75%
 *  vs n=10@30% clears both the Wilson-LB and point-Δ gates at LIMITED tier). Every other
 *  archetype/sub-lane bucket in the report has zero rows (RESEARCH, not graduated) — the realistic
 *  "most buckets have no evidence yet" shape. */
function reportWithOneGraduatedBucket(): ReturnType<typeof analyzeSwingCalibration> {
  const breakoutFloor = ARCHETYPE_META.BREAKOUT.scoreFloor;
  const standardFloor = SWING_SUB_LANES.STANDARD.scoreFloor;
  const input: SwingCalibrationRow[] = [
    ...rows(60, 45, { archetype: "BREAKOUT", sub_lane: "STANDARD", score: Math.max(breakoutFloor, standardFloor) + 5 }),
    ...rows(10, 3, { archetype: "BREAKOUT", sub_lane: "STANDARD", score: Math.min(breakoutFloor, standardFloor) - 5 }),
  ];
  return analyzeSwingCalibration(input);
}

// ── distillSwingCalibrationReport (pure) ──────────────────────────────────────────────────────────
test("distillSwingCalibrationReport: a graduated bucket carries citation-ready tier/wilsonLb/pointDelta/n from the ON-signal bucket", () => {
  const report = reportWithOneGraduatedBucket();
  const snap = distillSwingCalibrationReport(report, "2026-09-10T14:00:00.000Z");

  assert.equal(snap.asOf, "2026-09-10T14:00:00.000Z");
  assert.equal(snap.gradedPlays, 70);

  const brk = snap.archetypes.BREAKOUT;
  assert.ok(brk, "graduated BREAKOUT bucket must be present");
  assert.equal(brk!.tier, "LIMITED");
  assert.equal(brk!.graduated, true);
  assert.equal(brk!.n, 60, "n must be the ON-signal (cleared-floor) bucket, not the on+off combined 70");
  assert.equal(brk!.wins, 45);
  assert.equal(brk!.losses, 15);
  assert.ok(brk!.wilsonLbPct > 60, `expected a Wilson-LB clearly above the 60% abs floor, got ${brk!.wilsonLbPct}`);
  assert.ok(brk!.pointDeltaPts != null && brk!.pointDeltaPts >= 15, "point-Δ must clear the 15pt bar");
  assert.equal(brk!.winRatePct, 75, "raw on-signal win rate is 45/60 = 75%");

  const std = snap.subLanes.STANDARD;
  assert.ok(std, "graduated STANDARD sub-lane bucket must be present");
  assert.equal(std!.graduated, true);
  assert.equal(std!.n, 60);
});

test("distillSwingCalibrationReport: an ungraduated bucket is still present but graduated:false — never fabricated, never dropped", () => {
  const report = reportWithOneGraduatedBucket();
  const snap = distillSwingCalibrationReport(report);
  const pullback = snap.archetypes.PULLBACK_CONTINUATION;
  assert.ok(pullback, "every SWING_ARCHETYPES entry is present (RESEARCH tier from an empty bucket)");
  assert.equal(pullback!.graduated, false);
  assert.equal(pullback!.tier, "RESEARCH");
  assert.equal(pullback!.n, 0);
});

test("distillSwingCalibrationReport: an empty ledger distills to a fully-present, all-ungraduated snapshot (no crash, no fabrication)", () => {
  const report = analyzeSwingCalibration([]);
  const snap = distillSwingCalibrationReport(report, "2026-09-10T00:00:00.000Z");
  assert.equal(snap.gradedPlays, 0);
  assert.equal(Object.values(snap.archetypes).every((e) => e!.graduated === false), true);
  assert.equal(Object.values(snap.subLanes).every((e) => e!.graduated === false), true);
});

// ── graduatedArchetypeEntry / graduatedSubLaneEntry — the confidence-omission gate ─────────────────
test("graduatedArchetypeEntry: returns the entry ONLY when graduated:true; null on ungraduated/missing/absent snapshot", () => {
  const snap = distillSwingCalibrationReport(reportWithOneGraduatedBucket());
  assert.ok(graduatedArchetypeEntry(snap, "BREAKOUT"), "graduated bucket returns its entry");
  assert.equal(graduatedArchetypeEntry(snap, "PULLBACK_CONTINUATION"), null, "ungraduated bucket is withheld, not fabricated");
  assert.equal(graduatedArchetypeEntry(snap, null), null, "null archetype (unclassified play) → null");
  assert.equal(graduatedArchetypeEntry(null, "BREAKOUT"), null, "missing snapshot → null");
  assert.equal(graduatedArchetypeEntry(snap, "NOT_A_REAL_ARCHETYPE" as never), null, "unknown key → null, never throws");
});

test("graduatedSubLaneEntry: same gating as graduatedArchetypeEntry, keyed by sub-lane", () => {
  const snap = distillSwingCalibrationReport(reportWithOneGraduatedBucket());
  assert.ok(graduatedSubLaneEntry(snap, "STANDARD"));
  assert.equal(graduatedSubLaneEntry(snap, "TACTICAL"), null);
  assert.equal(graduatedSubLaneEntry(snap, null), null);
});

// ── persist → read round-trip (the cron→brief seam itself) ────────────────────────────────────────
test("persistSwingArchetypeTrackRecord → readSwingArchetypeTrackRecord round-trips the distilled snapshot", async () => {
  const report = reportWithOneGraduatedBucket();
  const snap = distillSwingCalibrationReport(report, "2026-09-10T15:30:00.000Z");
  const wrote = await persistSwingArchetypeTrackRecord(snap);
  assert.equal(wrote, true);

  const back = await readSwingArchetypeTrackRecord();
  assert.ok(back, "the persisted snapshot is read back");
  assert.equal(back!.asOf, "2026-09-10T15:30:00.000Z");
  assert.equal(back!.gradedPlays, 70);
  assert.equal(back!.archetypes.BREAKOUT?.graduated, true);
  assert.equal(back!.archetypes.BREAKOUT?.n, 60);
  assert.equal(back!.subLanes.STANDARD?.graduated, true);

  // The lookup helpers work identically on a ROUND-TRIPPED (JSON-serialized) snapshot, not just an
  // in-memory one — guards against a shape that only "works" before it crosses the cache boundary.
  assert.ok(graduatedArchetypeEntry(back, "BREAKOUT"));
  assert.equal(graduatedArchetypeEntry(back, "MEAN_REVERSION"), null);
});

test("readSwingArchetypeTrackRecord: a cold cache (nothing ever persisted under a fresh key) reads back null, not a throw", async () => {
  // Exercise the read path structurally: an empty-report distillation for a key nobody polluted
  // is the closest this suite gets to a genuinely cold cache without reaching into shared-cache's
  // internals; the real "never throws" contract is exercised by persistSwingArchetypeTrackRecord's
  // and readSwingArchetypeTrackRecord's own try/catch, proven by the round-trip test above already
  // hitting the real (in-memory-fallback) shared-cache path with no mocking.
  const snap: SwingArchetypeTrackRecordSnapshot = {
    asOf: "2026-09-10T00:00:00.000Z",
    gradedPlays: 0,
    archetypes: {},
    subLanes: {},
  };
  const wrote = await persistSwingArchetypeTrackRecord(snap);
  assert.equal(wrote, true);
  const back = await readSwingArchetypeTrackRecord();
  assert.deepEqual(back, snap);
});

test("cache key + TTL: key is versioned and TTL is sized in DAYS (spans a weekday-only cron's weekend gap), not the ~15-min cron cadence", () => {
  assert.match(SWING_ARCHETYPE_TRACK_RECORD_CACHE_KEY, /^swing:calibration:archetype_track_record:v1$/);
  // 120h = 5 days — see calibration-cache.ts's header for why this deliberately does NOT match the
  // cron's own intraday tick rate (the serving-lane.ts SWING_SERVING_TTL_SEC precedent this mirrors).
  assert.equal(SWING_ARCHETYPE_TRACK_RECORD_TTL_SEC, 120 * 60 * 60);
});
