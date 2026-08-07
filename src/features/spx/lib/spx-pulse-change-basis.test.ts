import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source-level guard. The defect lives in a Redis-backed lane whose behavioural test would need a
// live cache + WS store; what actually broke is a one-line trust decision, so that decision is
// pinned here directly. Live evidence 2026-08-07: the header tile read 7,734.13 -0.01% in RED while
// SPX was +0.31%, and /api/market/spx/pulse returned -0.04 / +0.30 / -0.01 across 39 seconds while
// /desk sat correctly at +0.27 — the pulse value tracked (price - open)/open on 7 of 8 paired polls.
const src = readFileSync("src/features/spx/lib/spx-desk.ts", "utf8");

test("pulse lane trusts change_pct ONLY on a REST-seeded anchor", () => {
  // Same rule mergeWsIndexSnapshots applies to the WS store. Dropping it re-anchors the headline
  // day-change to the session open, which inverts its SIGN on any day that gapped.
  assert.match(src, /const anchorAuthoritative = e\.open_source === "rest"/);
  assert.match(src, /anchorAuthoritative && Number\.isFinite\(e\.change_pct\)/);
});

test("an untrusted pulse change is marked unresolved rather than published", () => {
  assert.match(src, /unresolvedChange\.add\(sym\)/);
  assert.match(src, /const unresolvedChange = new Set<string>\(\)/);
});

test("the fast path is NOT taken on an unresolved SPX change", () => {
  // A price alone used to short-circuit here — that is precisely how a session-open-anchored
  // number reached the header tile.
  assert.match(src, /const changeResolved = \(sym: string\) => !unresolvedChange\.has\(sym\) \|\| wsResolved\(sym\)/);
  assert.match(src, /changeResolved\(SPX\)/);
});

test("VIX is gated alongside SPX, not left behind it", () => {
  // An unresolved entry is written `change_pct: pulseChange ?? 0` — a FABRICATED FLAT ZERO. While
  // the gate named only SPX, a poll where SPX resolved and VIX did not returned early and served
  // `vix_change_pct: 0`, i.e. the desk asserting VIX is unchanged on the day when it is not. The
  // 2026-08-07 measurement found VIX affected identically to SPX (pulse -1.51 / -0.79 / -1.64
  // against a true -0.20..-0.59 band).
  assert.match(src, /changeResolved\(SPX\) && changeResolved\(VIX\)/);
});

test("a REST-anchored WS store still rescues the fast path", () => {
  // Otherwise the fix trades one wrong number for a needless REST round-trip on the desk hot lane.
  // Now applied per-symbol via wsResolved(sym) so BOTH gated symbols get the same rescue.
  assert.match(src, /ws\.open_source === "rest"/);
  assert.match(src, /const wsResolved = \(sym: string\): boolean =>/);
});

test("the header day-change is DERIVED from prior close, not transported", () => {
  // The durable half of the same P0: change% crosses Redis and a WS store without ever carrying its
  // anchor, so session-open-anchored and prior-close-anchored values are indistinguishable. The tile
  // already shows price and prior_close, so computing the third number from those two makes the
  // header self-consistent by construction. See spx-change-anchor.test.ts for the arithmetic.
  assert.match(src, /pulseChangePctFromPriorClose\(price, prior\.pdc, spxSnap\.change_pct\)/);
});
