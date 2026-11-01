> **kind:** FINDING

## Ask Largo swing play-brief: `swingVerdictVerb` leaked stale `play.recommendation="HOLD"` for CLOSED positions whose exit wasn't a confirmed ladder hit — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** Ask Largo x Night Hawk Swings standing ownership mandate, live repro
`GET /api/market/swing/play-brief?playId=SWING:PANW:67&ticker=PANW&positionId=67&status=CLOSED`
(authenticated, production, 2026-11-01).

**Root cause:** `swingVerdictVerb(play, action)` (`src/lib/swing/play-brief.ts`) resolves the
member-facing verb shared by the envelope `headline`, `thesis` (`briefThesis`), and the Verdict
section's opening line as `action?.label ?? play.recommendation ?? play.status`. It special-cased
`play.status === "SKIP"` (→ "PASSED"), but had no special case for `play.status === "CLOSED"` —
the function's own prior doc comment claimed every other `deckStatus` "falls through to the
identical, unchanged `action?.label ?? play.recommendation ?? play.status` chain... a real
OPEN/HOLD position still reads HOLD exactly as it must," which silently assumed
`play.recommendation` is a trustworthy LIVE-state field for every non-SKIP status. It isn't for
CLOSED:
- `action = swingActionDisplay(play)` (`play-card-lifecycle.ts`) returns `null` for a CLOSED row
  whenever `closedReason === "target"` but `trimEnforcedBeforeClose !== true` (added by a same-day
  2026-11-01 fix in that file — a "closed green" is not necessarily a mechanical ladder exit), and
  also for an unclassified/unknown `closedReason`.
- When `action` is `null`, the chain falls to `play.recommendation`, which `terminalPlayFromHorizon`
  (`adapters.ts`) builds via `swingManagementVerdict` → `managementFor("SCALE_OUT", status, pnlPct)`
  (`adapters.ts:143-178`). That function has branches only for
  WATCH/SKIP/TRIM/doubled-RATCHET/deep-loss and otherwise **defaults to the literal string "HOLD"**
  (line ~159). CLOSED hits none of those branches (status isn't TRIM, exitModel is SCALE_OUT not
  RATCHET, and the `pnlPct` passed in for a closed row is `null` since `SwingClosedDeckSource`
  never sets `livePnlPct`), so it returns the stale default unconditionally.
- The two overlays that run after (`thesisHealth`, `fromAction` in `swingManagementVerdict`,
  `adapters.ts:197-216`) are both inert for CLOSED too (`thesisHealth` only computes for
  OPEN/HOLD/TRIM; `working = status==="OPEN"||"HOLD"||"TRIM"` is false), so nothing downstream ever
  corrects the default.

Result: `play.recommendation` stays the literal string `"HOLD"` for every CLOSED swing row, and
`swingVerdictVerb` surfaced it verbatim whenever `action` resolved to `null`.

**Live evidence:** the PANW brief above returned `envelope.headline = "HOLD — PANW 370C 1DTE"`,
`envelope.thesis = "LONG PANW 370C 1DTE — HOLD · Breakout continuation."`, and the markdown's
`## Verdict` section read `**PANW 370C 1DTE** · LONG · HOLD` — all three computed by/through
`swingVerdictVerb`. The SAME envelope's own `## Outcome` section, a few lines below, read:
`Exit P&L: +10.0%` / `Reason: target` / `MFE capture: +10.4%` / `Closed: 2026-10-29 10:00 ET`, and
the underlying record showed `trimEnforcedBeforeClose: false` (peak only reached +96.2%, never
crossed the ladder's own +100% trigger) — a closed, already-settled position narrated as a still-
open live hold, directly contradicting the brief's own Outcome section one section below.
Cross-checked against `GET /api/market/swing/record?days=90`: of the 64 `closedDeck` rows, 17 have
`closedReason === "target"` (exactly `summary.wins`), and **0 of those 17 have
`trimEnforcedBeforeClose === true`** — i.e. 17/17 (100%) of the currently-live winning closed Swing
positions hit this exact null-action path and showed the identical stale-HOLD contradiction.

**Fix:** added a `play.status === "CLOSED"` branch to `swingVerdictVerb` that falls to
`play.status` (the honest, generic `"CLOSED"` label — matching `playStatusDisplay`'s own CLOSED
pill) instead of `play.recommendation` when `action` is null. Mirrors the SKIP special case already
in the function, and matches `swingActionDisplay`'s own stated discipline for this exact branch:
"fall back to the generic CLOSED pill... rather than claim a ladder exit that may never have
happened." A CLOSED row whose `action` DOES resolve (TARGET/STOPPED/SCRATCH, confirmed by real
evidence) is completely unaffected — `action?.label` still wins. WATCH/OPEN/HOLD/TRIM are
untouched: `play.recommendation` is a live, meaningfully maintained field for those statuses, so the
existing fallback chain is unchanged for them.

**Evidence (RED → GREEN):** added a regression test to `src/lib/swing/play-brief.test.ts`
(`"composeSwingPlayBrief: CLOSED position with an unconfirmed 'target' close (never crossed the
trim ladder) does not leak stale HOLD"`), reproducing the PANW shape (`status: "CLOSED"`,
`closedReason: "target"`, `trimEnforcedBeforeClose: false`, `recommendation: "HOLD"`). RED
(fix reverted): headline read `"HOLD — PANW 90C 13DTE"`, exactly the live bug. GREEN (post-fix):
headline/thesis/Verdict all read `"CLOSED"` instead, never `"HOLD"`. Full blast-radius sweep (Node
20, `--experimental-test-module-mocks`):
`src/lib/swing/play-brief.test.ts` + `play-brief-narrative.test.ts` +
`play-card-lifecycle.test.ts` → 425/425 pass; the whole `src/lib/swing/*.test.ts` suite → 2194/2194
pass; `src/features/nighthawk/command-deck/*.test.ts` → 489/489 pass. `npx tsc --noEmit`: clean.

**Blast radius:** `swingVerdictVerb` is exported specifically so its SKIP special-case (and now
CLOSED special-case) is shared, not re-derived — three downstream call sites in `play-brief.ts`
(the envelope `headline`, `briefThesis`'s `thesis`, and the Verdict section's opening line) and two
in `play-brief-narrative.ts` (`actionNarrative`'s "Entry stance" bullet, `degradedReadLine`'s "Live
read" bullet) all reuse this one function, so all five agree automatically — no other file needed a
change. The watchEntrySection "Entry stance" label (`play-brief.ts` line ~987) only calls
`swingVerdictVerb` for `play.status === "SKIP"`, so it is unaffected by this CLOSED fix (CLOSED
positions don't reach that WATCH-only code path). Scope: 17/64 (26.6%) of the real closedDeck
population in the audited 90-day window hit this exact path — every winning closed position whose
exit wasn't a confirmed mechanical ladder hit.
