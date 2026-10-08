## 2026-10-08 — [FINDING, largo-narrative] Swing WATCH Command Deck pill (and the Ask Largo brief's own "Entry stance" label, which sources from the same function) showed generic WAIT on an EXTENDED-chase play instead of distinguishing it from a live setup — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (narrative/UX clarity — the play-brief's other fields already disclosed the real state, so no wrong trade-management data reached a member, but the quick-scan pill and the brief's own top-line label both under-communicated it) |
| **Component** | `src/features/nighthawk/command-deck/play-card-lifecycle.ts` (`swingActionDisplay`) |
| **PR** | fix/swing-watch-extended-chase-pill |

### Root cause

`swingActionDisplay`'s WATCH branch only special-cased ONE of `entry-enterability.ts`'s several
"this WATCH play is already dead" reasons — the calendar-deadline one (`play.watchEntryExpired`,
fixed 2026-09-12 to render an `EXPIRED` pill instead of generic `WAIT`). A DIFFERENT dead reason,
`setupState === "EXTENDED"` / `entryStatus === "EXTENDED_CHASE"` (price moved too far past the
trigger to enter cleanly — a structural "chase" condition, unrelated to the calendar clock), left
`watchEntryExpired` `false` and fell straight through to the same generic `WAIT` pill the
2026-09-12 fix was written to distinguish FROM. `deadPlayReason()` (entry-enterability.ts) is
already the canonical, broader "is this play dead for ANY of the four reasons" check —
`play-brief.ts`, `entry-verdict.ts` and `serving.ts` already read it — but `swingActionDisplay`
never adopted it, so it under-covered exactly the same way the now-fixed #5687 (today's earlier
wording-collision finding) under-covered before its own fix.

This matters beyond the Command Deck pill itself: `watchEntrySection` (`play-brief.ts`) sources
its own "**Entry stance:**" label directly from `swingActionDisplay(play)?.label` (line ~482), so
the SAME gap reached the Ask Largo play-brief's own top-of-section label, not just the deck badge.

**Corrects a stale claim in today's earlier finding** (`2026-10-08-swing-watch-entry-window-
wording-collision.md`, PR #5687/the "blast radius" section): it asserted *"`play-card-
lifecycle.ts`'s EXPIRED pill ... already treat[s] EXTENDED-chase as a dead state"* — confirmed
false by reading the actual source (`swingActionDisplay` never checked `setupState`/`entryStatus`
at all prior to this fix). Flagging this here rather than silently correcting it, per this repo's
own standing instruction to verify every claim against current source rather than trust a prior
write-up at face value.

### Evidence

Live repro, same NTAP WATCH play #5687 already found (`GET
/api/market/swing/play-brief?playId=SWING:NTAP&ticker=NTAP&status=WATCH`, 2026-10-08 ~07:57 ET,
post-#5687-merge): `entryStatus: "EXTENDED_CHASE"`, `setupState: "EXTENDED"`,
`watchEntryExpired: false`. The brief's own "Entry" section already correctly says:

```
Setup: **EXTENDED**
Entry geometry: **EXTENDED_CHASE**
```

and the top-level verdict/invalidation line already correctly says "Extended past the valid entry
window — do not chase; wait for a reset." — but the SAME response's "**Entry stance:**" line (and
the Command Deck pill `swingActionDisplay` drives) read **WAIT**, identical to what a freshly-
forming, perfectly live WATCH candidate shows.

Added 3 regression tests to `play-card-lifecycle.test.ts` reproducing: (1) `setupState: "EXTENDED"`
→ must render `EXTENDED`, not `WAIT`; (2) `entryStatus: "EXTENDED_CHASE"` (the exact live NTAP
shape) → same; (3) `watchEntryExpired: true` together with `entryStatus: "EXTENDED_CHASE"` still
resolves to `EXPIRED` (the narrower, pre-existing check still wins when both happen to be true —
no regression to the 2026-09-12 fix). Confirmed RED pre-fix via `git stash` (2 of the 3 new tests
failed against the old source — the third, EXPIRED-wins-over-EXTENDED, trivially passed since it
only exercises the pre-existing `watchEntryExpired` branch) and GREEN post-fix: full
`play-card-lifecycle.test.ts` suite 57/57 pass. `npx tsc --noEmit` clean.

### Fix rationale

Added a second, narrower condition directly beneath the existing `watchEntryExpired` check —
`if (play.setupState === "EXTENDED" || play.entryStatus === "EXTENDED_CHASE") return { label:
"EXTENDED", tone: "watch" };` — rather than swapping in the full `deadPlayReason()` helper.
Considered reusing `deadPlayReason` directly (it's already imported two call sites away in
`adapters.ts`, so the import path is proven safe from this feature directory), but:
- `watchEntryExpired`'s existing, separately-tested `EXPIRED` branch must keep winning when BOTH
  are true (confirmed by the third new test) — `deadPlayReason`'s own internal ordering already
  checks `watchEntryExpired` before the EXTENDED case, so reusing it whole would have been
  equivalent here, but the two-line, one-new-condition diff is smaller and changes nothing about
  any OTHER status branch (CLOSED/OPEN/HOLD/TRIM) that this function also handles.
- A distinct `EXTENDED` label (not reusing `EXPIRED`) keeps the two dead-reasons member-legible as
  different failure modes — "EXPIRED" specifically means the calendar deadline passed; "EXTENDED"
  means price ran away from the entry zone — matching the vocabulary `taxonomy.ts`'s
  `SwingSetupState`/`SwingEntryState` and the brief's own "Setup: EXTENDED" / "Entry geometry:
  EXTENDED_CHASE" lines already use, rather than collapsing both into one pill label.
- `setupState === "INVALIDATED"` and `entryStatus === "EXPIRED"` (contract-expired) were
  deliberately NOT added here: unlike EXTENDED-chase, no LIVE repro surfaced either state reaching
  `swingActionDisplay` with `status === "WATCH"` this cycle, and extending scope beyond a confirmed
  live reproduction risks an unverified behavior change on this file's other status branches. Left
  as a named, open follow-up rather than silently folded in.

### Blast radius

Single function, single call site inside it (the WATCH branch of `swingActionDisplay`) — the
CLOSED/OPEN/HOLD/TRIM branches of the same function are untouched, and the new condition is
additive (fires only when `setupState`/`entryStatus` carry these specific values, both `undefined`
in every pre-existing test fixture, so no existing assertion changed). Two consumers benefit from
the single fix: the Command Deck's own WATCH pill, and `play-brief.ts`'s `watchEntrySection`,
which sources its "Entry stance" label from this same function.
