## Ask Largo "Remember TICKER" watchlist button had no in-flight guard and no error handling — a failed save looked identical to a successful one, and a double-click fired two concurrent writes

> **kind:** `FINDING`

### Summary
`LargoActionsBar.tsx` renders the "Remember `<TICKER>`" button that appears on every Ask Largo
answer carrying a ticker (`buildLargoActions` in `src/lib/largo/largo-actions.ts` always appends a
`#watchlist:<TICKER>` action, capped at 5 total actions). Its `onClick` handler was:

```tsx
onClick={() => {
  if (!sessionId) return;
  void updateLargoWatchlist(sessionId, ticker).then(() => onWatchlistSaved?.(ticker));
}}
```

Two real defects, both from the same missing piece — the click handler never tracked or surfaced
the request's outcome:

1. **No `.catch()` — a failed save produces an unhandled promise rejection and literally zero
   user-visible feedback.** `updateLargoWatchlist` (`src/lib/api.ts`) `throw`s on any non-2xx
   response. With no `.catch()` anywhere in the chain, that rejection is unhandled: it surfaces
   only as a console warning (or, in a stricter runtime, could terminate the process), and the
   button's own label/appearance never changes. A member who clicks "Remember NVDA" while the
   `/largo/session` PATCH endpoint is erroring (a transient 5xx, an expired session, a rate limit)
   sees the exact same button, in the exact same state, as a member whose click succeeded — there
   is no way to tell the two apart from the UI. The member walks away believing NVDA is on their
   watchlist when it is not.
2. **No in-flight guard — nothing stops a second click from firing a second concurrent PATCH for
   the same ticker.** The button was never disabled and carried no pending state, so a double-click
   (easy to do on a small action-bar button, and a reasonable thing to do when the first click gave
   no feedback per defect 1) issues two independent `updateLargoWatchlist(sessionId, ticker)` calls
   racing each other against the same session's watchlist field.

Both defects trace to the same root cause: the component already receives an `onWatchlistSaved`
callback prop meant exactly for this (a confirmation hook), but it is never wired from
`LargoAnswerMessage.tsx` (`<LargoActionsBar actions={actions} sessionId={sessionId} />` — no
`onWatchlistSaved` passed), so the one piece of plumbing that could have surfaced success was
already dead code, and failure had no path to be surfaced at all, dead or otherwise.

### Evidence
Pre-fix behavior, reproduced in the new regression test (`shouldIssueWatchlistRequest` — the pure
guard extracted from the click handler — always returned `true`, i.e. no guard existed):

```
shouldIssueWatchlistRequest("pending") // pre-fix semantics: true  (post-fix: false)
```

RED → GREEN: with the guard function's body reverted to the pre-fix `return true` (confirmed via a
local revert, not `git stash`, since this is a newly-added file with no prior commit to stash
against — same proof shape, applied by editing the function body back to the buggy behavior and
restoring it after), test 1 of 4 in `largo-watchlist-status.test.ts` fails exactly as shown:

```
# fail 1 — "shouldIssueWatchlistRequest blocks a second click while the first request is in flight"
```

Post-fix: 4/4 pass. `npx tsc --noEmit` clean.

### Blast radius
Only `LargoActionsBar.tsx` renders this button, and only one call site renders the component
(`LargoAnswerMessage.tsx`, unchanged by this PR) — no other consumer is affected. `src/lib/api.ts`'s
`updateLargoWatchlist` itself is unchanged; this fix is entirely in how its caller handles the
promise.

### Fix
Added a small, independently-testable status machine
(`src/features/largo/components/largo-watchlist-status.ts`): a `WatchlistButtonStatus` of
`"idle" | "pending" | "saved" | "error"`, a `shouldIssueWatchlistRequest(status)` guard, and a
`watchlistButtonLabel(baseLabel, status)` label resolver. `LargoActionsBar` now keeps a
per-ticker status map (`useState<Record<string, WatchlistButtonStatus>>`), sets `"pending"`
before issuing the request (guarded by `shouldIssueWatchlistRequest`), and both `.then()` (→
`"saved"`, calling `onWatchlistSaved` — now actually reachable for a future caller that wires it)
and `.catch()` (→ `"error"`) update that status, so success and failure are finally distinguishable
and the button is `disabled`/`aria-busy` while in flight. Left `onWatchlistSaved`'s prop contract
unchanged (still optional, still fires only on confirmed success) — this PR fixes the component's
own internal silence, not whether a parent chooses to also react to the callback.

Deliberately did not touch `LargoAnswerMessage.tsx` (two other open PRs are already mid-flight on
that file) or `src/lib/api.ts`.
