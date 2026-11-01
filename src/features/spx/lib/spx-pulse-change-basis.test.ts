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

test("an untrusted pulse change is marked unresolved rather than published as flat 0%", () => {
  const pulseLaneStart = src.indexOf("const pulseChange =");
  assert.ok(pulseLaneStart > 0, "pulse lane assignment exists");
  const pulseLaneEnd = src.indexOf("if (pulseChange == null) unresolvedChange.add(sym);", pulseLaneStart);
  const body = src.slice(pulseLaneStart, pulseLaneEnd + 60);
  assert.match(body, /unresolvedChange\.add\(sym\)/);
  assert.match(body, /change_pct: pulseChange,/);
  assert.doesNotMatch(body, /change_pct: pulseChange \?\? 0/);
});

test("the fast path is NOT taken on an unresolved SPX change", () => {
  // A price alone used to short-circuit here — that is precisely how a session-open-anchored
  // number reached the header tile.
  assert.match(src, /const changeResolved = \(sym: string\) => !unresolvedChange\.has\(sym\) \|\| wsResolved\(sym\)/);
  assert.match(src, /changeResolved\(SPX\)/);
});

test("VIX is gated alongside SPX, not left behind it", () => {
  // An unresolved entry used to be written `change_pct: pulseChange ?? 0` — a FABRICATED FLAT ZERO.
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
  assert.match(src, /pulseChangePctFromPriorClose\(price, prior\.pdc, spxSnap\?\.change_pct\)/);
});

test("cold-replica pulse minimal fallback derives change from prior close, not raw transport", () => {
  // buildSpxDeskPulseMinimal is the deskPulseCacheOpts fallback on cold replicas — it used to
  // publish spxSnap.change_pct verbatim with prior_close:null, reintroducing the open-anchored
  // oscillation the full pulse path fixed.
  assert.match(src, /export async function buildSpxDeskPulseMinimal/);
  assert.match(
    src,
    /buildSpxDeskPulseMinimal[\s\S]*priorDayForPulseLane[\s\S]*pulseChangePctFromPriorClose\(price, prior\.pdc, spxSnap\?\.change_pct\)/
  );
});

test("last-resort pulse fallback carries prior_close so consumers never invert change_pct", () => {
  assert.match(
    src,
    /lastPulseForSignals\.prior_close \?\? null/
  );
});

// BUG FIX (live repro 2026-10-26, Ask Largo/5-engine standing mandate — SPX Slayer /desk check):
// buildSpxDeskPulseMinimal's live-price branch hardcoded `market_status: "open"` as a bare
// literal, independent of the `rthOpenNow` boolean it assigns to `market_open` two lines above.
// Confirmed live against GET /api/market/spx/desk at 2026-10-26T09:09:19Z (~5:09 AM ET, well
// before the 9:30 AM cash open): the bootstrap-shell fallback (deskShellFromPulse ->
// mergePulseIntoDesk, which carries `pulse.market_status` straight through unchanged) served
// `"market_open": false, "market_status": "open"` in the SAME payload — a direct, visible
// self-contradiction, also surfaced verbatim on the admin SPX dashboard's
// `desk.market: { open, status }` fields (admin-spx-dashboard.ts's buildDeskIntel). Every OTHER
// market_status fallback in this file (the "closed"-market builders a few hundred lines up, and
// the two RTH/premarket ternaries in buildSpxDesk/deskShellFromPulse) keeps market_status
// consistent with market_open/rthOpen when the live provider is unavailable — this was the one
// outlier that didn't.
test("cold-replica pulse minimal fallback's market_status agrees with market_open — never a bare 'open' literal", () => {
  const minimalStart = src.indexOf("export async function buildSpxDeskPulseMinimal");
  assert.ok(minimalStart > 0, "buildSpxDeskPulseMinimal exists");
  const minimalEnd = src.indexOf("\n}", src.indexOf("roundPulseNumerics(raced)", minimalStart));
  const body = src.slice(minimalStart, minimalEnd);
  // The live-price return block must derive market_status from rthOpenNow, not hardcode "open".
  assert.match(body, /market_open: rthOpenNow,/);
  assert.match(body, /market_status: rthOpenNow \? "open" : "closed",/);
  assert.doesNotMatch(body, /market_status: "open",/);
});
