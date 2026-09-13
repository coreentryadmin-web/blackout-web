> **kind:** FINDING

## Command Deck mobile detail view stayed closed for a `?ticker=` deep link that coincided with the board's own default selection — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

Live repro, captured via `proxy-browser.cjs` against production: `GET
https://blackouttrades.com/nighthawk?view=swings&ticker=AAPL` at a 430×932 (phone) viewport. The
page rendered the Swings board's left rail (ticker list, session analytics, filters) and the AAPL
play-brief detail rail **stacked directly on top of each other**, bleeding through one another —
not the single-column "detail" view the mobile layout is supposed to switch to.

Root cause is in `CommandDeck.tsx`'s cross-deck-focus effect, which is the mechanism that both
(a) a Legacy "moved to Swings Open" link and (b) a URL-seeded `?ticker=` deep link
(`page.tsx` → `NightHawkFeed`'s `swingFocusTicker` → `HorizonDeck`'s `focusTicker` prop) use to
select a ticker's row AND open the mobile-only single-column detail view
(`.nh-deck[data-mobile-view="detail"]`, `globals.css`, which is what applies the CSS `transform`
that hides the list rail on narrow viewports):

```js
// BEFORE
useEffect(() => {
  if (!focusTicker) return;
  setStatusFilter("ALL");
  const match = plays.find((p) => p.ticker.toUpperCase() === focusTicker.toUpperCase());
  if (match && selId !== match.id) {
    setSelId(match.id);
    setMobileDetailOpen(true);
  }
}, [focusTicker, plays, selId]);
```

The guard `selId !== match.id` was meant as "only act if the selection would actually change" —
a way to avoid re-opening mobile detail on every poll refresh once a focus request has already
been handled (and, implicitly, to not fight a member who explicitly closed the detail view after
navigating). But it conflates two different facts: "has this focus request been handled" and
"does the CURRENT selection happen to match the target." A separate effect a few lines above
picks a DEFAULT selection (`preferredPlayId` — prefer OPEN/HOLD, then WATCH, then CLOSED) on
first load, with **no** mobile-detail side effect (deliberately — that's the board choosing a
default, not the member asking to see one). When the `?ticker=` deep-link target happens to also
be the board's own default pick — exactly AAPL's case: rank #2 by score, status HOLD, so
`preferredPlayId` picks it before the focus effect even runs — `selId` already equals `match.id`
on the very first render. The guard reads that as "already handled" and never calls
`setMobileDetailOpen(true)`, even though this was a genuine, never-yet-acted-on focus request.
The play's DATA was correctly selected (the right rail showed AAPL); only the mobile view-mode
flag was wrong, which is why the defect is purely visual/layout, not a data-correctness bug.

### Fix

Added `resolveFocusTickerMatch` (`deck-session-ui.ts`, alongside the module's other pure,
unit-tested UI-decision helpers like `preferredPlayId`), which tracks "has this **focusTicker
value** been handled" via a new `handledFocusTicker` state, decoupled entirely from `selId`:

```js
export function resolveFocusTickerMatch<T extends { id: string; ticker: string }>(
  plays: T[],
  focusTicker: string | null,
  alreadyHandledFocusTicker: string | null,
): { id: string } | null {
  if (!focusTicker || focusTicker === alreadyHandledFocusTicker) return null;
  const match = plays.find((p) => p.ticker.toUpperCase() === focusTicker.toUpperCase());
  return match ? { id: match.id } : null;
}
```

`CommandDeck.tsx`'s effect now calls this, and stamps `handledFocusTicker` to the resolved value
once acted on — so a genuine focus request always fires exactly once (fixing the coincidence
bug), while a poll refresh or a member's manual close of the detail view does NOT re-trigger it
(preserving the exact behavior the old `selId` guard was also protecting, just for the right
reason).

### Blast radius

Single call site — `CommandDeck.tsx`'s cross-deck-focus effect is shared by every horizon
(`focusTicker` feeds both the Swings `HorizonDeck` and, via `SwingCommandDeck = HorizonDeck`, any
other caller of the same component). Both known callers of this focus mechanism benefit: the
Legacy → Swings "moved to Open" hand-off link, and the `/nighthawk?ticker=` URL deep link used by
HELIX's cross-product context header and this session's own audit tooling.

### Fix rationale

Kept the fix at the same "pure decision function + thin effect" shape the file already uses for
`preferredPlayId`/`defaultZeroDteStatusFilter`/`markStreamKind`, rather than inlining more
conditional logic into the effect body — the pure function is what made this trivially unit
testable without a DOM/React-Testing-Library harness. Deliberately did not touch the unrelated
`setStatusFilter("ALL")` call's own repeated-firing behavior (it already runs once per handled
focus, same as before) since that is a different, unconfirmed question outside this defect's
scope.

### Evidence of testing

- Live screenshot evidence: `proxy-browser.cjs` capture of `/nighthawk?view=swings&ticker=AAPL`
  at 430×932 on production showed the list rail and AAPL detail rail rendered simultaneously,
  overlapping — the exact symptom this root-causes.
- New tests in `deck-session-ui.test.ts`: case-insensitive match + no-focusTicker no-op; fires
  even when the focus target coincides with an already-selected id (the exact live scenario,
  regression-proofing the fix); does not re-fire once a given focusTicker value has been handled,
  but does fire for a genuinely new one.
- RED confirmed: stashing only the `deck-session-ui.ts` source change (keeping the new tests and
  the `CommandDeck.tsx` caller, which then fails to import `resolveFocusTickerMatch`) reproduced
  3 failing tests (`resolveFocusTickerMatch is not a function`).
- GREEN: fix restored, 9/9 pass in `deck-session-ui.test.ts` (6 pre-existing + 3 new).
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20.20.2): run alongside this PR; see PR for final count.

Found during the Night Hawk Swings standing aggressive-mode improvement-hunt mandate, in direct
response to the operator's explicit request this session to send live screenshots of the product
— the screenshot itself surfaced the defect rather than a code-reading pass, which is exactly the
value of periodically validating with real pixels rather than API responses alone (per
`docs/audit/LIVE-UI-CONNECTION.md`'s standing guidance). Swing-lane/command-deck-local, no
scoring/gating/data-correctness impact — no cross-desk sign-off needed under the standing
CARVE-OUT discipline.
