import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALWAYS_AGGREGATE_LEVELS,
  scopesAreMixed,
  thermalScopes,
  type ScopedThermalLevel,
} from "./meridian-thermal-scope";
import { structureLadder } from "./meridian-viz-core";

test("a usable event expiry scopes the walls and max pain — and NOT the king or the flip", () => {
  // The defect, stated as the thing that must stay true. On prod 2026-08-21 (BEKE, 0DTE print)
  // the panel showed "King node 19.00" and "Call wall 17.50" in one list under a badge reading
  // "Levels re-summed from the expiry that covers this print". Only the second was.
  const s = thermalScopes(true, 12);
  assert.equal(s.level_scopes.call_wall, "event_expiry");
  assert.equal(s.level_scopes.put_wall, "event_expiry");
  assert.equal(s.level_scopes.gamma_call_wall, "event_expiry");
  assert.equal(s.level_scopes.gamma_put_wall, "event_expiry");
  assert.equal(s.level_scopes.max_pain, "event_expiry");
  assert.equal(s.level_scopes.gex_king_strike, "aggregate");
  assert.equal(s.level_scopes.flip, "aggregate");
  assert.equal(s.structure_scope, "aggregate");
  assert.match(s.structure_scope_label, /whole-book aggregate across 12 near-term expiries/);
  assert.ok(scopesAreMixed(s), "this is precisely the case a panel must label level by level");
});

test("with no usable event expiry every level is aggregate, and nothing needs marking", () => {
  const s = thermalScopes(false, 12);
  for (const scope of Object.values(s.level_scopes)) assert.equal(scope, "aggregate");
  assert.equal(
    scopesAreMixed(s),
    false,
    "a uniformly whole-book ladder says so once, above — per-row marks would be noise"
  );
});

test("an absent expiry count is described, never invented", () => {
  // The sentence exists to say what a number is built from. A fabricated count in THAT sentence
  // is worse than no count: it is a false provenance claim on the field that claims provenance.
  for (const bad of [null, undefined, 0, Number.NaN, -3]) {
    const label = thermalScopes(false, bad as number).structure_scope_label;
    assert.match(label, /across several near-term expiries/, `count ${String(bad)} must not print`);
    assert.doesNotMatch(label, /\d/, `count ${String(bad)} must not produce a digit`);
  }
  assert.match(thermalScopes(false, 12).structure_scope_label, /across 12 /);
});

test("every level the payload declares has a scope — a missing one is not a scope", () => {
  // A UI that reads `level_scopes[x]` and gets undefined has to decide what undefined means, and
  // the last time that decision was implicit it resolved to "same as the badge", which is the bug.
  const s = thermalScopes(true, 4);
  const declared: ScopedThermalLevel[] = [
    "call_wall",
    "put_wall",
    "gamma_call_wall",
    "gamma_put_wall",
    "max_pain",
    "gex_king_strike",
    "flip",
  ];
  for (const level of declared) {
    assert.ok(s.level_scopes[level], `${level} has no declared scope`);
  }
  assert.deepEqual(
    Object.keys(s.level_scopes).sort(),
    [...declared].sort(),
    "the declared set and the emitted set must not drift apart"
  );
});

test("the intel builder still sources the always-aggregate levels from the whole book", () => {
  // A DRIFT GUARD, not a behaviour test. `thermalScopes` labels `gex_king_strike` and `flip` as
  // whole-book because meridian-earnings-intel.ts passes them through from `thermal.*` rather
  // than re-deriving them from `scoped.strikeTotals`. Re-scoping them is a good change to make
  // deliberately — but it must move the label in the same commit, and nothing else would notice.
  const src = readFileSync(
    join(process.cwd(), "src/lib/meridian/meridian-earnings-intel.ts"),
    "utf8"
  );
  const passthrough: Record<(typeof ALWAYS_AGGREGATE_LEVELS)[number], RegExp> = {
    gex_king_strike: /gex_king_strike:\s*thermal\.gex_king_strike\b/,
    flip: /\bflip:\s*thermal\.flip\b/,
  };
  for (const level of ALWAYS_AGGREGATE_LEVELS) {
    assert.match(
      src,
      passthrough[level],
      `${level} is no longer taken straight from the whole-book thermal — if it is now scoped ` +
        "to the event expiry, update thermalScopes() so the label follows the data"
    );
  }
  // ...and the walls ARE re-summed, which is what makes the two differ in the first place.
  assert.match(src, /call_wall:\s*walls\.call_wall\b/);
  assert.match(src, /max_pain:\s*scopeUsable\s*\?/);
});

test("structureLadder carries each level's scope through to the row that renders it", () => {
  // The mapping is keyed by the THERMAL field name, not the ladder key, so the payload's own
  // `level_scopes` can be passed straight through with nothing in between to get it wrong.
  const thermal = { spot: 17.61, call_wall: 17.5, put_wall: 15, flip: 17.27, gex_king_strike: 19, max_pain: 17 };
  const rows = structureLadder(thermal, thermalScopes(true, 12).level_scopes);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

  assert.equal(byKey.call_wall!.scope, "event_expiry");
  assert.equal(byKey.max_pain!.scope, "event_expiry");
  assert.equal(byKey.put_wall!.scope, "event_expiry");
  assert.equal(byKey.king_node!.scope, "aggregate", "the king node is the level that was mislabelled");
  assert.equal(byKey.gamma_flip!.scope, "aggregate");
  assert.equal(byKey.spot!.scope, null, "spot is not chain-derived and must never be scope-labelled");

  // The live ordering, preserved: price-ordered, king node on top at 19.00.
  assert.deepEqual(
    rows.map((r) => r.value),
    [19, 17.61, 17.5, 17.27, 17, 15],
    "adding a scope must not disturb the spatial ordering the ladder exists for"
  );
});

test("structureLadder without a scope map marks nothing — silence is not a claim", () => {
  // Every caller that has not been taught about scopes keeps its previous behaviour exactly.
  const rows = structureLadder({ spot: 100, call_wall: 110, put_wall: 90, flip: 105, gex_king_strike: 108, max_pain: 99 });
  assert.equal(rows.length, 6);
  for (const r of rows) assert.equal(r.scope, null, `${r.key} must be unlabelled, not guessed`);
});

test("both panels pass the scope map into the ladder they render", () => {
  // The Report tab and the Positioning tab draw the SAME ladder from the same payload. Fixing
  // one and not the other leaves the mislabel live on a tab that is one click away — which is
  // how it survived the first pass at this file.
  for (const file of [
    "src/features/meridian/components/MeridianEarningsPositioningPanel.tsx",
    "src/features/meridian/components/MeridianEarningsReportPanel.tsx",
  ]) {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    assert.match(src, /<MeridianStructureLadder[\s\S]{0,220}levelScopes=\{thermal\.level_scopes\}/, `${file} renders an unlabelled ladder`);
    assert.match(src, /structure_scope_label/, `${file} states net GEX without saying whose book it is`);
  }
});
