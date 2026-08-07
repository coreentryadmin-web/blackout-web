import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NIGHTHAWK_VIEWS,
  DEFAULT_NIGHTHAWK_VIEW,
  parseNightHawkView,
  horizonForView,
  viewForHorizon,
  isNightHawkView,
  NIGHTHAWK_VIEW_META,
  TARGET_HIT_RATE_LABEL,
  targetHitCompositionLabel,
  NIGHTHAWK_COMPACT_LANE_LABEL,
  MAX_COMPACT_LANE_LABEL_LEN,
} from "./nighthawk-view.ts";

test("the toggle has exactly four views in fast→slow→banger→legacy order", () => {
  assert.deepEqual([...NIGHTHAWK_VIEWS], ["ZERO_DTE", "SWING", "BANGER", "LEGACY"]);
});

test("parseNightHawkView resolves aliases case-insensitively, else the default", () => {
  assert.equal(parseNightHawkView("0dte"), "ZERO_DTE");
  assert.equal(parseNightHawkView("ZeroDte"), "ZERO_DTE");
  assert.equal(parseNightHawkView("swings"), "SWING");
  assert.equal(parseNightHawkView("banger"), "BANGER");
  assert.equal(parseNightHawkView("bangers"), "BANGER");
  assert.equal(parseNightHawkView("weekly"), "BANGER");
  assert.equal(parseNightHawkView("playbook"), "LEGACY");
  assert.equal(parseNightHawkView("tonight"), "LEGACY");
  assert.equal(parseNightHawkView("nonsense"), DEFAULT_NIGHTHAWK_VIEW);
  assert.equal(parseNightHawkView(null), DEFAULT_NIGHTHAWK_VIEW);
  // LEAPS was removed from the visible toggle (2026-08-04) — a stale/shared ?view=leaps link falls
  // back to the default rather than erroring (the horizon-ledger LEAPS id itself is untouched).
  assert.equal(parseNightHawkView("leaps"), DEFAULT_NIGHTHAWK_VIEW);
  assert.equal(parseNightHawkView("leap"), DEFAULT_NIGHTHAWK_VIEW);
});

test("horizonForView maps the two horizon views, and null for legacy/banger", () => {
  assert.equal(horizonForView("ZERO_DTE"), "ZERO_DTE");
  assert.equal(horizonForView("SWING"), "SWING");
  assert.equal(horizonForView("BANGER"), null);
  assert.equal(horizonForView("LEGACY"), null);
});

test("viewForHorizon round-trips the live views, and returns null for the delisted LEAPS horizon", () => {
  assert.equal(viewForHorizon("ZERO_DTE"), "ZERO_DTE");
  assert.equal(viewForHorizon("SWING"), "SWING");
  assert.equal(viewForHorizon("LEAPS"), null);
});

test("isNightHawkView guards the union", () => {
  assert.ok(isNightHawkView("SWING"));
  assert.ok(!isNightHawkView("swing")); // exact union member only
  assert.ok(!isNightHawkView(42));
});

test("every view has renderable meta (label/tag/blurb)", () => {
  for (const v of NIGHTHAWK_VIEWS) {
    const m = NIGHTHAWK_VIEW_META[v];
    assert.ok(m.label && m.tag && m.blurb, `${v} needs full meta`);
  }
  assert.equal(NIGHTHAWK_VIEW_META.LEGACY.label, "Legacy");
  assert.equal(NIGHTHAWK_VIEW_META.SWING.label, "Swings");
});

// Regression for the live overlap bug (2026-08-06): the compact command-center header
// (`.nh-deck-cmd-lane`, CommandDeck's `laneLabel` prop) sits in a flex container that can shrink
// narrower than its own non-wrapping content on a mobile viewport, and overflow:visible lets an
// over-length label bleed its pixels over the adjacent stat pills instead of wrapping/clipping.
// The old Legacy literal "Legacy · Tonight's playbook" (27 chars) was the only one of the four
// lane labels long enough to trigger it. This is a length TRIPWIRE on the shared vocabulary, not
// a re-test of the CSS itself — it fails loudly if a future edit lets any lane's label creep back
// past the bound confirmed safe at the narrowest supported (430px) viewport.
test("every compact lane label stays within the overlap-safe length bound", () => {
  for (const [lane, label] of Object.entries(NIGHTHAWK_COMPACT_LANE_LABEL)) {
    assert.ok(
      label.length <= MAX_COMPACT_LANE_LABEL_LEN,
      `${lane} label "${label}" is ${label.length} chars, over the ${MAX_COMPACT_LANE_LABEL_LEN}-char safe bound`,
    );
  }
});

test("the Legacy compact lane label is the shortened, non-overlapping string", () => {
  assert.equal(NIGHTHAWK_COMPACT_LANE_LABEL.LEGACY, "Legacy · Playbook");
});

// ── Target-hit rate labelling + the admin ring's win COUNT (2026-08-06) ───────────────

test("the headline metric is named for what it measures — a target touch, not a 'win'", () => {
  // The label is shared by the admin ring and the member record strip so the two surfaces
  // cannot drift into describing the same number differently.
  assert.equal(TARGET_HIT_RATE_LABEL, "Target-hit rate");
  assert.doesNotMatch(TARGET_HIT_RATE_LABEL, /^win rate$/i);
});

test("targetHitCompositionLabel reports the REAL win count, not rate × the wrong denominator", () => {
  // The live 30-day shape: 22 scoreable = 0 wins + 2 losses + 20 opens, out of 52 resolved.
  // The old admin ring rendered `Math.round(win_rate * total_resolved)` — a rate over
  // `scoreable` (22) times a count over ALL resolved rows (52). At today's 0% that is
  // 0 × 52 = 0, which is accidentally correct and hid the bug.
  assert.equal(
    targetHitCompositionLabel({ wins: 0, losses: 2, opens: 20, scoreable: 22 }),
    "0W / 2L / 20 open · 22 scoreable"
  );

  // The regression the old arithmetic would have shipped the moment a target landed:
  // 7 wins of 22 scoreable is a 31.8% rate, and 31.8% × 52 resolved = 17 — a 2.4×
  // overstatement of a headline number. The composition reports 7, from the segment
  // that produced the rate.
  const seg = { wins: 7, losses: 2, opens: 13, scoreable: 22 };
  const oldBuggyCount = Math.round((seg.wins / seg.scoreable) * 52);
  assert.equal(oldBuggyCount, 17, "documents the old arithmetic so the fix is unambiguous");
  assert.match(targetHitCompositionLabel(seg), /^7W /);
  assert.doesNotMatch(targetHitCompositionLabel(seg), /17/);

  // The composition must always add up to the denominator it is shown against.
  assert.equal(seg.wins + seg.losses + seg.opens, seg.scoreable);
});

// FINDINGS 2026-08-07: every DTE-range string in the product was a hand-written literal, so the
// 2026-08-06 window widening (0DTE -> [0,4], Swing floor -> ZERODTE_MAX_DTE+1) left the toggle
// chip, the compact lane header, the cron description and four Largo strings all telling members
// "2-30 DTE" against an engine that would not admit a 2-, 3- or 4-DTE swing. These pin the
// derivation, not the current numbers — the whole point is that the numbers may change again.
test("lane labels DERIVE their DTE range from HORIZONS, never a literal", async () => {
  const { HORIZONS, dteRangeLabel } = await import("@/lib/horizons");
  for (const horizon of ["ZERO_DTE", "SWING", "LEAPS"] as const) {
    const h = HORIZONS[horizon];
    assert.equal(dteRangeLabel(horizon), `${h.dteMin}–${h.dteMax} DTE`);
  }
  // The two member-facing Swing surfaces must agree with the engine window, whatever it is.
  const range = dteRangeLabel("SWING");
  assert.ok(
    NIGHTHAWK_COMPACT_LANE_LABEL.SWING.includes(range),
    `compact lane label "${NIGHTHAWK_COMPACT_LANE_LABEL.SWING}" does not carry the live window ${range}`
  );
  assert.ok(
    NIGHTHAWK_VIEW_META.SWING.blurb.includes(range),
    `toggle blurb "${NIGHTHAWK_VIEW_META.SWING.blurb}" does not carry the live window ${range}`
  );
});

test("no lane label hardcodes a stale DTE window", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const src = readFileSync(fileURLToPath(new URL("./nighthawk-view.ts", import.meta.url)), "utf8");
  // A bare "N–M DTE" literal is exactly what drifted. Ranges must come through dteRangeLabel().
  const literals = src.match(/\d+–\d+ DTE/g) ?? [];
  assert.deepEqual(literals, [], `hardcoded DTE ranges found: ${literals.join(", ")}`);
});

test("the 0DTE blurb does not promise same-day EXPIRIES — the window admits 0-4 DTE contracts", () => {
  // horizons.ts: a 0DTE play is "opened and closed within the session, REGARDLESS of the selected
  // contract's own expiration date". A member seeing a Friday-expiry contract on a board that says
  // "same-day expiries" reasonably reports it as a bug.
  assert.ok(!/same-day expir/i.test(NIGHTHAWK_VIEW_META.ZERO_DTE.blurb), NIGHTHAWK_VIEW_META.ZERO_DTE.blurb);
});
