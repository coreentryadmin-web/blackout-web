import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The SPX matrix served TWO DIFFERENT BOOKS interchangeably, both tagged "live".
 *
 * `applySpxOdteGexUwOverlay` returns the UN-OVERLAID matrix when the UW 0DTE ladder is missing,
 * and the result was indistinguishable from an overlaid one: same shape, same freshness tag, no
 * marker anywhere in the payload.
 *
 * MEASURED ON PROD 2026-08-20 during RTH — 12 samples ~2s apart produced 8 distinct payload
 * signatures, including two consecutive reads at an IDENTICAL spot:
 *
 *     13:38:04  spot=7694.11  216 strikes  net -17.21B  call wall 7750
 *     13:38:08  spot=7694.11  185 strikes  net -13.70B  call wall 7750
 *
 * A 25% swing in net GEX at the same instant. Walls moved call 7750<->7900 and put
 * 7400->7690->7600->7500 on a 0.12% spot move, so a member asking twice inside a minute got three
 * different wall pairs.
 *
 * TWO CONTROLS isolate the overlay as the cause:
 *   - SPY, which has NO overlay, held 268-270 strikes across the entire session.
 *   - POST-CLOSE, when this function no-ops (today's expiry drops out of `hm.expiries`), SPX itself
 *     was stable at 184 strikes with an identical range across 6 samples.
 *
 * Both refute the earlier hypothesis that this was chain-pagination truncation — that guard is 200
 * pages, floored at 40, and a pagination bug would not switch itself off at the closing bell.
 *
 * This is OBSERVABILITY, not a behaviour change: no served number moves. It exists so the
 * correlation can be confirmed by reading one field instead of re-deriving it from strike counts.
 */

const SRC = readFileSync(
  join(process.cwd(), "src/lib/providers/spx-odte-gex-uw-overlay.ts"),
  "utf8"
);
const TYPES = readFileSync(join(process.cwd(), "src/lib/providers/polygon-options-gex.ts"), "utf8");

test("REGRESSION: every exit path stamps whether the overlay applied", () => {
  // The silent `return hm` is the whole defect. If ANY exit leaves the flag unset, a consumer
  // cannot distinguish "overlay ran" from "overlay skipped" — which is the state we were in.
  const fn = SRC.slice(SRC.indexOf("export async function applySpxOdteGexUwOverlay("));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  // Exclude the `mark` helper itself — its `return hm` IS the marked return, and counting it made
  // this assertion fail on correct code. A guard that cannot tell the fix from the bug is noise.
  // Remove the whole `mark` arrow function. Matching a bare "};" cuts at the INNER object literal
  // (`{ applied, reason };`) and leaves the helper's own return behind — which is what made this
  // assertion fail against correct code on the first try.
  const withoutHelper = body.replace(/ {2}const mark = [\s\S]*?\n {2}\};\n/, "");
  const bareReturns = withoutHelper.match(/return hm;/g) ?? [];
  assert.equal(bareReturns.length, 0, "no exit may return the matrix unmarked");
  assert.match(body, /mark\(false, "not_applicable"\)/);
  assert.match(body, /mark\(false, "no_odte_expiry"\)/);
  assert.match(body, /mark\(false, "ladder_unavailable"\)/);
  assert.match(body, /applied: true, reason: "applied"/);
});

test("the reasons are DISTINCT — a no-op is not a failure", () => {
  // `no_odte_expiry` is the normal post-close state and must never read as a fault; a monitor that
  // alerts every evening gets muted, and then it is not a monitor. `ladder_unavailable` is the one
  // that means two books are in circulation.
  assert.match(TYPES, /"applied" \| "not_applicable" \| "no_odte_expiry" \| "ladder_unavailable"/);
});

test("the failure that matters logs itself", () => {
  // Learned the hard way earlier today: a path that cannot report its own failure costs far more
  // than the failure. This is the one exit where a real 0DTE expiry existed and was not overlaid.
  const idx = SRC.indexOf('mark(false, "ladder_unavailable")');
  const before = SRC.slice(Math.max(0, idx - 400), idx);
  assert.match(before, /console\.warn/, "ladder_unavailable must warn");
  assert.match(before, /UN-OVERLAID/i, "and must name what was actually served");
});

test("the payload type carries the state, optionally", () => {
  // Optional/additive: non-SPX payloads and snapshots written before this field simply omit it,
  // so nothing that reads the matrix today breaks.
  assert.match(TYPES, /odte_overlay\?: SpxOdteOverlayState;/);
  assert.match(TYPES, /export type SpxOdteOverlayState/);
});

test("no served value is changed by this instrumentation", () => {
  // The guard against scope creep: this PR must not touch walls, flip, totals or cells. If a future
  // edit starts mutating those here, that is a behaviour change and needs its own evidence.
  const fn = SRC.slice(SRC.indexOf("export async function applySpxOdteGexUwOverlay("));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  for (const forbidden of ["hm.gex.call_wall =", "hm.gex.put_wall =", "hm.gex.flip =", "hm.gex.total ="]) {
    assert.ok(!body.includes(forbidden), `entry point must not assign ${forbidden}`);
  }
});
