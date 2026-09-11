> **kind:** FINDING

## Swing entry-verdict silently drops real commit-gate reasons once a play's entry window has expired — FIXED

| | |
|---|---|
| **Area** | Night Hawk Swings — Ask Largo play-brief / Command Deck entry verdict |
| **Severity** | P3 (data-completeness / narrative-quality, not a wrong number) |
| **Status** | FIXED — `src/lib/swing/entry-verdict.ts` |
| **Found via** | Live Ask Largo deep-dive, `GET /api/market/swing/play-brief?playId=SWING:MU&ticker=MU` (2026-09-11 04:37 ET) |

### Root cause

`evaluateSwingEntryEnterability` (`src/lib/swing/entry-enterability.ts`) checks
`pastEntryDeadline(...)` (line ~125) **before** it checks whether any commit gates are still
blocking the setup (line ~149). Once a play's entry-validity window has expired — MU: first
flagged 2026-07-24, STANDARD sub-lane = 3-day validity, so by 2026-09-11 it was 48 days past
deadline — `evaluateSwingEntryEnterability` returns `action: "dont_buy"` with the generic reason
`"Entry-validity window expired — wait for a fresh setup."` and never reaches its own gate-block
branch, so the specific gate codes are never attached to *that* function's return value.

The real bug is one layer up, in `swingEntryVerdict` (`src/lib/swing/entry-verdict.ts`). It computes
`commitGateBlockedBy` unconditionally at the top of the function (via
`resolveSwingCommitGateBlockedBy`) — independent of *why* `evaluateSwingEntryEnterability` returned
`dont_buy` — but its `case "dont_buy":` branch only forwarded those gate reasons for the
`INVALIDATED`/`persistenceObserved` sub-case; the generic fallback (deadline-expired,
contract-expired, extended-chase) unconditionally returned `gateBlocks: null`, discarding
already-computed evidence rather than surfacing it. The sibling `case "wait":` branch two lines up
already did this correctly (`commitGateBlockedBy.length ? commitGateBlocksForVerdict(...) : null`)
— this was a copy/paste asymmetry between two branches that share the exact same input.

### Evidence — live MU repro, 2026-09-11 04:37 ET

`GET /api/market/nighthawk/horizons?view=swings` raw WATCH row for MU:
```json
{
  "ticker": "MU", "status": "WATCH",
  "commitGateBlockedBy": [
    "gate:G-S12:halt_feed_stale",
    "gate:G-S4:regime_degraded",
    "gate:G-S6:confluence"
  ],
  "firstSeenAt": "2026-07-24T13:38:31.000Z"
}
```
`GET /api/market/swing/play-brief?playId=SWING:MU&ticker=MU` — pre-fix — "Entry" section:
```
**Entry stance:** WAIT
Serving section: **WATCH**
Setup: **TRIGGERED**
Entry geometry: **AT_TRIGGER**
First flagged **48 days ago** (2026-07-24 09:38 ET) — still on WATCH, not yet graduated to a real position.
```
No "Gates blocking entry" block at all, despite 3 real, live, already-mapped gate reasons
existing for this exact ticker at this exact moment (halt-feed-stale, regime-degraded,
confluence-below-threshold) — every one of them member-actionable ("desk will not open until
regime clears", "confluence below commit threshold", etc., per `commitGateBlocksForVerdict`).

### Blast radius

`TerminalPlay.gateBlocks` (populated by `terminalPlayFromHorizon` via `swingEntryVerdict`,
`src/features/nighthawk/command-deck/adapters.ts`) is read by FOUR separate consumers, all of
which silently rendered nothing for this population:
- `src/lib/swing/play-brief.ts` `watchEntrySection` — the play-brief's own "Entry" section
  (`if (play.gateBlocks?.length) { ... "Gates blocking entry:" ... }`).
- `src/lib/swing/play-brief-intel.ts:521-523` — "Before entry, clear:" section.
- `src/lib/swing/play-brief-narrative-coaching.ts:136-137`.
- `src/lib/swing/play-brief-narrative.ts:355` — gate count used in narrative framing.
- The Command Deck swing card itself (same `gateBlocks` field, same adapter) — the live WAIT pill
  for any name past its entry window carried no gate detail either.

Any WATCH-lane name that is simultaneously past its entry-validity deadline AND still failing a
real commit gate hit this — not rare: any thesis that sits on WATCH long enough to age past its
3/2/5-day sub-lane window (a common outcome for names the regime/confluence gates keep blocking)
falls into exactly this branch.

### Fix

`src/lib/swing/entry-verdict.ts`, `case "dont_buy":` fallback branch: forward
`commitGateBlocksForVerdict(commitGateBlockedBy)` when `commitGateBlockedBy.length`, same as the
sibling `"wait"` branch — purely additive, changes no `recNote`/`actionLabel`/`recommendation`/
`deckStatus`, only restores the gate detail that was already computed and already had a
member-facing string ready.

### Test

`src/lib/swing/entry-verdict.test.ts` — new case reproduces the live MU input (STANDARD sub-lane,
`anchoredAt` 48 real days before `nowMs`, the 3 real gate codes) and asserts `gateBlocks` carries
all three mapped codes instead of `null`. RED pre-fix (`gateBlocks should carry the real,
already-computed gate reasons` assertion failed, `gateBlocks` was `null`), GREEN post-fix
(git-stash verified).

### Market-open validation

See `docs/audit/MARKET-OPEN-VALIDATION.md` — re-check MU's live play-brief (or any other WATCH
name past its entry window with an active commit-gate block) after this deploys: the "Entry"
section should now show a "Gates blocking entry:" block naming the real gate reasons instead of
silently omitting them.
