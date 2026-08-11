import test from "node:test";
import assert from "node:assert/strict";
import { buildVisualBundle, tradeFromLedgerRow, timelineFromLedgerRow, fmtPct, fmtUsd, fmtEtTime, fmtPrice } from "./bundle";

const NOW = Date.parse("2026-08-10T14:38:30Z");

/** Shaped like the real `getGexPositioning` payload. */
const POSITIONING = {
  gamma_posture: "short",
  spot: 7757.58,
  gamma_flip: 7764.93,
  call_wall: 7800,
  put_wall: 7725,
  max_pain: 7675,
  asof: "2026-08-10T14:38:22Z",
};

/** Shaped like the real flow tape. */
const FLOW = {
  recent: [
    { premium: 30_000_000, option_type: "CALL" },
    { premium: 5_000_000, option_type: "PUT" },
    ...Array.from({ length: 20 }, () => ({ premium: 1_000_000, option_type: "CALL" })),
  ],
};

test("formatters return NULL rather than a placeholder — absent is not a value", () => {
  assert.equal(fmtPct(null), null);
  assert.equal(fmtUsd(null), null);
  assert.equal(fmtPrice(null), null);
  assert.equal(fmtEtTime(null), null);
  assert.equal(fmtEtTime("not-a-date"), null, "an unparseable stamp must never become a fake time");
});

test("percent uses a TRUE minus sign, matching the desk's own formatter", () => {
  assert.equal(fmtPct(-0.42), "−0.42%");
  assert.equal(fmtPct(0.55), "+0.55%");
  // U+2212, not the ASCII hyphen.
  assert.ok(fmtPct(-1)!.startsWith("−"));
});

test("compact dollars are signed and scale-aware", () => {
  assert.equal(fmtUsd(41_200_000), "+$41.2M");
  assert.equal(fmtUsd(-293_600_000), "−$293.6M");
  assert.equal(fmtUsd(7_030_000_000), "+$7.0B");
});

test("the bundle is built from captured results, with levels sourced and distanced", () => {
  const b = buildVisualBundle({ capturedResults: [POSITIONING, FLOW], nowMs: NOW, headline: "Dealers short gamma" });
  assert.equal(b.spot!.display, "7,757.58");
  assert.equal(b.spot!.source, "THERMAL");
  const labels = b.levels!.map((l) => l.label);
  assert.deepEqual(labels, ["Call wall", "Gamma flip", "Put wall", "Max pain"]);
  const putWall = b.levels!.find((l) => l.label === "Put wall")!;
  assert.equal(putWall.kind, "support");
  assert.equal(putWall.distance, "−0.42%");
  assert.equal(putWall.source, "THERMAL");
});

test("ABSENT DATA OMITS THE COMPONENT — never zero, never a placeholder", () => {
  // A positioning payload with only a posture: no walls, no flip, no spot.
  const b = buildVisualBundle({ capturedResults: [{ gamma_posture: "long" }], nowMs: NOW });
  assert.equal(b.spot, null);
  assert.deepEqual(b.levels, [], "no levels rather than zero-priced rows");
  assert.equal(b.gexShifts, undefined);
  assert.equal(b.trade, null);
  // The one thing that WAS present still renders.
  assert.equal(b.regime!.label, "LONG");
});

test("an empty bundle is a valid result — it simply means no visual", () => {
  const b = buildVisualBundle({ capturedResults: [], nowMs: NOW });
  assert.equal(b.spot, null);
  assert.deepEqual(b.levels, []);
  assert.deepEqual(b.metrics, []);
  assert.deepEqual(b.systemsQueried, []);
});

test("flow stance uses net/gross — a weak net inside a large gross is not a direction", () => {
  // Mirrors the threshold system-reads.ts applies, so the card and the consensus strip agree.
  const churn = {
    recent: [
      { premium: 100_000_000, option_type: "CALL" },
      { premium: 95_000_000, option_type: "PUT" },
    ],
  };
  const b = buildVisualBundle({ capturedResults: [churn], nowMs: NOW });
  assert.equal(b.systemReads!.find((r) => r.system === "HELIX")!.stance, "neutral");

  const oneSided = buildVisualBundle({ capturedResults: [FLOW], nowMs: NOW });
  assert.equal(oneSided.systemReads!.find((r) => r.system === "HELIX")!.stance, "bullish");
});

test("freshness is derived from the data's own stamp, not the render clock", () => {
  const fresh = buildVisualBundle({ capturedResults: [POSITIONING], nowMs: NOW });
  assert.equal(fresh.freshness, "live");
  assert.equal(fresh.asOf, "2026-08-10T14:38:22.000Z", "the SNAPSHOT instant, not now");

  const old = buildVisualBundle({ capturedResults: [POSITIONING], nowMs: NOW + 20 * 60_000 });
  assert.equal(old.freshness, "stale");

  const unknown = buildVisualBundle({ capturedResults: [{ gamma_posture: "short", spot: 1 }], nowMs: NOW });
  assert.equal(unknown.freshness, "unknown", "no stamp must never read as fresh");
});

// ── Trade honesty ─────────────────────────────────────────────────────────────────────────

test("AN UNGRADED ROW NEVER CARRIES AN OUTCOME — the record-honesty rule on a marketing surface", () => {
  const closedButUngraded = {
    ticker: "FSLY",
    direction: "long",
    entry_premium: 1.08,
    last_mark: 1.73,
    live_pnl_pct: 60.19,
    exit_pnl_pct: 60.19,
    status: "CLOSED",
    plan_outcome: "doubled",
    graded: false,
  };
  const t = tradeFromLedgerRow(closedButUngraded)!;
  assert.equal(t.graded, false);
  assert.equal(t.outcome, null, "no outcome label until the ledger has graded it");
  // The return shown is the LIVE mark, which the template labels "Live mark-to-market".
  assert.equal(t.returnPct!.display, "+60.2%");

  const graded = tradeFromLedgerRow({ ...closedButUngraded, graded: true })!;
  assert.equal(graded.outcome, "doubled");
});

test("a row with no entry is not a trade", () => {
  assert.equal(tradeFromLedgerRow({ ticker: "MU", direction: "long" }), null);
  assert.equal(tradeFromLedgerRow({ entry_premium: 3.18 }), null, "no ticker either");
});

test("real ledger keys are read — a wrong key and a dead lane look identical in output", () => {
  // These exact names were verified live against prod after an earlier probe guessed `mark` /
  // `plan_pnl_pct` and read blank for every field.
  const row = { ticker: "MU", direction: "long", entry_premium: 3.18, last_mark: 4.2, live_pnl_pct: 32.1, mark_as_of: "2026-08-10T15:00:00Z" };
  const t = tradeFromLedgerRow(row)!;
  assert.equal(t.entry!.display, "$3.18");
  assert.equal(t.exit!.display, "$4.20");
  assert.equal(t.returnPct!.display, "+32.1%");
  assert.equal(t.exit!.asOf, "2026-08-10T15:00:00Z");
});

test("direction is read from the row, and a put reads short", () => {
  assert.equal(tradeFromLedgerRow({ ticker: "X", entry_premium: 1, direction: "short" })!.direction, "short");
  assert.equal(tradeFromLedgerRow({ ticker: "X", entry_premium: 1, direction: "put" })!.direction, "short");
  assert.equal(tradeFromLedgerRow({ ticker: "X", entry_premium: 1, direction: "long" })!.direction, "long");
});

test("TIMELINE STEPS REQUIRE A REAL TIMESTAMP — a fabricated entry time would be indefensible", () => {
  const steps = timelineFromLedgerRow({
    ticker: "META",
    detected_at: "2026-08-10T13:45:00Z",
    committed_at: "2026-08-10T14:02:06Z",
    closed_at: null, // still open
  });
  assert.deepEqual(steps.map((s) => s.label), ["Detected", "Committed"]);
  assert.equal(steps[1]!.time, "10:02", "ET, from the real stamp");

  // Garbage stamps produce NO steps rather than placeholder ones.
  assert.deepEqual(timelineFromLedgerRow({ detected_at: "soon", committed_at: undefined }), []);
});

test("the bundle finds a ledger row structurally and builds the trade from it", () => {
  const board = { rows: [{ ticker: "META", direction: "long", entry_premium: 5.5, live_pnl_pct: 12, graded: false }] };
  const b = buildVisualBundle({ capturedResults: [board], nowMs: NOW });
  assert.equal(b.trade!.ticker, "META");
  assert.ok(b.systemsQueried.includes("NIGHT HAWK"));
});

test("duplicate levels are not double-sourced", () => {
  const b = buildVisualBundle({
    capturedResults: [POSITIONING],
    nowMs: NOW,
    // The envelope also carries a call wall; it must not appear twice under two sources.
    envelopeLevels: [{ label: "Call wall", value: 7800 }, { label: "VWAP", value: 7750 }],
  });
  assert.equal(b.levels!.filter((l) => l.label === "Call wall").length, 1);
  assert.ok(b.levels!.some((l) => l.label === "VWAP"), "genuinely new levels still land");
});

test("the session-change metric reads the key production ACTUALLY emits", () => {
  // `toolQuote` (run-tool.ts) returns `change_pct`. `findQuote` read `change_percent`, `changePct`
  // and `percent_change` — none of them. `change_pct` appears at 28+ sites across polygon.ts,
  // polygon-options-gex.ts, gex-positioning.ts, spot-fallback.ts, unusual-whales.ts and
  // run-tool.ts itself; `changePct` appears twice. So this metric could not fire on a real payload
  // and did not: a live NVDA card built from 6 tools carried exactly one metric tile.
  const b = buildVisualBundle({
    capturedResults: [{ ticker: "NVDA", price: 219.95, change_pct: 1.83, source: "polygon" }],
    nowMs: Date.parse("2026-08-11T15:00:00Z"),
  });
  const session = b.metrics?.find((m) => m.label === "Session");
  assert.ok(session, "a quote carrying change_pct must produce the session metric");
  assert.equal(session!.value, "+1.83%");
});

test("the other spellings still work — this widened the read, it did not move it", () => {
  for (const key of ["change_percent", "changePct", "percent_change"]) {
    const b = buildVisualBundle({
      capturedResults: [{ ticker: "NVDA", price: 219.95, [key]: -0.42, source: "polygon" }],
      nowMs: Date.parse("2026-08-11T15:00:00Z"),
    });
    assert.ok(b.metrics?.some((m) => m.label === "Session"), `${key} must still be read`);
  }
});
