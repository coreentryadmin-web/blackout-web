> **kind:** FINDING

## Ask Largo's swing play-brief showed open-position exit-management language on a never-entered WATCH setup — fix/swing-watch-bucket-manage-rails-scope — 2026-09-14

| **Status** | FIXED |
|---|---|

### What was broken

Found during the standing Night Hawk Swings AGGRESSIVE MODE audit, live on SKHY's real WATCH-bucket brief (`GET /api/market/swing/play-brief?playId=SWING:SKHY`): the setup's thesis was already **INVALIDATED pre-entry** (`gates blocking entry: thesis_invalidated`, "price closed through the structural invalidation level" — this setup has never been traded and per its own gate never will be). Yet the "Trade manager read" section rendered:

> **Manage rails** — trim ladder +100%. Honor stops on closing basis; bank trims into strength.

This is open-position exit-management guidance — telling a member to "bank trims" and "honor stops" — on a setup with no position to manage.

Root cause: `railsFallback` (`play-brief-narrative.ts:535`) is written as an OPEN-bucket fallback — it exists to cover the case where `manageLifecycleCoaching` (which itself unconditionally returns `null` for `bucket !== "open"`) has nothing to say despite a real `exitPolicy` (e.g. a contract string with no parseable `NdTE` token, so its own DTE-runway line never fires). But the call site's guard only checked whether a "Manage plan" bullet had already rendered elsewhere in the bullet list — it never checked `bucket` directly. Since `manageLifecycleCoaching` always returns `null` for `bucket === "watch"`, that guard was *always* true for WATCH plays, making `railsFallback` fire as the de-facto WATCH-bucket path rather than the rare open-only edge case it was designed for. (For `bucket === "open"`, `manageLifecycleCoaching` returns non-null in virtually every real case — any position's contract carries an `NdTE` suffix, so its DTE-runway line alone guarantees non-null output — so the original guard was effectively dead for its intended target and live only for the unintended one.)

### What changed

The call site now requires `bucket === "open"` explicitly, alongside the existing "Manage plan didn't already render" check. WATCH-bucket plays never see `railsFallback`'s output; the genuine open-bucket edge case (a contract with no parseable DTE) still falls back to it exactly as before.

### Evidence

RED→GREEN (Node 20, `git stash` isolation): two new tests — a WATCH-bucket, thesis-invalidated fixture (the live SKHY repro shape) asserting `Manage rails` no longer renders, failed pre-fix and passed post-fix; a sibling OPEN-bucket, no-DTE-token fixture (the pre-existing genuine fallback case) asserting `Manage rails` still renders, passed both before and after (confirming the fix doesn't remove the intended behavior). Full targeted suite 69/69 pass, `tsc --noEmit` clean.

### Blast radius

`railsFallback` has exactly one call site (`play-brief-narrative.ts:809`), inside `tradeManagerNarrativeSection`'s degraded-spot branch. No other consumer exists (repo-wide grep confirmed). The open-bucket path is unchanged; only the watch-bucket firing is removed.

### Fix rationale

A bucket check at the call site (rather than moving the check inside `railsFallback` itself, or passing `bucket` into it) keeps the fix minimal and localized to the one place the wrong condition was evaluated — `railsFallback` itself stays a pure "given an exit policy, format its rails" function with no bucket awareness needed. This mirrors `manageLifecycleCoaching`'s own explicit `bucket !== "open"` guard, which this fallback was always meant to complement, not bypass.
