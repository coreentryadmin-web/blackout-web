# 2026-10-18 — [FINDING, P2 Ask Largo × Night Hawk Swings, correctness] `entryTriggerDeadReason()` permanently shadows the Legacy-pinned-price staleness disclosure for every Legacy-promoted WATCH play

> **kind:** `FINDING`

## Summary

`entryTriggerDeadReason()` in `src/lib/swing/play-brief-intel.ts` checked the broad
`gateFramingMootReason()` (entry-enterability.ts) FIRST and returned early on a match — but
`gateFramingMootReason()`'s own `legacy_exempt`-only-`gateBlocks` case (widened the same day,
2026-10-18) matches EVERY Legacy-promoted WATCH play unconditionally, since Legacy promotion never
runs real commit gates and always resolves `commitGateBlockedBy` to exactly `[legacy:exempt]`. So
the gate-moot early return permanently shadowed the older, more specific 2026-10-06
Legacy-pinned-price staleness check beneath it — the one check that exists specifically for this
population — meaning no Legacy-promoted WATCH brief could ever disclose that its quoted entry
trigger price is stale/pinned, only that the gate framing is moot.

Live repro (prod, 2026-10-18): `GET /api/market/swing/play-brief?playId=SWING:UNH&ticker=UNH&status=WATCH`.
Both the "Watch levels" narrative and the structured `envelope.levels[]` "entry trigger" note read
only *"Legacy-promoted — commit gates were never evaluated on this path, not a live gate to clear
— this level no longer fires the setup"*, with no mention that the quoted 399.15 price is itself 3
days stale (`firstSeenAt` 2026-10-15). Confirmed via the horizons payload: `flagUnderlyingPx ===
entryTriggerUnderlyingPx === 399.15`, `signalKinds: ["NIGHT HAWK"]` (`isLegacyPromotedSignal` true),
`commitGateBlockedBy: ["legacy:exempt"]` — all three conditions for the shadowed staleness branch
are satisfied simultaneously, yet the staleness text never renders.

## Root cause

`entryTriggerDeadReason()` (play-brief-intel.ts, ~line 1323) called `gateFramingMootReason(play)`
first and `return`ed immediately on any non-null result, before ever reaching the
`isLegacyPromotedSignal(...) && flagUnderlyingPx === entryTriggerUnderlyingPx` staleness check a
few lines below it. `gateFramingMootReason()` (entry-enterability.ts, ~line 245) was widened the
same day (2026-10-18) to add a third case — `gateBlocks` non-empty and every entry's `code ===
"legacy_exempt"` — which is exactly the `gateBlocks` shape every Legacy-promoted row carries
(`commitGateBlocksForVerdict` in entry-verdict.ts stamps `code: "legacy_exempt"` for the
`LEGACY_COMMIT_GATE_EXEMPT` token, and Legacy promotion never produces any other gate block). The
two checks are logically independent facts (the gate framing is moot; the trigger price is stale)
that can both be true at once, but the code treated them as mutually exclusive via an early
return — the second check was simply unreachable for the one population it was written for.

## Fix

`entryTriggerDeadReason()` now evaluates both the Legacy-pinned-price staleness condition and
`gateFramingMootReason()` unconditionally (no early return), and composes both facts into one
sentence when both hold: `"pinned at Legacy promotion, not refreshed since, and <gate-moot reason>
— this level no longer fires the setup"`. When only one holds, behavior is unchanged from before.
This is additive-only — no existing single-condition case changes its output.

Blast radius: `entryTriggerDeadReason()` has exactly two call sites, both of which inherit the fix
automatically — `watchForSection`'s "Entry trigger" narrative bullet (play-brief-intel.ts, ~line
1409) and `play-brief.ts`'s structured `envelope.levels[]` "entry trigger" note (~line 939). No
other call site exists.

## Regression test

Added to `src/lib/swing/play-brief-intel.test.ts`: a fixture combining a Legacy-promoted signal
(`discoveryOrigin: ["NIGHT HAWK"]`), a pinned/stale trigger (`flagUnderlyingPx ===
entryTriggerUnderlyingPx`), TRIGGERED/AT_TRIGGER/above-floor state, and a `legacy_exempt`-only
`gateBlocks` entry (the live UNH shape) — asserts the rendered text contains BOTH the gate-moot
framing and the pinned-price staleness disclosure. Proved RED before the fix (only the gate-moot
text rendered, staleness text absent) and GREEN after.

## Status

**FIXED (2026-10-18)** — see PR branch `fix/largo-entrytrigger-staleness-shadowed`.

Verified: `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-intel.test.ts`
(268/268 pass, including the new regression test), `src/lib/swing/entry-enterability.test.ts` +
`src/lib/swing/play-brief-narrative-coaching.test.ts` + `src/lib/swing/play-brief.test.ts` (362/362
pass, no regressions in the two sibling call sites or the widened `gateFramingMootReason` itself),
and `npx tsc --noEmit` clean — all on Node 20.
