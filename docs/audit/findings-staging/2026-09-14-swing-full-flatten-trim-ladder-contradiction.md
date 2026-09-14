> **kind:** FINDING

## Ask Largo's swing "Manage plan" bullet showed a full-exit recommendation next to a still-pending trim ladder and runner allocation — fix/swing-full-flatten-trim-ladder-contradiction — 2026-09-14

| **Status** | FIXED |
|---|---|

### What was broken

Found during the standing Night Hawk Swings AGGRESSIVE MODE audit (hunting for genuine enhancement opportunities, not just bugs) — live on NRG's real committed position (`GET /api/market/swing/play-brief?playId=SWING:NRG:34`, 2026-09-14), the "Trade manager read" section's "Manage plan" bullet rendered:

> **Manage plan** — manage engine **EXIT** · next trim at **+100%** (+100%) · session exit **16:00 ET** · **50% runner** after trims · **5 DTE** — theta accelerating; don't over-hold.

`manage engine EXIT` means the desk's manage engine has decided to flatten the whole remaining position now (this one fired on `time_stop` — the position stalled toward its target and ran out of runway) — it supersedes any partial scale-out plan. But the same bullet, in the same breath, says "next trim at +100%" and "50% runner after trims," which describe a forward-looking, partial scale-out that is no longer the plan. A trader reading this literally gets two contradictory instructions: exit everything now, or wait for +100% to trim a third and keep a runner.

Root cause: `manageLifecycleCoaching` (`play-brief-narrative-coaching.ts`) built the "Manage plan" bullet's trim-ladder-progress and runner-fraction fragments unconditionally off the STATIC `exitPolicy` shape (`trim_levels`/`runner_fraction`), without checking whether `play.manageAction` had already moved past scale-out mechanics into a full flatten. `SwingManageAction` is `"HOLD" | "TAKE_PARTIAL" | "EXIT_RUNNER" | "STOP_OUT" | "EXIT" | "ADD"` — `EXIT` (a generic full flatten, e.g. via `time_stop`/thesis break) and `STOP_OUT` (the hard capital-preservation stop) both mean "close the whole remaining position," so the trim-ladder/runner fragments are moot under those two actions specifically. `EXIT_RUNNER` is a different case — it fires only after trims already banked, so "all trims banked — runner only" is exactly the state that produced that recommendation, not a contradiction of it, and was deliberately left untouched.

### What changed

`manageLifecycleCoaching` now gates the trim-ladder-progress fragment (`N/M trims banked` / `all trims banked` / `next trim at +X%`) and the runner-fraction fragment (`X% runner after trims`) behind `play.manageAction !== "EXIT" && play.manageAction !== "STOP_OUT"`. The `manage engine EXIT`/`STOP_OUT` bullet itself, the session-exit time-stop line, and the DTE-runway context all still render — only the two fragments that specifically implied a still-pending partial scale-out are suppressed when a full flatten has already superseded them.

### Evidence

RED→GREEN (Node 20, `git stash` isolation on `play-brief-narrative-coaching.ts` only): two new tests (`full-flatten EXIT drops the moot trim-ladder/runner framing`, `STOP_OUT ... also drops the moot framing`) failed pre-fix (both still contained "next trim"/"runner\*\* after trims") and passed post-fix. A third new test confirms `EXIT_RUNNER` is unaffected (`all trims banked` still renders). Targeted file: 82/82 pass post-fix. `tsc --noEmit` clean. Full suite run separately (see MARKET-OPEN-VALIDATION.md entry).

### Blast radius

Single call site (`play-brief-narrative-coaching.ts:1046`, inside `collectCoachingBullets`) feeding straight into the swing play-brief's "Trade manager read" section — no other consumer of `manageLifecycleCoaching` exists. `TAKE_PARTIAL`/`EXIT_RUNNER`/`HOLD` paths are byte-identical to before (existing test at line 170 for `TAKE_PARTIAL` still passes unchanged).

### Fix rationale

Suppression (not a rewrite into a new "your plan changed" sentence) was chosen because the "Exit now" bullet elsewhere in the same section already states the full-flatten recommendation in trade-manager voice (`degradedReadLine`/`actionNarrative` in `play-brief-narrative.ts`) — this fix only removes the stale, contradicting fragment from a sibling bullet rather than duplicating that framing a second time. This is the "narrative reads like a trade manager, not a bullet dump" improvement the standing Ask Largo × Night Hawk Swings mandate calls for: catching a live case where two mechanically-correct-in-isolation facts (the manage-engine verdict, the static exit-policy shape) combined into contradictory guidance for the reader.
