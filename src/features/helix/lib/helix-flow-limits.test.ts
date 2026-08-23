import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  HELIX_DEFAULT_MIN_PREMIUM,
  HELIX_MEMBER_PANEL_PREMIUM_FLOOR,
  HELIX_PREMIUM_PRESETS,
  WHALE_PRINT_PREMIUM,
} from "./helix-flow-limits";

/**
 * These constants exist so a threshold has ONE definition — this module's own docstring says so.
 * It was being bypassed anyway: `1_000_000` was declared SIX times across the HELIX lane (three
 * named `WHALE_PREMIUM` consts and two bare literals, one of them fourteen lines from the named
 * constant in the same file), and `PREMIUM_PRESETS` was duplicated verbatim in two components.
 *
 * A test that only asserted the values would not have caught any of that — every copy agreed. So
 * these assert the SHAPE of the lane instead: that no HELIX component re-declares them.
 */

test("the whale threshold is a real, positive premium above the panel floor", () => {
  assert.ok(Number.isFinite(WHALE_PRINT_PREMIUM) && WHALE_PRINT_PREMIUM > 0);
  // A whale floor at or below the panel floor would badge every visible print.
  assert.ok(WHALE_PRINT_PREMIUM > HELIX_MEMBER_PANEL_PREMIUM_FLOOR);
});

test("the default min-premium IS the panel floor, not a coincidentally equal literal", () => {
  // `activeFilterCount` compares against this to decide whether the member has filtered anything.
  // If it drifts from the actual initial state, a fresh page reports one active filter.
  assert.equal(HELIX_DEFAULT_MIN_PREMIUM, HELIX_MEMBER_PANEL_PREMIUM_FLOOR);
});

test("every preset is at or above the panel floor — a preset below it is dead UI", () => {
  // Audit gap #16: no row below the server ingest floor is ever persisted, so offering a lower
  // preset returns nothing and reads as "no flow" rather than "unreachable filter".
  for (const p of HELIX_PREMIUM_PRESETS) {
    assert.ok(p >= HELIX_MEMBER_PANEL_PREMIUM_FLOOR, `preset ${p} is below the floor`);
  }
  // The presets start AT the default, so the first chip is the unfiltered state.
  assert.equal(HELIX_PREMIUM_PRESETS[0], HELIX_DEFAULT_MIN_PREMIUM);
  // ...and the whale bar is one of them, so "Whales only" and the $1M preset cannot disagree.
  assert.ok((HELIX_PREMIUM_PRESETS as readonly number[]).includes(WHALE_PRINT_PREMIUM));
});

test("presets are strictly ascending — the chip rail is ordered, not just a set", () => {
  for (let i = 1; i < HELIX_PREMIUM_PRESETS.length; i++) {
    assert.ok(
      HELIX_PREMIUM_PRESETS[i]! > HELIX_PREMIUM_PRESETS[i - 1]!,
      `preset ${i} is not above its predecessor`
    );
  }
});

test("no HELIX component re-declares these thresholds — the ratchet", () => {
  // The assertion that would have caught the original defect. Values agreeing is not the property
  // that matters; having one definition is. A new local `const WHALE_PREMIUM = 1_000_000` passes
  // every value check above and fails this one.
  // `readdirSync`, not `globSync` — the latter is Node 22+ and this repo runs Node 20, where it
  // is `undefined` and throws a TypeError rather than returning nothing. A test that dies is at
  // least loud; one that silently scanned zero files would have passed forever.
  const dir = "src/features/helix/components";
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => join(dir, f));
  assert.ok(files.length > 5, `expected HELIX components, found ${files.length}`);
  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const [i, line] of src.split("\n").entries()) {
      // Only DECLARATIONS. Formatting helpers legitimately divide by 1_000_000, and
      // 1_000_000_000 is the billions branch of a money formatter.
      if (/^\s*const\s+\w*(WHALE|PREMIUM_PRESET)\w*\s*=/.test(line)) {
        offenders.push(`${f}:${i + 1} ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `HELIX components must import these from helix-flow-limits.ts, not re-declare them:\n${offenders.join("\n")}`
  );
});
