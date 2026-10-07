## Ask Largo swing play-brief's structured `envelope.levels` never carried the WATCH setup's own flag anchor / entry trigger — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo / Night Hawk Swings — `GET /api/market/swing/play-brief` (`src/lib/swing/play-brief.ts`'s `levelsFromContext`) |
| **Severity** | P3 (absence/precision gap against `docs/audit/LARGO-PRODUCT-CONTRACT.md` — the one pair of decision-relevant levels structural consumers can never see, worst when it is most needed) |
| **Status** | FIXED |
| **File** | `src/lib/swing/play-brief.ts`, `src/lib/swing/play-brief-intel.ts` (exported `entryTriggerDeadReason`) |

### Root cause

`watchForSection` (`play-brief-intel.ts`) narrates `play.flagUnderlyingPx`/`play.entryTriggerUnderlyingPx`
in prose for every WATCH-bucket play — "Flag anchor: **411.79** — track move from here" / "Entry
trigger: **411.04** — ... this is what actually fires the setup" — but `levelsFromContext`
(`play-brief.ts`), the ONLY function that populates the envelope's structured `levels: BieLevel[]`
array, never read either field. It only ever derives levels from Vector full-state / the GEX
positioning matrix (call wall, put wall, gamma flip, spot, confluence zones, dark pool, gamma magnet,
GEX king, max pain) — all external-feed-sourced. The setup's OWN trigger/anchor geometry, which comes
straight off the swing gate's commit context (not Vector/GEX at all), had no structured home. This is
the exact same gap class already found and fixed for the Vector gamma magnet (see that fix's comment
in `levelsFromContext`, 2026-09-xx: "was never added to the structured envelope.levels array —
anything consuming levels ... had no way to see it") — just a second, previously-unchecked instance,
and a more consequential one, since these two levels don't depend on an external feed being warm.

### Evidence

Live audit, 2026-10-07 (RTH): `GET /api/market/nighthawk/horizons?view=swings` showed a live WATCH
candidate, WDC (SHORT, SECTOR_ROTATION, `setupState: TRIGGERED`, `entryStatus: AT_TRIGGER`,
`flagUnderlyingPx: 411.79`, `entryTriggerUnderlyingPx: 411.04`). Its play-brief
(`GET /api/market/swing/play-brief?playId=SWING:WDC&ticker=WDC&status=COMMIT`) rendered both numbers
correctly in the "Watch levels" section's prose/markdown —

> Flag anchor: **411.79** — track move from here
> Entry trigger: **411.04** — Break/reclaim below this is what actually fires the setup

— but `envelope.levels` was `[]` (empty) on that exact response. The brief's own `unavailableSources`
confirmed why: GEX positioning ("cold matrix / no positioning read") and Vector desk state ("snapshot
unavailable") were BOTH absent that cycle — the one case where the setup's own trigger geometry is the
*only* decision-relevant number available, and it was invisible to anything reading the structured
array (a "show on chart" follow-up chip, or any other Largo consumer of `levels`).

Confirmed via source read, not just the live repro: zero references to `flagUnderlyingPx` or
`entryTriggerUnderlyingPx` anywhere in `play-brief.ts` before this fix (`grep` returned no matches),
confirming the omission was total, not merely stale-gated like the Vector-sourced levels.

### Fix

`levelsFromContext` now takes the already-in-scope `bucket` parameter (passed by its one caller,
`composeSwingPlayBrief`, which already computes it) and, for WATCH-bucket plays only, pushes two new
structured levels sourced from `ctx.play` directly (not Vector/GEX, so never gated on either being
warm): `flag anchor` (`play.flagUnderlyingPx`, provenance `"Swing lane"`) and `entry trigger`
(`play.entryTriggerUnderlyingPx`, provenance `"Swing lane"`, `note` reusing the existing
`entryTriggerDeadReason()` — now exported from `play-brief-intel.ts` instead of duplicated — so a
dead/Legacy-pinned trigger carries the same honest caveat in the structured level as it already does
in prose, never silently presented as live when it is not).

Scoped to WATCH only, mirroring exactly where `watchForSection` itself renders these in prose — an
OPEN play has already crossed this geometry (irrelevant going forward) and a CLOSED play has no live
entry decision left to make, so surfacing it there would be stale noise the prose doesn't show either.

### Blast radius

One call site touched (`levelsFromContext`'s only caller, inside `composeSwingPlayBrief`) to thread
the `bucket` argument through; no other consumer of `levelsFromContext` exists. `entryTriggerDeadReason`
gained an `export` but kept its one existing call site (`watchForSection`) unchanged — purely additive.

### Tests

Two new tests in `src/lib/swing/play-brief.test.ts`: (1) a WATCH play with no Vector/GEX data still
surfaces both `flag anchor` and `entry trigger` as structured levels with `"Swing lane"` provenance and
the correct direction-aware note; (2) an OPEN/HOLD play with the same fields set does NOT surface them
(confirms the bucket gate). RED confirmed pre-fix via `git stash` (1 failure, the new WATCH-levels
test) / GREEN post-fix (114/114) in an isolated worktree off `origin/main` — a concurrent agent session
was using the shared checkout for an unrelated `vector-dark-pool-warm` investigation, so this fix was
developed in a separate `git worktree` rather than touching that session's working tree. `npx tsc
--noEmit` clean. Full `npm test` run separately to confirm no regression elsewhere.
