> **kind:** FINDING

## `computeLitDarkRatio` — a future-dated print's timestamp leaks into `updated_at` as a future value — FIXED

**Status:** FIXED (round 317 audit sweep)

### Root cause

`src/lib/uw-lit-dark-ratio.ts`'s `latestPrintAgeMs()` computed the freshest dark-pool print's age as
a raw `now - latest` with no floor:

```ts
return latest > 0 ? now - latest : null;
```

`latest` comes from `Date.parse(p.executed_at)` on a UW-supplied timestamp, read against this
process's own `Date.now()`. Ordinary clock skew — NTP jitter, or a container clock that hasn't
fully converged, the exact failure mode this codebase already documents in
`src/lib/coaching-alert-age.ts`'s module header for a `TIMESTAMPTZ` column read against the app
clock — can make a print's `executed_at` read as slightly ahead of `now`. When that happens,
`latestPrintAgeMs` returns a **negative** age.

That negative `resolvedAgeMs` then flows into `computeLitDarkRatio`'s `updated_at` derivation:

```ts
if (resolvedFresh && resolvedAgeMs != null) updatedAt = Math.max(updatedAt, now - resolvedAgeMs);
```

For a negative `resolvedAgeMs`, `now - resolvedAgeMs` is **greater than `now`** — a future
timestamp. `LitDarkRatio.updated_at` (consumed by the SPX desk's dark-pool/lit-share display) is
then a timestamp in the future, which every "time ago" renderer in this codebase assumes can never
happen (the exact bug class already fixed in `FlowFeed.tsx`, `GexHeatmap.tsx`, `meridian-viz.tsx`,
and in this exact file's own 2026-09-05 fix for the raw `litTradesStore`/`darkPoolStore.updatedAt`
freshness checks — see the file's own `isWsUpdatedAtFresh` usage and test history). The 2026-09-05
fix closed the gap for the two raw WS-store timestamps; the later 2026-10-06/2026-10-21 additions
(`resolvedAgeMs`/`resolvedFresh`, for the caller-resolved-snapshot path) reopened the same future-
timestamp gap on a different code path that didn't exist yet when the original fix landed.

### Evidence

Added a regression test (`src/lib/uw-lit-dark-ratio.test.ts`) that passes a `resolvedDarkPool`
snapshot whose one print is stamped 30s ahead of `Date.now()` (clock skew):

- **Before the fix:** `computeLitDarkRatio(resolved).updated_at` is `now + 30_000` — strictly after
  `Date.now()` at assertion time. Test fails: `updated_at (...) must never be in the future`.
- **After the fix:** `latestPrintAgeMs` clamps the age at `Math.max(0, now - latest)`, so
  `resolvedAgeMs` is `0` instead of `-30_000`, and `updated_at` lands at `now` (never future). Test
  passes; the three pre-existing tests in the same file (source-scan guard, resolved-snapshot
  freshness, dead-store `updated_at` fix) continue to pass unchanged.

Confirmed RED→GREEN via `git stash`/`git stash pop` around the one-line fix.

### Blast radius

Single call site: `latestPrintAgeMs()` is private to this file and used only inside
`computeLitDarkRatio()`, which is consumed by `src/features/spx/lib/spx-desk.ts` (the SPX desk's
lit/dark premium share widget). No other file calls `latestPrintAgeMs` or constructs a
`LitDarkRatio` independently, so the fix is fully contained to this one function.

### Fix rationale

Clamp `latestPrintAgeMs` at zero, mirroring the established pattern this exact codebase already
uses for the identical problem (`coachingAlertAgeFields`'s `Math.max(0, nowMs - t)`, and the prior
`isWsUpdatedAtFresh`-based fix in this same file for the two raw WS stores): a future-dated
timestamp reads as "as fresh as possible" (age 0), never as a negative age. This fixes both
`resolvedFresh`'s freshness determination (unaffected in practice — a negative age was already
`<= LIT_DARK_MAX_AGE_MS`) and, more importantly, the `updated_at` derivation that depends on the
same value, without weakening the freshness bar for genuinely stale snapshots (unchanged:
`latestPrintAgeMs` still returns a large positive age for an old print, which still correctly fails
`resolvedFresh`'s `<= LIT_DARK_MAX_AGE_MS` check).

Left unchanged: the 2026-09-05 `isWsUpdatedAtFresh` guard on the two raw WS-store timestamps (not
the broken code path), and the `resolvedFresh`/`darkStoreFresh` priority logic (unrelated to this
clamp).
