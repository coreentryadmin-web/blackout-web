## Ask Largo swing play-brief could silently substitute an unrelated, weeks-old CLOSED trade for a live WATCH candidate

> **kind:** `FINDING`

### Root cause

`resolveSwingPlayForBrief` (`src/lib/swing/play-brief-resolve.ts`) ends with a ticker-wide
"best guess" fallback for when every targeted lookup above (open ledger, lane rows, the
positionId-based closed checks) comes back empty:

```ts
if (positionId == null) {
  const closedFallback = await loadClosedPlay(ticker, null);
  if (closedFallback) return { play: closedFallback, ... };
}
```

`loadClosedPlay(ticker, null)` ignores everything except the ticker and returns whichever graded
row has the most recent `graded_at` — a completely different trade than whatever the caller
actually asked about. The 2026-10-20 fix already scoped this fallback to fire only when the
caller never supplied a specific **positionId** ("an explicit, unresolvable positionId must
surface as absence, never as an unrelated substitute"). It never considered the mirror case: a
caller that names a specific **live-lane status** instead.

A WATCH-bucket (or COMMIT-blocked-shown-as-WATCH) swing candidate has no DB row and therefore no
positionId at all — `horizonRowToDeckSource`'s own comment says so explicitly ("A WATCH/lane-only
candidate has no ledger row yet, so this stays null there"). So the real production request for
one of these never carries a positionId, only a `status` hint:

- `useSwingPlayBrief`'s `briefUrl()` (`src/hooks/useSwingPlayBrief.ts`) builds
  `?playId=SWING:<ticker>&ticker=<ticker>&status=<play.status>` for every WATCH-bucket
  `TerminalPlay` it renders, with no `positionId` param (there is no numeric suffix on `play.id`
  to extract one from).
- Largo's own `get_swing_play_brief` tool (`src/lib/largo/tool-defs.ts`) is documented to accept
  an optional `status` hint ("e.g. OPEN, WATCH, CLOSED") to disambiguate, and `run-tool.ts` passes
  it straight through with no positionId either.

When the live serving lane (`getSwingServingLane`, read fresh inside `loadLaneRows` on every
request — a **separate** computation from the `/horizons` board endpoint's own snapshot) happens
to carry no row for that ticker at the exact instant this route runs — which happens routinely as
the swing discovery scan rotates candidates in and out every few minutes — `pickLanePlayForBrief`
legitimately returns nothing. With `positionId` always null for this request shape, the code fell
straight through to the unconditional ticker-wide fallback and silently served the ticker's most
recent CLOSED trade instead, with `available:true` and no absence/retryable signal of any kind.

### Evidence

Live-reproduced against production (`https://blackouttrades.com`, 2026-10-26, authenticated via
`scripts/audit/lib/prod-clerk-session.mjs`):

1. `GET /api/market/nighthawk/horizons?view=swings` showed MSTR as a live WATCH candidate under
   `board.lanes.SWING.watch[]` (`status: "WATCH"`, `commitGateBlockedBy: ["legacy:exempt"]`, no
   `positionId`).
2. `GET /api/market/swing/play-brief?playId=SWING:MSTR&ticker=MSTR&status=WATCH` — the **exact**
   request shape `useSwingPlayBrief` builds for that row — returned `available:true` with
   `briefContentKey.headline: "STOPPED — MSTR 160C 4DTE"`, `pnlPct: -62.31`, and section titles
   (`Outcome`, `Since it closed`, `Lessons`) that only ever render for a CLOSED play — not the
   WATCH candidate that was actually on the board.
3. A second `/horizons?view=swings` read a few minutes later confirmed MSTR had genuinely rotated
   out of the live WATCH list by then (replaced by a different ticker) — the live-lane lookup
   failing was real, not a fetch error, which is exactly the condition this fallback needs to
   guard against rather than paper over.

Regression test added to `src/lib/swing/play-brief-resolve.test.ts` (3 new cases): confirmed
**RED** pre-fix via `git checkout -- src/lib/swing/play-brief-resolve.ts` (the "must return
absence" case failed, resolving to the MSTR-shaped CLOSED fixture instead of `null`) → **GREEN**
post-fix (all 3 new cases + the existing 36 in the file pass). Full `src/lib/swing/*.test.ts`
suite: 2119/2119 pass. `src/lib/largo/swing-play-brief-read.test.ts`: 4/4 pass. `tsc --noEmit`:
clean.

### Blast radius

Any WATCH-bucket (or COMMIT-blocked, shown-as-WATCH) swing candidate with a prior closed trade
under the same ticker is exposed, through both read paths that share this resolver:

- The Command Deck panel itself (`useSwingPlayBrief` polls every 8-20s during RTH via
  `briefRefreshMs`) — a member with a WATCH candidate's brief open could have it silently swap to
  an unrelated closed trade's headline/P&L on an ordinary auto-refresh, with no error state to
  explain the change.
- Largo chat answers via `get_swing_play_brief` — the model could narrate the substituted closed
  trade's P&L/outcome as the current read on a ticker a member is actually asking about as a live
  WATCH candidate.

No other call site of `resolveSwingPlayForBrief` or `loadClosedPlay` was touched — the fix is
isolated to the one fallback branch.

### Fix rationale

Reused the `wantsClosed` boolean already computed a few lines above (it already encodes "the
caller explicitly asked for CLOSED") to derive `explicitlyWantsLiveState = status != null &&
!wantsClosed`, and skip the ticker-wide fallback when that's true:

```ts
const explicitlyWantsLiveState = status != null && !wantsClosed;
if (positionId == null && !explicitlyWantsLiveState) {
  const closedFallback = await loadClosedPlay(ticker, null);
  ...
}
```

This preserves every existing behavior:
- No status supplied at all (the ambiguous ticker-only query both the route and Largo's own tool
  doc describe as the common case) — fallback still fires, unchanged.
- `status=CLOSED` explicitly supplied with no positionId — fallback still fires (this is exactly
  what it's for).
- A real live-lane match exists for the requested status — unaffected, returns that match as
  before; this fix only changes the **no-match** case.

Deliberately left unchanged: whether a mismatched-but-resolvable request (e.g. a stale
client-cached `status=OPEN` whose position has since genuinely closed) should fall back to the
closed trade — it should, and already does, because that case always carries a real `positionId`
(threaded through by `horizonRowToDeckSource` whenever a DB row exists) and is handled by the
earlier, positionId-scoped closed-lookup in this same function, never reaching this fallback at
all.

| **Status** | Fixed in PR #6817 (branch `fix/swing-play-brief-watch-closed-fallback`) |
|---|---|
