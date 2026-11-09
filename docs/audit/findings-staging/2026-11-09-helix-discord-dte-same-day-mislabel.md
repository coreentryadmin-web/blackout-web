## HELIX Discord's own local `dteFromExpiry` was a third, unmigrated duplicate of the already-fixed §9.2 derivation — a genuine 0DTE contract read "1DTE" all session

> **kind:** `FINDING`

### Summary
`src/lib/helix-discord-format.ts` defined its own local `dteFromExpiry(expiry, now = new Date())`:

```ts
const ms = Date.parse(`${exp}T20:00:00.000Z`); // rough session-day boundary; filter only
return Math.ceil((ms - now.getTime()) / 86_400_000);
```

This is exactly the defect class `src/lib/flow-dte.ts`'s header documents as already fixed once
("HELIX-MAP.md §9.2 — ONE DEFINITION, NOT TWO"): a *live-clock*, UTC-anchored DTE derivation
instead of a *calendar-date* difference. That header explicitly names two prior duplicates
(`unusual-whales.ts`'s `parseUwFlowAlert` and `flow-persist.ts`'s own `dteFromExpiry`) and
consolidates both onto the one canonical, ET-calendar-date-anchored helper, imported today by
`unusual-whales.ts`, `flow-persist.ts`, and `ws/uw-socket.ts`. `helix-discord-format.ts` was never
migrated — it kept a third, independent copy of the pre-fix shape, invisible to that earlier sweep
because it lives in a different file under a different consumer (Discord formatting, not ingest).

### Evidence
For a contract expiring **today**, at any point during the regular session strictly before
20:00 UTC (i.e. essentially all of RTH, 13:30–20:00 UTC), `Date.parse(todayT20:00Z) - now.getTime()`
is a positive value strictly between `0` and `86_400_000` ms (one day) — and `Math.ceil` of any
such fraction is always `1`:

```
now   = 2026-08-04T14:32:00.000Z   (10:32am ET, same ET calendar day as expiry)
expiry = "2026-08-04"               (expires TODAY — a genuine 0DTE contract)

old dteFromExpiry("2026-08-04", now):
  ms   = Date.parse("2026-08-04T20:00:00.000Z")
  diff = ms - now.getTime()  =  19_680_000 ms  (5h28m, a fraction of a day, > 0)
  Math.ceil(19_680_000 / 86_400_000) = Math.ceil(0.2278) = 1   -> "1DTE" (WRONG)

canonical dteFromExpiry (flow-dte.ts), same inputs:
  todayEt(now) = "2026-08-04"  (same ET calendar date)
  expiryMs - todayMs = 0       -> 0   -> "0DTE" (correct)
```

This is not a rare tie — it is the **default** outcome for every expiring-today contract read
during the entire trading session, reproduced live via the exact literal expression from the
source (confirmed with a standalone script before editing anything).

Two call sites were affected:
- `resolveHelixDiscordDte`'s fallback, hit whenever a `HelixDiscordFlowInput.dte` field is absent
  (the primary live-print path usually carries a real `flow.dte` from ingest, so this path is a
  safety net — but a safety net that is *always* wrong for 0DTE is still a real defect).
- `stackHeadline` (feeding every `buildHelixStackedHitsDigestEmbed` Repeat-Hits-stack headline),
  which calls the buggy function **directly and unconditionally** — `FlowStrikeStack` (the type
  `computeFlowStrikeStacks` returns) carries no `dte` field at all, so there is no real-`dte`
  fallback available here. Every stacked-hit digest embed for a contract expiring today, posted
  during RTH, read "1DTE" instead of "0DTE" for the entire session — the exact distinction these
  community alerts exist to highlight (see `classifyHelixDiscordKind`'s `near`-kind cutoff and
  `helixDiscordWriteup`'s explicit `dte === 0 ? "0DTE" : "near-dated"` branch, which the single-print
  path reaches correctly today via real `flow.dte`, but which `stackHeadline` could never reach
  correctly through this path).

Existing tests in `helix-discord-format.test.ts` never caught this: every fixture that exercises
`resolveHelixDiscordDte`/`passesHelixDiscordFilters`/`classifyHelixDiscordKind` passes an explicit
`dte` field on the input object (taking the fast path, never the fallback), and the one existing
`buildHelixStackedHitsDigestEmbed` test uses an expiry 11 days out and never asserts on the DTE
label text at all.

RED → GREEN: two new tests added to `helix-discord-format.test.ts` — one exercising
`resolveHelixDiscordDte`'s fallback directly (same-ET-day expiry, two RTH timestamps, asserts `0`
not `1`), one exercising the full `buildHelixStackedHitsDigestEmbed` → `stackHeadline` path
end-to-end (asserts the rendered description contains `0DTE`, never `1DTE`). Confirmed RED by
reverting only `helix-discord-format.ts` (keeping the new tests) — 2/21 failures, exactly the two
new tests, with the old code producing `1` — then restoring the fix: 21/21 pass. Related suites
(`flow-dte.test.ts`, `flow-persist.test.ts`, `helix-discord-milestone.test.ts`,
`discord-eod-recap.test.ts`) all green, 46/46. `npx tsc --noEmit` clean.

### Fix
Deleted the local duplicate `dteFromExpiry` and imported the canonical, ET-calendar-date-anchored
one from `@/lib/flow-dte` (the same helper `unusual-whales.ts`/`flow-persist.ts`/`ws/uw-socket.ts`
already use at ingest), adjusting the two call sites for its `(expiryYmd, nowMs)` signature
(`now.getTime()` instead of passing the `Date` object). No other file imports `dteFromExpiry` from
`helix-discord-format.ts` (grep-confirmed), so removing the local export is safe.

An alternative would have been to special-case the UTC-20:00 boundary inside the local function —
rejected, because that is re-deriving the exact fix `flow-dte.ts` already made once; reusing the
one canonical definition is the whole point of that module's "ONE DEFINITION, NOT TWO" header.

### Blast radius
Two call sites in one file: `resolveHelixDiscordDte` (used by `passesHelixDiscordFilters`,
`classifyHelixDiscordKind`, `helixDiscordHeadline`, `helixDiscordWriteup`,
`buildHelixTopHitsDigestEmbed`) and `stackHeadline` (used by `buildHelixStackedHitsDigestEmbed`).
Grep-confirmed no other file imports `dteFromExpiry` from `helix-discord-format.ts`. Both are live,
currently-posting production surfaces (`helix-discord-notify.ts`'s `notifyHelixDiscordFlow`/
`deliverHelixBurstItems`, and the `helix-discord-digest` cron), not dead code. The rest of the
file's DTE-consuming logic (`dteLabel`, `classifyHelixDiscordKind`'s `<= 2` near-dated cutoff,
`helixDiscordWriteup`'s `0DTE`/`near-dated` branch) is unchanged — they already compute correctly
once given a correct `dte` number; the defect was entirely in how that number was derived.

### Why this wasn't caught by the earlier §9.2 sweep
That sweep (per `flow-dte.ts`'s own header) measured and fixed the two ingest-side derivations it
could find by tracing where a persisted `dte` column/score gets written. This file's copy is
downstream of ingest (Discord formatting, not persistence) and was never on that trace — it re-derives
DTE from a live timestamp independently rather than reading the already-correct persisted value, so
grepping ingest call sites for the old pattern would not have surfaced it.

| **Status** | FIXED — this PR. |
