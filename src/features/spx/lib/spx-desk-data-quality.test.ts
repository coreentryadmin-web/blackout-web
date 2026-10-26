import { before, mock, test } from "node:test";
import assert from "node:assert/strict";

import { computeVixTermStructure } from "@/lib/vix-term-utils";
import type { IndexQuote } from "@/lib/providers/polygon";

/**
 * `oi_changes`/`iv_term_structure` on `SpxDeskPayload` are PERMANENTLY, structurally absent — no
 * function anywhere in this codebase (or `spx-desk-merge.ts`'s shell-default stubs) ever computes
 * a real `OiChangeItem[]`/`IvTermPoint[]` for the SPX desk; `buildSpxDesk()` hardcodes them as
 * bare `[]` literals, unlike every sibling array field (built from a named computed variable with
 * a `?? []` fallback). Before this fix, `buildDeskDataQuality()` only ever tracked VIX/VIX9D/VIX3M
 * feed presence in its `missing` list, so nothing distinguished "never computed, ever" from
 * "genuinely zero today" — the exact absence-vs-silence failure
 * `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s absence principle exists to prevent.
 *
 * Mirrors `spx-desk-wall-scope.test.ts`'s pattern for importing `./spx-desk` as a VALUE (not just
 * a type): mock `server-only` first, then dynamically import so the mock is in place before the
 * module's own top-level imports resolve.
 */

mock.module("server-only", { namedExports: {} });

let buildDeskDataQuality: typeof import("./spx-desk").buildDeskDataQuality;

before(async () => {
  ({ buildDeskDataQuality } = await import("./spx-desk"));
});

const snap = (price: number): IndexQuote => ({ symbol: "I:VIX", price, change_pct: null, prev_close: null });

const HEALTHY_SNAPS: Record<string, IndexQuote | null> = {
  "I:VIX": snap(17.2),
  "I:VIX9D": snap(15.1),
  "I:VIX3M": snap(19.4),
};

test("buildDeskDataQuality: ALWAYS discloses oi_changes/iv_term_structure as missing, even with healthy VIX feeds", () => {
  const vixTerm = computeVixTermStructure(17.2, 15.1, 19.4);
  const result = buildDeskDataQuality(HEALTHY_SNAPS, vixTerm);

  // The VIX legs are all healthy — this is the "nothing wrong with the VIX curve" case where the
  // pre-fix code produced `missing: []` (empty) and `vix_term_partial: false`.
  assert.equal(result.vix_term_partial, false);
  assert.deepEqual(
    [...result.missing].sort(),
    ["iv_term_structure", "oi_changes"],
    "oi_changes/iv_term_structure must be disclosed as permanently missing regardless of VIX feed health"
  );
  // And genuinely-live feeds must NOT be falsely named as missing.
  assert.ok(!result.missing.includes("VIX"));
  assert.ok(!result.missing.includes("VIX9D"));
  assert.ok(!result.missing.includes("VIX3M"));
});

test("buildDeskDataQuality: oi_changes/iv_term_structure disclosure is ADDITIVE to real VIX-feed gaps", () => {
  const degraded: Record<string, IndexQuote | null> = {
    "I:VIX": null,
    "I:VIX9D": snap(15.1),
    "I:VIX3M": null,
  };
  const vixTerm = computeVixTermStructure(null, 15.1, null);
  const result = buildDeskDataQuality(degraded, vixTerm);

  assert.deepEqual(
    [...result.missing].sort(),
    ["VIX", "VIX3M", "iv_term_structure", "oi_changes"],
    "a real VIX gap must not crowd out or duplicate the permanent oi_changes/iv_term_structure entries"
  );
});
