# SPX Slayer board badge's tooltip called a routine "market closed" state "SPX Slayer desk unavailable" on every single evening/weekend render

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (product-quality/trust — a misleading tooltip, not a data-correctness defect; the badge's own visible `headline`/`action` were already correct, only the `unavailable_reason` tooltip text was wrong) |
| **Area** | `src/features/spx/lib/spx-slayer-badge-map.ts` (`mapSpxPlayToBadge`) — read by `SpxSlayerBadgeStrip` in `src/features/nighthawk/components/zerodte-board-strips.tsx` |
| **Found by** | Standing 5-engine live monitor sweep — 2026-09-12 cycle, SPX Slayer health check (`GET /api/market/zerodte/board`, off-hours/weekend) |

## What was found

Live `GET /api/market/zerodte/board` (Saturday, market closed) returned:

```json
"spx_slayer_badge": {
  "available": false,
  "headline": "Session closed",
  "unavailable_reason": "SPX Slayer desk unavailable"
}
```

The badge's own `headline` field correctly says "Session closed" — an honest, calm, expected
state. But `SpxSlayerBadgeStrip`'s tooltip (the `title` attribute shown on hover, and the only
text visible for a non-live badge — the visible pill itself just says "IDLE") reads
`badge.unavailable_reason`, which for this exact state was the generic
**"SPX Slayer desk unavailable"** — wording that reads like an outage or a broken feed, not a
scheduled market closure.

## Root cause

`mapSpxPlayToBadge` derived `unavailable_reason` as:

```ts
unavailable_reason: payload.available ? null : payload.idle_message ?? "SPX Slayer desk unavailable",
```

`SpxPlayPayload.idle_message` and `.headline` are usually set to the SAME string on every
`available:false` branch (e.g. the "desk warming" cold-start branch:
`headline: "Desk warming — play state unavailable"`, `idle_message` identical) — so in practice
`idle_message` looked like a safe, always-populated source for the badge's reason text.

It is not. `evaluateSpxPlayCore`'s CLOSED-SESSION terminal branch in `spx-play-engine.ts` (the
`!desk.market_open && !premarket` path — i.e. every evening from close to 6:30am PT, and all
weekend, whenever there is no open play left to force-settle) deliberately sets:

```ts
headline: "Session closed",
idle_message: null,
```

`idle_message` is `null` there on purpose (it isn't a generic "idle/scanning" state — it's a
terminal closed state with its own distinct headline), but the mapper's fallback discarded the
real, already-computed `headline` sitting right next to it and fell straight to the generic
`"SPX Slayer desk unavailable"` string instead.

## Blast radius

Single call site (`mapSpxPlayToBadge`), one consumer (`SpxSlayerBadgeStrip`'s `title`). This is
the **only** `available:false` `SpxPlayPayload` shape in production where `idle_message` and
`headline` genuinely diverge (grepped every `available: false,` payload builder in
`src/features/spx/lib/spx-play-engine.ts`/`spx-play-payload.ts`) — the other real branch ("Desk
warming") sets both fields identically, so this fix changes nothing there. But because the
CLOSED-SESSION branch fires for most hours in a week (every evening + every weekend, whenever no
position needs force-settling), the wrong tooltip was the far more common of the two — not a rare
edge case.

## Fix

`unavailable_reason` now prefers `idle_message`, then `headline`, then the generic string, in that
order — `payload.idle_message || payload.headline || "SPX Slayer desk unavailable"`. `||` (not
`??`) is used deliberately so a hypothetical empty-string field can never win over a real fallback
either; `SpxPlayPayload.headline` is typed as a required `string`, but nothing enforces non-empty
at every call site, so the defensive generic floor is kept as the true last resort.

## Tests

`src/features/spx/lib/spx-slayer-badge.test.ts`:
- Replaced the one test whose fixture combined a generic scanning-lane `headline` with
  `available: false` (a shape no real payload builder produces) with:
  - `"mapSpxPlayToBadge: available:false with no idle_message falls back to the payload's own
    headline (the real 'Session closed' shape), never the generic string"` — the real production
    repro: `idle_message: null, headline: "Session closed"` → `unavailable_reason` must equal
    `"Session closed"`.
  - `"mapSpxPlayToBadge: available:false with no idle_message AND no headline falls back to a
    generic reason"` — the true last-resort floor, both fields empty.
- The existing `"...derives unavailable_reason from idle_message"` test (idle_message and headline
  identical — the real "Desk warming" shape) is unchanged and still passes byte-for-byte.

RED confirmed via `git stash` on `spx-slayer-badge-map.ts` only (keeping the updated tests): 6/7
pass, 1 fail (the new "Session closed" case) → 7/7 after restoring the fix. Full `npm test`
(Node 20.20.2) and `npx tsc --noEmit` both clean on the fix branch.
