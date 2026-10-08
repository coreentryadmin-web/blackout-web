## 2026-10-08 — [FINDING, largo-narrative] Swing WATCH play-brief's "Entry" section could say the entry window had already closed AND, two lines below, that it still had "1 day left" — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (narrative-quality / UX confusion, no wrong trade-management data — the two facts shown were each individually correct, only the shared wording made them read as contradictory) |
| **Component** | `src/lib/swing/play-brief.ts` (`watchEntrySection`) |
| **PR** | fix/swing-watch-entry-window-wording-collision |

### Root cause

`watchEntrySection` (the "Entry" section of the Ask Largo swing play-brief, `GET
/api/market/swing/play-brief`) renders a forward-looking "Entry window closes **DATE** (**N days**
left)" line whenever `!play.watchEntryExpired && play.entryDeadline`. But `watchEntryExpired` is
set `true` by exactly ONE of `entry-enterability.ts`'s several "this play is dead" branches — the
calendar-deadline-expired one (`pastEntryDeadline`). A DIFFERENT dead-play branch in the same
function, `setup === "EXTENDED" || entry === "EXTENDED_CHASE"`, returns `enterable: false` with
`reason: "Extended past the valid entry window — do not chase; wait for a reset."` but does
**not** set `expired`/`watchEntryExpired` — because it isn't the calendar deadline that killed this
entry, it's the price having moved too far from the trigger zone (a structural "chase" condition,
unrelated to how many days are left on the clock).

Because `watchEntrySection`'s guard only checked `watchEntryExpired`, an EXTENDED-chase play with a
still-future `entryDeadline` passed the guard and rendered the forward-looking "days left" line —
directly above (same "Entry" section) the "Also gate-blocked (moot — extended past the valid entry
window)" line, which reuses `deadPlayReason()`'s own text for the EXTENDED case, and directly
beside the brief's top-level `invalidation` field, which (via the same `deadPlayReason` →
`${dead} — this setup is no longer live.` composition in `composeSwingPlayBrief`) reads "Extended
past the valid entry window — this setup is no longer live."

Both lines were independently correct — they describe two genuinely different things (a
calendar-deadline window vs. a price-extension "chase" window) — but sharing the word "window" in
the exact same section, about the exact same play, in the same response, reads as the brief flatly
contradicting itself: "this window already closed" right next to "this window still has 1 day
left." `deadPlayReason()` (entry-enterability.ts) is already the single authoritative "is this play
already dead for ANY of the four reasons" check — it's already imported and used a few lines below
in the SAME function for the gate-block "moot" qualifier — but the forward-looking line was gated
on the narrower, single-cause `watchEntryExpired` boolean instead of it.

### Evidence

Live repro during the 2026-10-08 Ask Largo standing-mandate health-check cycle: `GET
/api/market/swing/play-brief?playId=SWING:NTAP&ticker=NTAP` (2026-10-08, ~07:30 ET) returned, in
the same "Entry" section:

```
Setup: **EXTENDED**
Entry geometry: **EXTENDED_CHASE**
Entry window closes **2026-10-08 09:15 ET** (**1 day** left) — stale after that, wait for a fresh setup.
**Also gate-blocked** (moot — extended past the valid entry window) — see Trade manager read below.
```

and the envelope's top-level `invalidation` field read `"Extended past the valid entry window —
this setup is no longer live."` — the same play telling the reader in one place that its entry
window had already closed, and in another that it still had a day left.

Added a regression test reproducing the exact live state (`setupState: "EXTENDED"`, `entryStatus:
"EXTENDED_CHASE"`, `watchEntryExpired: false`, a future `entryDeadline`) — RED before the fix
(asserted the forward-looking line must NOT appear; it did), GREEN after. Confirmed via
`git stash` that the test fails against the pre-fix source and passes against the fix. Full
`src/lib/swing/play-brief.test.ts` suite: 120/120 pass post-fix (was 119/120 red on the new test
alone before). `src/lib/swing/entry-enterability.test.ts` (21/21) also unaffected — this fix
touches no logic there, only which existing field `play-brief.ts` reads.

### Fix rationale

Compute `const dead = deadPlayReason(play);` once at the top of `watchEntrySection` and gate the
forward-looking "Entry window closes" line on `!dead` instead of `!play.watchEntryExpired`. This
correctly suppresses the forward-looking line for EVERY dead-play reason (INVALIDATED,
calendar-deadline-expired, contract-expired, EXTENDED-chase) rather than just the one
`watchEntryExpired` already covered — matching the EXPIRED badge and the "Also gate-blocked (moot
— …)" line immediately below it, which already use the same `deadPlayReason` check. The
duplicate, redundant local `const dead = deadPlayReason(play);` a few lines further down (used for
the gate-block qualifier) is removed in favor of reusing the one computed up front — same value,
computed once.

Deliberately left unchanged: the underlying `entry-enterability.ts` reason strings themselves
(both still say "window" — "Entry-validity window expired" and "Extended past the valid entry
window"). Renaming those would touch a second, more widely-consumed surface (the reason text is
also rendered standalone elsewhere, e.g. `watchGateCoaching` in
`play-brief-narrative-coaching.ts`) for a cosmetic wording change with no functional benefit once
the line that caused the actual juxtaposition is suppressed — the collision only ever happened
because BOTH lines rendered in the same response; removing the one that renders when the play is
already dead removes the contradiction without touching reason-text strings three other call
sites may already depend on verbatim.

### Blast radius

Single call site (`watchEntrySection`, swing WATCH-bucket plays only — OPEN/HOLD/TRIM/CLOSED
don't reach this function). No other section reads `play.watchEntryExpired` for this same
forward-looking purpose (checked: `play-card-lifecycle.ts`'s EXPIRED pill and
`entry-enterability.ts`'s own `deadPlayReason`/`isSwingPlayStaleCheckExempt` both already treat
EXTENDED-chase as a dead state the same way this fix now does, so this brings `play-brief.ts` into
line with them rather than diverging further).
