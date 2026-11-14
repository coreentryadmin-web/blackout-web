> **kind:** FINDING

# SPX closed-market thesis always says "resumes 6:30 AM PT", even on a weekend (fourth occurrence of this bug class)

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (correctness — misleading member-facing text, not a crash) |

## Root cause

`spx-play-engine.ts`'s closed-market branch (`evaluateSpxPlayCore`) hand-builds the play's
`thesis` string:

```ts
const closedThesis = staleClauses.length
  ? `Desk offline · ${desk.market_label ?? "CLOSED"} · resumes 6:30 AM PT · ${staleClauses.join(" · ")}`
  : `Desk offline · ${desk.market_label ?? "CLOSED"} · resumes 6:30 AM PT`;
```

This is correct on an ordinary weeknight (the desk really does resume "tomorrow morning," which
the text correctly leaves unstated rather than spelling out) but actively misleading on a
weekend: confirmed live **Saturday 2026-11-14** via `GET /api/market/spx/play` — the response
read `"Desk offline · CLOSED · resumes 6:30 AM PT"`, which a member reads as "later today" or
"tomorrow," when the real resume time is **Monday**, roughly 48 hours away. `desk.market_label`
carries no weekend-specific value (it's `"CLOSED"` identically for a Saturday and an ordinary
weeknight), so nothing in the string construction could ever have disambiguated the two cases.

This is the **fourth** occurrence of the same underlying bug class this file's own code comments
already document three prior fixes for (NYSE holiday, pre-open, a live data outage during
ordinary mid-RTH hours — see `spx-play-context.ts`'s header comments) — each time, a different
trigger exposed the same root mistake: text that assumes "closed" always means "resumes
tomorrow morning."

A sibling module, `spx-commentary-offline-copy.ts`'s `commentaryOfflineTone()`, had already
solved this exact problem for its own "weekend" copy pool, by checking the ET weekday
independently rather than trusting `market_label`:

```ts
function etWeekday(now = new Date()): number { /* ... */ }
export function commentaryOfflineTone(desk?: { market_label?: string } | null): CommentaryOfflineTone {
  const day = etWeekday();
  if (day === 0 || day === 6) return "weekend";
  /* ... */
}
```

But `spx-play-engine.ts`'s `closedThesis` string never got the same treatment — it's a
completely separate display surface (the `/play` route's `thesis` field) from the commentary
module's copy pool.

## Fix

Extracted a new, independently-testable exported helper, `resumeDayPrefixForClosedThesis(now:
Date = new Date())`, reusing the already-imported-elsewhere-in-SPX `isTradingDayEt`/
`nextTradingDayEt` helpers (`@/features/nighthawk/lib/session`, already used by
`spx-play-context.ts`, `spx-market-session.ts`, `spx-play-session-guards.ts`, `spx-pin.ts`) to
name the actual next trading day — correctly skipping a holiday Monday too, not just a literal
weekend — rather than assuming "today" was ever a trading day at all:

- On an ordinary trading day: returns `""` — unchanged `"resumes 6:30 AM PT"`.
- On a non-trading day (weekend or holiday): returns `"<Weekday> "`, e.g. `"resumes Monday 6:30
  AM PT"`.

## Evidence (RED → GREEN)

`git stash` isolating the source fix, running
`npx tsx --experimental-test-module-mocks --test src/features/spx/lib/spx-play-engine.test.ts`:

- RED (pre-fix, new tests only): `# tests 24, pass 21, fail 3`
- GREEN (post-fix): `# tests 24, pass 24, fail 0`

Also ran `spx-play-engine.test.ts` + `spx-play-context.test.ts` together: 34/34 pass.
`npx tsc --noEmit`: clean, Node 20.

## Blast radius

One string-construction site in `spx-play-engine.ts`'s closed-market branch. The new helper is a
pure function with no side effects; its only caller is this one call site. Not touched:
`spx-commentary-offline-copy.ts` (already correct), `desk.market_label` itself (no new value
added — the fix works around its lack of a weekend-specific label rather than adding one).

## Files

- `src/features/spx/lib/spx-play-engine.ts` — new `resumeDayPrefixForClosedThesis()` export + call site
- `src/features/spx/lib/spx-play-engine.test.ts` — 3 new regression tests
- `docs/audit/findings-staging/2026-11-14-spx-closed-thesis-weekend-resume-text.md` — this file
- `docs/audit/MARKET-OPEN-VALIDATION.md` — next-session live validation checklist entry
