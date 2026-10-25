## 2026-10-25 — [FINDING, P2 Night Hawk Swings / Ask Largo] `deskConsensusSection` cited a Legacy-promoted play's own originating event as independent corroborating history — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD, `fix/swing-desk-consensus-legacy-self-reference`) |
| **Found by** | Adversarially-verified live audit (Ask Largo standing mandate, CLAUDE.md "ASK LARGO × NIGHT HAWK SWINGS" section) |
| **Scope** | `src/lib/swing/play-brief-intel.ts` (`deskConsensusSection`) |

### Root cause

For a Legacy-promoted swing candidate (`promoteLegacyConfirmedToSwing` /
`buildLegacySwingArtifacts`, `src/lib/swing/legacy-confirm-promote.ts`), `nighthawk_recent`
(`EcosystemContext.nighthawk_recent`) — "the last time Legacy published a pick on this ticker,"
read with no awareness of how the CURRENT play itself came to exist — is, for a freshly-promoted
play, almost always the literal SAME edition that promoted this exact candidate:
`nighthawk-morning-confirm/route.ts`'s own session-match guard refuses to run
`promoteLegacyConfirmedToSwing` unless `editionFor === today`, and `buildLegacySwingArtifacts`
stamps `firstSeenAt: checkedAt` (that same run) onto the promoted row, which lands on
`TerminalPlay.detectedAt` via `terminalPlayFromHorizon` (`adapters.ts`, `detectedAt:
src.firstSeenAt ?? null`) — the exact "First flagged" date the Entry section of the same brief
narrates for this play (`play-brief.ts`'s `watchEntrySection`, "First flagged **N days ago**
(...)").

`deskConsensusSection` (`play-brief-intel.ts`) receives `play` as a parameter and already carries a
staleness gate (added 2026-09-12) comparing `nh.edition_for` against `sessionDate`/`play.exitAt` —
but that gate only asks "is this pick recent enough to be worth citing," never "is this pick
*this play's own origination event*." It had no self-reference guard at all, unlike the sibling
function in the same file, `entryTriggerDeadReason`, which already special-cases a Legacy-promoted
play for an analogous problem (a pinned, never-refreshed entry-trigger level) via
`isLegacyPromotedSignal(play.discoveryOrigin)` (exported from `legacy-confirm-promote.ts`).
`discoveryOrigin` is the right field — confirmed by reading the current `adapters.ts` and
`TerminalPlay` (`command-deck/types.ts`): it is "Discovery rails that found this play
(FLOW/BREAKOUT/PIN) — the origin badge," and a Legacy-promoted row stamps it with
`LEGACY_SWING_SIGNAL_KIND = "NIGHT HAWK"`.

### Evidence

Live `GET /api/market/swing/play-brief?playId=SWING:SPOT&ticker=SPOT&expandIntel=1`, all four
citing the identical 2026-10-23 date:

- Entry: "First flagged **2 days ago** (2026-10-23 09:15 ET) — still on WAITING FOR ENTRY, not yet
  graduated to a real position."
- Trade manager read: "**Also gate-blocked** (moot...) — **legacy_exempt**: Legacy morning-confirm
  promotion — Swing V2 confluence/Cortex gates were not evaluated on this path."
- Why this setup: "Score pillars: • **Night Hawk edition score** — +70 pts" (the exact singleton
  factors array only `legacy-confirm-promote.ts`'s `buildLegacySwingArtifacts` produces)
- Desk context: "Night Hawk Legacy's last pick on this name (**2026-10-23**) is still
  **unresolved** — weigh that track record against today's **LONG** setup before sizing."

The fourth line presents the play's own originating promotion event as if it were separate,
independent history to weigh when sizing the position — a self-referential citation dressed up as
corroborating evidence.

### Fix

Added a self-reference guard at the top of `deskConsensusSection`, right after the existing
`nh?.outcome`/`nh.edition_for` presence check and before the pre-existing staleness gate: when
`isLegacyPromotedSignal(play.discoveryOrigin)` is true AND the play's own origination date
(`etSessionDate(Date.parse(play.detectedAt))`) falls within 1 calendar day of the cited
`nh.edition_for` (`daysBetweenYmd`, already imported in this file from
`@/lib/meridian/meridian-event-expiry-core`), the section is suppressed (`return null`) rather than
rendering the self-referential "weigh that track record... before sizing" line. The 1-day slack
(not strict equality) covers a promotion run that lands just across an ET midnight boundary from
whichever instant `edition_for` was itself stamped from; in the ordinary case both dates are
byte-identical, as in the live SPOT evidence above.

A genuinely independent, older Legacy pick on the same ticker — the ordinary case for a name that
appeared in Legacy before, unrelated to today's promotion — still narrates normally: the new guard
only trips when the cited edition is effectively the same event as the play's own origination, not
merely whenever the play happens to be Legacy-promoted.

### Fix rationale

Mirrors `entryTriggerDeadReason`'s already-established "is this play itself Legacy-promoted" check
(`isLegacyPromotedSignal(play.discoveryOrigin)`) rather than inventing a new detection mechanism —
same file, same signal, same semantics. Suppression (not a reworded citation) was chosen to match
this function's own existing sibling gate immediately below it in the same file (the 2026-09-12
staleness gate), which already suppresses the whole section rather than asserting stale/misleading
context with a caveat bolted on — consistent in shape with the rest of `deskConsensusSection`.
Deliberately left unchanged: the pre-existing staleness gate (still runs for every other case,
unaffected by this guard since it is checked independently and earlier); every other Legacy-promoted
narration elsewhere in the brief (Entry's "First flagged", Trade manager read's `legacy_exempt`
gate-moot line, "Why this setup"'s edition-score pillar) — those are not self-referential, they each
narrate a genuinely distinct fact about the SAME originating event rather than citing it a second
time dressed as independent history.

### Blast radius

Single call site: `deskConsensusSection` is only invoked from `composeSwingPlayBrief`
(`play-brief-intel.ts`), and `nighthawk_recent` is not read by this self-reference pattern anywhere
else in the Swing play-brief pipeline — the Entry/Trade-manager/Why-this-setup lines that also
narrate the same Legacy-promotion event each read different fields (`play.detectedAt`,
`play.gateBlocks`, `play.factors`) directly off `TerminalPlay`, not off `eco.nighthawk_recent`, so
none of them carry this same defect.

### Regression tests

Added two tests to `play-brief-intel.test.ts`'s `deskConsensusSection` suite:

- `deskConsensusSection: suppresses a Legacy citation that is the play's own originating promotion
  event, not independent history` — a Legacy-promoted play (`discoveryOrigin: ["NIGHT HAWK"]`)
  whose `detectedAt` ET-date matches `nighthawk_recent.edition_for` exactly; asserts the section is
  `null`. Confirmed RED pre-fix (rendered the live self-referential wording verbatim), GREEN
  post-fix.
- `deskConsensusSection: a Legacy-promoted play still narrates a GENUINELY independent, older
  Legacy pick on the same ticker` — same Legacy-promoted play, but `nighthawk_recent.edition_for`
  is 2 days before its own `detectedAt` (outside the 1-day self-reference window, inside the
  existing 4-day staleness window) — asserts the section still renders normally. Passed both before
  and after the fix (this guards against a too-aggressive suppression regressing the genuinely-
  independent case).

Ran the full `play-brief-intel.test.ts` (328/328 pass), plus `play-brief.test.ts`,
`entry-enterability.test.ts`, and `legacy-confirm-promote.test.ts` (239/239 pass across the three)
on Node 20 via `npx tsx --experimental-test-module-mocks --test`, and `npx tsc --noEmit` clean.
