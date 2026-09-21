> **kind:** FINDING

## Ask Largo swing play-brief: `catalystCoaching`'s Meridian catalyst instruction never disclosed staleness, while the sibling bullet-dump section (`meridianCatalystSection`) already does — fix/swing-meridian-catalyst-coaching-staleness — 2026-09-21

| **Status** | FIXED |
|---|---|

- **What was broken:** `catalystCoaching(ctx)` in `src/lib/swing/play-brief-narrative-coaching.ts`
  reads `ctx.meridian?.items?.[0]` and, when the item is within 7 days, renders a confident,
  actionable narrative instruction: `**Catalyst today/tomorrow/in Nd** — **Title** (kind, impact).
  Vol can expand — tighten or reduce size.` It never checked whether `ctx.meridian` was fresh.
  `meridianCatalystSection` (`play-brief-intel.ts`, the bullet-dump display section that reads the
  exact same `ctx.meridian` slice) already does this correctly — it calls
  `meridianCatalystStale(slice, readMs)` and prefixes `**Last snapshot** (~Nm old) — catalyst
  calendar may lag.` whenever the read is stale, per its own 2026-09-15 Largo C2 doc comment.
- **Why this matters in practice:** `ctx.meridian.as_of` is stamped once, inside
  `loadMeridianTimelineResponse`'s `serverCache` wrapper, at the moment the Benzinga upstream fetch
  actually completed. Under `withServerCache`'s stale-while-revalidate path, a degraded Benzinga
  upstream can keep serving that same stored payload — and its original, un-bumped `as_of` — for up
  to `MAX_STALE_AGE_MS` (10 minutes, `server-cache.ts`). Before this fix, a member reading the
  narrative-coaching bullet (the more prominent, action-oriented surface of the two — a bare
  "tighten or reduce size" instruction, not a caveated calendar listing) had no way to know the
  catalyst it names could be minutes stale, while the same brief's own Meridian-catalysts
  bullet-dump section, a few lines away, *did* disclose exactly that risk for the identical
  underlying read. This is the same split the news-catalyst fix (#5166, referenced in
  `play-brief-absence.ts`'s comment above `newsCatalystStale`'s `unavailableSources` wiring)
  already named as a bug pattern for a sibling freshness signal: narrative prose and a
  staleness-aware sibling surface disagreeing about whether the same read is current.
- **Fix rationale:** thread the same `meridianCatalystStale`/`meridianCatalystAgeMs`/
  `ageSecondsLabel` trio `meridianCatalystSection` already uses, anchored to `ctx.readMs ?? Date.now()`
  (the same #5351/#5392/#5393/#5394 readMs-anchor discipline every other staleness check in this
  file already follows, so this bullet's own verdict can't disagree with `meridianCatalystSection`'s
  for the identical snapshot). When stale, prefix the SAME `**Last snapshot** (~Nm old) — catalyst
  calendar may lag` wording (plus "confirm the date/timing before sizing off it", since this bullet
  — unlike the display section — issues a specific sizing instruction) rather than suppressing the
  bullet outright: the underlying catalyst may well still be genuinely upcoming, so disclosure, not
  deletion, is the honest fix (same choice `meridianCatalystSection` made for its own staleLead).
  The `arsenal.earnings` branch of the same function is unaffected — that read carries no `as_of`
  anywhere in the codebase (confirmed by grep), so there is no freshness signal to thread there.
- **Evidence / Test:** two new tests in `play-brief-narrative-coaching.test.ts`
  (`catalystCoaching: FRESH Meridian catalyst renders the instruction with no stale-lead` /
  `catalystCoaching: STALE Meridian catalyst (as_of past the 120s bound) discloses the lag instead
  of asserting a fresh read`). RED→GREEN proven via `git stash` on the implementation file only
  (test file kept): pre-fix `137/138 pass, 1 fail` in `play-brief-narrative-coaching.test.ts`
  (exactly the new stale-case test); post-fix `138/138` pass. `npx tsc --noEmit` clean.
- **Blast radius:** single function (`catalystCoaching`), single call site
  (`collectCoachingBullets`, same file). No other consumer of this function exists.
