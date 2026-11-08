> **kind:** FINDING

# Thermal admin health panel's "Regime events (24h)" total silently plateaued at the 200-row sample limit

| | |
|---|---|
| **Area** | Admin BlackOut Thermal health panel — `src/lib/admin-gex-health.ts` (`summarizeRegimeEvents`, `fetchGexHealthSnapshot`), consumed by `AdminBieDashboard.tsx`'s "Regime events (24h)" metric chip |
| **Severity** | P3 — admin-only observability dashboard, no member-facing or trading-decision impact, but it is the exact "headline total silently caps at a sample LIMIT" bug class, in a new location |
| **Status** | FIXED |

## Root cause

`fetchGexHealthSnapshot` (leg 2, durable regime-transition history) pulled `gex_regime_events`
rows with `fetchGexRegimeEvents({ limit: REGIME_EVENT_FETCH_LIMIT })`, where
`REGIME_EVENT_FETCH_LIMIT = 200` — a `SELECT ... ORDER BY observed_at DESC LIMIT 200` across
**every** ticker `computeGexEvents()` has diffed (not just the 3-ticker `REGIME_WATCHLIST`), per
the module's own doc comment. `summarizeRegimeEvents` then derived the panel's headline total
directly from that same bounded array:

```ts
export function summarizeRegimeEvents(
  rows: GexRegimeEventRow[],
  windowMs: number
): GexRegimeEventSummary {
  const cutoff = Date.now() - windowMs;
  const inWindow = rows.filter((r) => { /* ... */ });
  return {
    window_hours: Math.round(windowMs / 3_600_000),
    total: inWindow.length,   // <-- can never exceed 200, no matter the real count
    by_ticker: /* ... */,
    by_type: /* ... */,
  };
}
```

`AdminBieDashboard.tsx` renders this as a plain headline metric chip — `"Regime events (24h)"` —
not as a labeled sample or preview:

```tsx
<MetricChip
  label="Regime events (24h)"
  value={gexHealth ? String(gexHealth.regime_events.summary.total) : "—"}
  tone={gexHealth && !gexHealth.db_configured ? "neutral" : "violet"}
/>
```

Across ~11 heatmap-preset tickers, each able to log `flip_crossed`/`wall_broken`/
`regime_flipped`/`net_gex_sign_flipped` transitions independently all session long (the table's
own throttle persists *every distinct transition*, not once per ET-date), a genuinely volatile
day can produce well over 200 real rows in a trailing 24h window. On such a day the panel's
"Regime events (24h)" chip would silently read a flat `200` no matter how much larger the real
count actually was — understated with no error and no visible sign anything was capped, exactly
the scenario (real, elevated transition volume) the panel exists to surface. This is the identical
root-cause shape to `error-sink.ts`'s `countAuthFailures` bug fixed the same day in PR #7574 (a
"total" field derived from `rows.length` of a `LIMIT`-bounded sample), just in a different admin
health panel.

## Evidence (RED → GREEN)

Extended `summarizeRegimeEvents` to take a real, separately-sourced `totalCount` parameter instead
of deriving `total` from the sample array's own length, and added `countGexRegimeEventsSince`
(`src/lib/db.ts`, re-exported through `src/lib/providers/gex-regime-events.ts`) — a real, unbounded
`SELECT COUNT(*) FROM gex_regime_events WHERE observed_at > NOW() - (... milliseconds)::interval`
run alongside the existing bounded sample fetch (`Promise.all`, so one extra lightweight aggregate
query, not an added sequential round trip).

- **RED**: with the fix source files (`admin-gex-health.ts`, `db.ts`,
  `providers/gex-regime-events.ts`) reverted to their pre-fix bodies but the new/updated tests kept,
  `npx tsx --experimental-test-module-mocks --test src/lib/admin-gex-health.test.ts
  src/lib/providers/gex-regime-events.test.ts src/lib/db.test.ts` fails **7 of 74** tests —
  including the new `fetchGexHealthSnapshot: regime_events.summary.total is the REAL count, not
  the bounded sample's rows.length` test (asserts `total === 450` while the mocked sample returns
  only 1 row) and the new `summarizeRegimeEvents: total reflects the real caller-supplied count,
  never the sample's rows.length` test, plus 5 others that fail purely because the pre-fix function
  signatures don't match the new call sites (confirming the old code path is gone, not just
  untested).
- **GREEN**: with the fix restored, all 74 tests across the three files pass, including both new
  regression tests above and two new delegation tests for `countGexRegimeEventsSince` itself
  (db-not-configured → 0; delegates to the real db-layer count).

`npx tsc --noEmit` is clean. Full `npm test` launched in the background; will report back if it
surfaces anything unrelated.

## Blast radius

`summarizeRegimeEvents` has exactly one call site repo-wide (`fetchGexHealthSnapshot`, same file),
and that in turn has exactly one call site (`GET /api/admin/gex/health`), consumed by exactly one
UI surface (`AdminBieDashboard.tsx`'s "Thermal health" panel, "Regime events (24h)" chip) — so this
is the only consumer, and the fix closes the gap for all of it. `by_ticker`/`by_type` (the per-
breakdown fields) and the panel's separate `recent` rows table are unaffected and deliberately left
sample-derived — see fix rationale.

Checked the sibling `admin-helix-health.ts` (same "FOUR SIGNALS" pattern, same author, same day)
for the identical shape: it also pulls a bounded `ANOMALY_FETCH_LIMIT = 500` sample, but its
headline fields (`candidates_scanned`/`committed_count`/`near_miss_only_count`) are *distinct-ticker
set sizes*, not raw row counts, and its own doc comment explicitly argues the 500-row bound is
"generous vs. HELIX's real daily volume" (a handful to low tens of distinct tickers/day) — a
materially different, already-disclosed-safe bound, not the same bug. Left untouched.

## Fix rationale

Run a second, cheap, unbounded `COUNT(*)` aggregate (indexed on `observed_at`, the same column the
existing sample query already orders by) alongside the existing bounded sample, and feed that real
count — never `rows.length` — into `summarizeRegimeEvents`. Deliberately left `by_ticker`/`by_type`
sourced from the same 200-row sample: both are an explicitly bounded breakdown/preview over
whatever the sample happens to contain, not a field named or consumed as an exhaustive total, so
there is no equivalent bug there — only `total`, the one field actually displayed and read as a
total ("Regime events (24h)"), needed the real count. Added the new query at the `db.ts` layer
(mirroring every other `fetchX`/`countX` pair in that file) and threaded it through
`gex-regime-events.ts`'s existing `dbConfigured()`-gated wrapper pattern, rather than querying
inline from `admin-gex-health.ts`, to keep the "never touch `@/lib/db` directly from an admin
health module" layering the rest of the file already follows.
