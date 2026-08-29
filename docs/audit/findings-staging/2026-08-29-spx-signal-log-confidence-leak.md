# `get_signal_log` served SPX Slayer's uncalibrated confidence to Largo completely unwrapped

> **kind:** FINDING

## Root cause

`docs/audit/LARGO-PRODUCT-CONTRACT.md` requires `confidence` be OMITTED when a product has no
calibrated model for it — SPX Slayer's is a formula over `|score|*1.15 + factors.length*3` with no
outcome data behind it (measured win rate ~50% while the field reads a near-constant 96). The
boundary function that enforces this, `omitUncalibratedSpxConfidence`
(`src/lib/largo/spx-confidence-boundary.ts`), is applied at two of its three call sites
(`get_spx_play`, `get_spx_confluence` in `src/lib/largo/run-tool.ts`) — but **`get_signal_log`
(same file, previously line 1047-1048) called `marketPlatform.spx.getSpxSignalLog()` directly and
returned its rows with no wrapper at all.**

This was invisible from reading the boundary function alone, because the boundary function itself
had a second, compounding gap: its guard was `if (!("rawScore" in obj)) return payload;`. The
`SpxSignalLogRow` shape (`src/features/spx/lib/spx-signal-log.ts`) never carries a `rawScore` key —
`insertSpxSignalLog` persists the identical fabricated value under a DIFFERENT name:
`confidence: play.rawScore`. So even routing signal-log rows through the existing function would
have been a no-op — the guard would bail before the destructure that drops `confidence` ever ran.
Two independent gaps had to both be closed for `get_signal_log` to actually omit anything.

## Evidence

`SpxSignalLogRow` (`spx-signal-log.ts:39-50`) declares `confidence: number` as a plain field, and
`maybeLogSpxPlay` writes it verbatim: `confidence: play.rawScore` (line 101). `run-tool.ts`'s
`get_signal_log` case returned `marketPlatform.spx.getSpxSignalLog(...)` with no import of
`omitUncalibratedSpxConfidence` anywhere near it — confirmed by grep: the boundary function's only
callers were the two other SPX tool cases plus `src/lib/bie/ecosystem-context.ts`. New test
`REGRESSION: a signal-log row (confidence present, rawScore ABSENT) is stripped too` in
`spx-confidence-boundary.test.ts` reproduces the exact row shape and fails without both fixes below
(guard alone lets a `confidence`-only row through unomitted; wiring alone still hits the guard).

## Blast radius

Only `get_signal_log`. The other two call sites (`get_spx_play`, `get_spx_confluence`) already
routed through the boundary function via `rawScore`, and `src/lib/bie/ecosystem-context.ts`'s
`spx_full_state` wraps `getSpxPlayState()` output (the `rawScore` shape), so none of those needed
the broadened guard to newly change behavior — the guard broadening is additive/defense-in-depth
for them. `get_spx_engine_snapshots` (a sibling tool) was checked and does not carry a `confidence`
field at all (verified via `fetchRecentSpxSnapshots`'s shape), so it needed no change.

## Fix

1. `spx-confidence-boundary.ts`: broadened the guard from `"rawScore" in obj` to
   `"rawScore" in obj || "confidence" in obj`, and updated the type/doc comment to describe both
   keys as the same fabricated number under two names.
2. `run-tool.ts`'s `get_signal_log` case: now maps every row through `omitUncalibratedSpxConfidence`
   before returning, matching the other two SPX tool call sites.

## Fix rationale

Chose to broaden the shared guard rather than add a second, signal-log-specific omission helper —
the destructure logic, the named-absence value, and the "why omit" reasoning are all identical
regardless of which key the value arrived under; a second helper would just be the same fix typed
twice. Left the DB column name (`confidence` in `spx_signal_log`) and the member-facing UI
(`{n}% conviction`) untouched — this module changes only what the MODEL sees, per the existing
"WHY NOT STRIP IT FROM THE ENGINE" note already in the file, which applies unchanged to this fix.

## Evidence (tests)

`npx tsc --noEmit` clean. `npx tsx --test src/lib/largo/spx-confidence-boundary.test.ts` — 7/7 pass
(6 pre-existing + 1 new regression test). Full suite run separately.

| **Status** | FIXED |
