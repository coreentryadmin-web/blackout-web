## Ask Largo / Night Hawk Swings: the "thesis_invalidated" gate claimed price "CLOSED through the structural invalidation level" when the check is actually a live intraday read — the state can genuinely revert within the same session, which the wording never disclosed

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD) |
| **Found by** | Live-production audit agent, Ask Largo × Night Hawk Swings standing ownership mandate, 2026-10-26 |
| **Scope** | `src/lib/swing/entry-verdict.ts` (`researchGateBlocks`'s `thesis_invalidated` reason), `src/lib/swing/setup-state.ts` (doc comments) |

### Root cause

`deriveSetupState` (`setup-state.ts`) derives the `INVALIDATED` setup state by comparing the
dossier's underlying price against the structural invalidation level: `price <= invalidationPx`
for LONG, `price >= invalidationPx` for SHORT. That `price` is sourced from
`swingServingReadsFromPlan`'s own `spot` parameter, whose doc comment is explicit: "a live (or
last-known) spot." This is an **intraday, live read, re-evaluated on every scan** — never a
settled end-of-day close.

Despite that, every piece of surfaced text describing this state said "closed":
`entry-verdict.ts`'s `thesis_invalidated` gate reason read *"Structure invalidated — price
**closed** through the structural invalidation level."* — this exact string reaches the member
via the swing play-brief's "Trade manager read" section (`play-brief-intel.ts`'s
`catalystCoaching`-adjacent gate-block rendering) whenever a WATCH candidate's thesis breaks
pre-entry. `setup-state.ts`'s own doc comment made the identical claim internally.

"Closed through" asserts a stable, settled fact — the kind of thing that, once true, stays true
for the rest of the session. The real check has no such property: it is re-run on every board
read and can genuinely flip back to `FORMING` if the underlying price reclaims the level before
any session close. Saying "closed" when the read is intraday overstates how final the break is —
the exact precision violation `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s "precision" point exists to
catch, and the same class of bug this repo has already fixed once for earnings BMO/AMC timing
(never claim more certainty than what was actually measured).

### Evidence

Live repro, 2026-10-26, same RTH session, no session close in between: `GET
/api/market/nighthawk/horizons?view=swings`'s SWING WATCH lane showed **SOXX** (SHORT, score
68.6) with `setupState: "FORMING"` and gate blocks `[gate:G-S4:regime_degraded,
gate:G-S6:confluence, gate:G-S14:cortex_net_negative]` at 17:17 UTC. By 17:32 UTC it dropped off
the WATCH lane entirely; its play-brief (`GET /api/market/swing/play-brief?...&status=WATCH`)
showed `setupState: "INVALIDATED"`, headline `PASSED`, and the exact reason text under audit:
*"Structure invalidated — price closed through the structural invalidation level."* By 19:02 UTC
(under an hour later, same session), SOXX reappeared on the WATCH lane with `setupState:
"FORMING"` and the **identical** three gate blocks as the 17:17 read — the thesis had reverted,
contradicting the "closed" framing's implied finality.

Traced the mechanism: `swingServingReadsFromPlan`'s own doc comment ("a live (or last-known)
spot") and `deriveSetupState`'s direct `price`-vs-`invalidationPx` comparison confirm this is an
intraday check with no close-anchoring anywhere in the call chain.

### Fix

Corrected the `thesis_invalidated` gate reason (`entry-verdict.ts`) to describe what is actually
measured: *"Structure invalidated — price is through the structural invalidation level (live
read; can still revert if price reclaims before the thesis window closes)."* Updated
`setup-state.ts`'s two doc comments (the `invalidationPx` field doc and `deriveSetupState`'s own
precedence-list doc) to the same effect, so a future maintainer reading the pure derivation
function isn't misled either.

Deliberately left unchanged: the GATING BEHAVIOR itself (comparing live price against the level,
dominating every other state) — this is a wording-precision fix, not a mechanism change.
Requiring a settled close before flagging INVALIDATED would be a real behavioral change (delaying
a legitimate pre-entry thesis-break signal until end-of-day, by which point acting on it is
largely moot for a pre-entry WATCH candidate) and is out of scope here; the problem being fixed is
that the TEXT claimed more finality than the mechanism provides, not that the mechanism itself is
wrong. A separate, unreachable legacy calibration module
(`src/lib/swing/legacy-calibration/gates-pr5.ts`, explicitly documented "NOT production... unit
tests and calibration evidence only") carries the same stale wording but was left untouched since
it's dead code on the real commit path.

### Regression test

`src/lib/swing/entry-verdict.test.ts`: *"thesis_invalidated gate reason describes a LIVE price
read, never claims a settled close (the state can revert intraday)"* — asserts the reason text
does not match `/closed through/i` and does match `/live read/i`.

### Verification

- `npx tsx --experimental-test-module-mocks --test src/lib/swing/entry-verdict.test.ts` — RED
  pre-fix (25 pass / 1 fail, `git stash` of `entry-verdict.ts`+`setup-state.ts` with the test kept
  in place), GREEN post-fix (26 pass / 0 fail).
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/entry-verdict.test.ts src/lib/swing/setup-state.test.ts src/lib/swing/entry-enterability.test.ts src/lib/swing/serving-ingest.test.ts src/lib/swing/serving.test.ts src/lib/swing/play-brief-intel.test.ts` — 440/440 pass.
- Full suite (`npm test`, Node 20) — pass, 0 fail.
- `npx tsc --noEmit` (Node 20) — clean, exit 0.
