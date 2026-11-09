## HELIX dark-pool Discord ADV context line drops the most recent trading session — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | `src/lib/discord-context-enrichment.ts`'s `getTickerAdv20d` (consumed by `src/lib/darkpool-discord-notify.ts`'s `enrichAdvContext`, which attaches the "X% of 20D ADV" context line to every live HELIX/dark-pool Discord alert) |
| **Status** | FIXED |
| **File** | `src/lib/discord-context-enrichment.ts`, `src/lib/discord-context-enrichment.test.ts` |

### Root cause

`getTickerAdv20d` fetches a 35-calendar-day window of daily bars and passed an **explicit**
`limit="25"` to `fetchStockDailyBars`:

```ts
const data = await fetchStockDailyBars(key, from, to, "25");
```

`fetchStockDailyBars` (`src/lib/providers/polygon.ts`) always requests Polygon with `sort: "asc"`
(oldest first). With an explicit limit, it honors that limit verbatim instead of deriving one from
the window via `dailyBarLimitForWindow` (`Math.max(120, Math.ceil((ms/86_400_000)*(5/7)) + 10)`,
which would return `120` for this exact 35-day window — comfortably more than needed).

A 35-calendar-day window is 36 calendar days inclusive of both endpoints. Splitting those 36 days
by day-of-week: the weekday that the window's END date (`to`) falls on occurs **6** times in the
window, every other weekday occurs 5 times. Since `getTickerAdv20d` is only ever called from a
live, RTH-gated Discord alert path (`darkpool-discord-notify.ts`, gated by `isEtCashRth`), `to` is
always a weekday — so the window always contains **26** real trading sessions (5 x 5 + 1 extra),
before any holiday adjustment. A hard cap of **25** with ascending sort therefore returns the
OLDEST 25 of those 26 sessions and silently drops the **newest** one — i.e. it drops exactly the
session this ADV figure is supposed to contextualize a live print against.

This is the same class of bug CLAUDE.md's "Data-correctness notes learned" already documents for
`meridian-reaction-core.ts`'s `barLimitForWindow` ("Polygon aggregate `limit` MUST be derived from
the window, never fixed... `sort=asc` means a too-small cap returns the OLDEST N sessions and
silently drops the recent end — which presents as 'we don't have that data', not as a truncated
fetch") — a second, independent occurrence of the exact same trap in a different file, not a
duplicate of an already-fixed instance. Every other live caller of `fetchStockDailyBars` in this
codebase either omits the limit entirely (letting it derive from the window) or passes an
explicit limit for a deliberately single-day/large-window lookup (`"1"`, `"400"`, `"1000"`) — this
was the one caller passing a tight cap for a multi-week window.

### Evidence

- Confirmed the call shape: `grep -rn "fetchStockDailyBars(" src` shows every sibling caller either
  omits the 4th argument or passes `"1"`/`"400"`/`"1000"` for an explicitly single-day or
  deliberately wide window — `discord-context-enrichment.ts` was the sole caller hardcoding `"25"`
  for a 35-day window.
- Added `src/lib/discord-context-enrichment.test.ts`'s new test, mocking `fetchStockDailyBars` to
  return 26 ascending bars where only the **last** (most recent) bar carries a real volume spike
  (100M vs 1M for every other bar) — mirroring Polygon's real `sort=asc` + hard-limit behavior
  (`bars.slice(0, limit)` when a limit is passed). **RED** (pre-fix, explicit `"25"` limit):
  `adv` computed as exactly `1,000,000` — the spike (most recent) bar was dropped, confirmed by
  re-running the suite with the limit argument restored. **GREEN** (post-fix, no explicit limit):
  `adv` computed as `~4.81M`, correctly including all 26 bars.
- `npx tsc --noEmit` clean after the fix.

### Fix rationale

Removed the hardcoded `"25"` limit entirely so the call falls back to the shared
`dailyBarLimitForWindow` derivation already used by every other well-behaved caller — the same fix
shape CLAUDE.md documents for the original `meridian-reaction-core.ts` instance of this bug.
Deliberately did NOT touch `dailyBarLimitForWindow` or `fetchStockDailyBars` themselves (correct
and already shared by every other caller), and did NOT change the averaging logic (`vols.length`
over whatever bars come back) — only the one caller passing an unsafe explicit cap.

While making this testable, also switched the file's dynamic `await import("@/lib/providers/polygon")`
to a relative `await import("./providers/polygon")`. This is required, not cosmetic: tsx does not
rewrite `"@/..."` path aliases the same way for a dynamic `import()` as it does for a static one,
and (independently) registering `mock.module()` anywhere in a test file breaks `"@/..."` alias
resolution for *any* dynamic `import()` call reached during that test run — a repo-documented
tsx/Node-20 interaction (see `src/lib/correctness/heatmap-verifier.test.ts`'s and
`src/lib/admin-zerodte-health.test.ts`'s own comments on this exact failure mode, and the
`preEarningsPackForLargo` fix in `FINDINGS.md` that applied the identical relative-specifier
workaround for the identical reason). Confirmed directly in this sandbox: with the alias import in
place, `mock.module("./providers/polygon", ...)` — mocking a *different*, unrelated specifier —
still crashed the alias import with `ERR_MODULE_NOT_FOUND` on `.../src/lib/@/lib/providers/polygon`,
even with no network call ever reached; switching to the relative specifier fixed resolution AND
made the mock actually intercept the call.

### Blast radius

Single call site (`src/lib/darkpool-discord-notify.ts`'s `enrichAdvContext`) — the only consumer of
`getTickerAdv20d`. No other function reads this ADV value. The Discord "X% of 20D ADV" context line
on live dark-pool alerts was silently using a stale, 1-trading-day-behind average on effectively
every live call, understating ADV slightly on an ordinary day and, after any single real
volume/volatility spike the prior session, meaningfully understating it (making a genuinely large
print look smaller relative to "typical" volume than it actually was).
