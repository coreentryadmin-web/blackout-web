import test from "node:test";
import assert from "node:assert/strict";
import { buildVisualBundle, playbookFromEdition } from "./bundle";
import { routeVisual } from "./router";
import { bookStats, playbookCapacity, playbookRenderOrder } from "./templates/playbook";
import { sizeSpec } from "./sizes";
import type { VisualBundle } from "./types";

/**
 * PLAYBOOK — the forward runbook.
 *
 * THE LIVE FAILURE THESE PIN. "Give me tomorrows NH legacy plays" produced a correct five-play
 * ANSWER beside a card carrying one ticker and one number ($13.35) on an otherwise blank canvas.
 * Three independent defects stacked, and each has its own test below:
 *
 *   1. `findLedgerRows(results)[0]` — five published plays, one kept, four dropped in silence.
 *   2. An edition play is a PLAN (entry_range/target/stop). TRADE_RECAP reads a TRADE
 *      (last_mark/live_pnl_pct/status). Every field but the entry resolved null.
 *   3. There was no multi-play template in the library at all.
 *
 * The safety assertions — pulled plays surviving truncation, gate-promoted plays badged — matter
 * more than the layout ones. A runbook that drops a withdrawn play instructs a member into a trade
 * the desk has publicly pulled.
 */

const play = (over: Record<string, unknown> = {}) => ({
  rank: 1,
  ticker: "NVDA",
  direction: "long",
  entry_range: "$217.10-218.40",
  target: "$224.00",
  stop: "$213.80",
  options_play: "Aug 12 217.5C",
  entry_premium: 2.42,
  rr_ratio: 2.1,
  target_atr_multiple: 1.2,
  ...over,
});

const edition = (plays: Record<string, unknown>[], over: Record<string, unknown> = {}) => ({
  available: true,
  edition_for: "2026-08-11",
  published_at: "2026-08-10T23:10:21Z",
  plays,
  ...over,
});

// ── The truncation bug ──────────────────────────────────────────────────────────────────────

test("EVERY published play reaches the bundle — not just the first", () => {
  const five = Array.from({ length: 5 }, (_, i) => play({ rank: i + 1, ticker: `T${i}` }));
  const b = buildVisualBundle({ capturedResults: [edition(five)], nowMs: 0 });
  assert.equal(b.playbook?.rows.length, 5, "all five plays, not `rows[0]`");
  assert.equal(b.playbook?.totalPlays, 5);
});

test("an edition is NOT read as a trade — the plan/trade confusion", () => {
  const b = buildVisualBundle({ capturedResults: [edition([play()])], nowMs: 0 });
  assert.equal(b.trade, null, "a published play must not populate the trade block");
  assert.ok(b.playbook, "it populates the playbook instead");
});

test("a committed ledger row is still read as a trade", () => {
  // The exclusion above must be narrow. A real 0DTE ledger payload carries no edition markers, so
  // it must keep flowing to TRADE_RECAP exactly as before.
  const b = buildVisualBundle({
    capturedResults: [{ rows: [{ ticker: "SPXW", direction: "long", entry_premium: 4.2, last_mark: 6.1, status: "OPEN" }] }],
    nowMs: 0,
  });
  assert.equal(b.trade?.ticker, "SPXW");
  assert.equal(b.playbook, null);
});

test("an unpublished edition is not an empty playbook", () => {
  const b = buildVisualBundle({ capturedResults: [edition([], { available: false })], nowMs: 0 });
  assert.equal(b.playbook, null, "`available: false` is the absence of a book, not a book of none");
});

// ── Safety: pulled and gate-promoted ────────────────────────────────────────────────────────

test("a PULLED play survives truncation — it is rendered FIRST", () => {
  // The row a member most needs is the one that changes what they do. Ranked 5th, it would be the
  // first casualty of a 3-row landscape cap.
  const rows = playbookFromEdition(
    edition([
      play({ rank: 1, ticker: "A" }),
      play({ rank: 2, ticker: "B" }),
      play({ rank: 3, ticker: "C" }),
      play({ rank: 4, ticker: "D" }),
      play({ rank: 5, ticker: "NET", pulled: true, pulled_reason: "band detached" }),
    ])
  )!.rows;
  const shown = playbookRenderOrder(rows, 3);
  assert.equal(shown[0]!.ticker, "NET", "the pulled play leads");
  assert.equal(shown[0]!.rank, 5, "and keeps its published rank, so the ordering is not misstated");
  assert.equal(shown.length, 3);
});

test("a pulled play with NO levels is still kept", () => {
  // Levels are what makes a play actionable; a withdrawal is actionable without them.
  const pb = playbookFromEdition(
    edition([play({ ticker: "X", entry_range: null, target: null, stop: null, pulled: true, pulled_reason: "gapped" })])
  );
  assert.equal(pb?.rows.length, 1);
});

test("a NON-pulled play with no levels at all is dropped, and the drop is visible", () => {
  const pb = playbookFromEdition(
    edition([play({ ticker: "GOOD" }), play({ rank: 2, ticker: "BARE", entry_range: null, target: null, stop: null })])
  )!;
  assert.equal(pb.rows.length, 1, "an unactionable row is not drawn");
  assert.equal(pb.totalPlays, 2, "but the published count still reports it, so the card says 1 of 2");
});

test("gate-promoted and earnings-risk flags are carried, not flattened", () => {
  const pb = playbookFromEdition(edition([play({ gate_promoted: true, earnings_risk: true })]))!;
  assert.equal(pb.rows[0]!.gatePromoted, true);
  assert.equal(pb.rows[0]!.earningsRisk, true);
});

test("stale / degraded / no_plays provenance reaches the card", () => {
  const pb = playbookFromEdition(edition([play()], { stale: true, degraded: true, no_plays: true }))!;
  assert.equal(pb.stale, true);
  assert.equal(pb.degraded, true);
  assert.equal(pb.noPlays, true);
});

// ── Book arithmetic ─────────────────────────────────────────────────────────────────────────

test("book cost EXCLUDES pulled plays and states its unit", () => {
  const pb = playbookFromEdition(
    edition([
      play({ rank: 1, ticker: "A", entry_premium: 2.0, rr_ratio: 2.0 }),
      play({ rank: 2, ticker: "B", entry_premium: 3.0, rr_ratio: 1.0 }),
      play({ rank: 3, ticker: "C", entry_premium: 50.0, rr_ratio: 9.0, pulled: true, pulled_reason: "x" }),
    ])
  )!;
  const st = bookStats(pb.rows);
  // (2.00 + 3.00) × 100 — the $50 pulled play is capital you would NOT deploy.
  assert.equal(st.costPerLot, 500);
  assert.equal(st.avgRr, 1.5);
  assert.equal(st.actionable, 2);
  assert.equal(st.pulledCount, 1);
});

test("missing inputs yield null, never zero", () => {
  const pb = playbookFromEdition(
    edition([play({ entry_premium: undefined, rr_ratio: undefined, target_atr_multiple: undefined })])
  )!;
  const st = bookStats(pb.rows);
  // "$0" would read as free rather than as unknown — the bundle's standing omission rule.
  assert.equal(st.costPerLot, null);
  assert.equal(st.avgRr, null);
  assert.equal(st.widestTargetAtr, null);
});

test("furthest target is the MAX, not the mean — the unreachable one must not average away", () => {
  const pb = playbookFromEdition(
    edition([
      play({ rank: 1, ticker: "A", target_atr_multiple: 0.8 }),
      play({ rank: 2, ticker: "B", target_atr_multiple: 0.9 }),
      play({ rank: 3, ticker: "C", target_atr_multiple: 3.4 }),
    ])
  )!;
  assert.equal(bookStats(pb.rows).widestTargetAtr, 3.4);
});

// ── Layout ──────────────────────────────────────────────────────────────────────────────────

test("every surface has capacity for at least three plays", () => {
  for (const id of ["x_landscape", "x_portrait", "square", "story"] as const) {
    assert.ok(playbookCapacity(sizeSpec(id)) >= 3, `${id} must fit a usable book`);
  }
});

test("levels are quoted VERBATIM from the engine, never reformatted", () => {
  const pb = playbookFromEdition(edition([play({ entry_range: "$217.10–218.40", target: "$224.00" })]))!;
  assert.equal(pb.rows[0]!.entryRange, "$217.10–218.40", "including the en dash the engine chose");
  assert.equal(pb.rows[0]!.target, "$224.00", "including trailing zeros");
});

// ── End to end ──────────────────────────────────────────────────────────────────────────────

test("the live question routes to PLAYBOOK and carries all five plays", () => {
  const five = ["NVDA", "CRM", "AXON", "UBER", "NET"].map((t, i) => play({ rank: i + 1, ticker: t }));
  const bundle: VisualBundle = buildVisualBundle({ capturedResults: [edition(five)], nowMs: 0 });
  const route = routeVisual("Give me tomorrows NH legacy plays", bundle, "AUTO");
  assert.equal(route?.template, "PLAYBOOK");
  assert.equal(route?.matchedIntent, true);
  assert.deepEqual(
    bundle.playbook!.rows.map((r) => r.ticker),
    ["NVDA", "CRM", "AXON", "UBER", "NET"],
  );
});
