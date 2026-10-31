> **kind:** FINDING

## Admin BIE dashboard "Auth failures (24h)" chip is hardcoded green regardless of count — FIXED

**Status:** FIXED (this PR)

### Root cause

`AdminBieDashboard.tsx` renders a row of `MetricChip`s in the "BIE control room" hero —
Embeddings, DB pool, Redis, Missed alerts, and Auth failures (24h). Every other chip in that
row conditions its `tone` prop on whether the underlying metric is actually degraded, e.g. the
chip immediately above this one:

```tsx
<MetricChip
  label="Missed alerts"
  value={data?.missed_alerts ? String(data.missed_alerts.outage_count) : "—"}
  tone={data?.missed_alerts && data.missed_alerts.outage_count > 0 ? "amber" : "bull"}
/>
```

But the "Auth failures (24h)" chip right after it was wired with a **literal** `tone="bull"`:

```tsx
<MetricChip
  label="Auth failures (24h)"
  value={data?.auth_failures ? String(data.auth_failures.total_24h) : "—"}
  tone="bull"
/>
```

`data.auth_failures.total_24h` comes from `countAuthFailures()`
(`src/lib/error-sink.ts`), which counts real `error_events` rows with
`source = 'auth_failure'` written by `AuthFailureObserver.tsx`'s beacon — a genuine
security-relevant signal (sign-in/session failures), not a cosmetic stat. Because the `tone`
prop is a string literal rather than an expression referencing `total_24h`, the chip renders
green ("bull") no matter how many auth failures fired in the last 24 hours. On an ops dashboard
whose whole purpose is to let an admin glance at a row of chips and immediately see what's
wrong, this one metric can never visually flag a problem — the admin would have to read the raw
number out of a sea of green chips to notice a spike.

### Evidence

Source-text regression test (`src/components/admin/admin-bie-auth-failures-tone.test.ts`),
following this repo's established convention for `"use client"` components with no React
Testing Library (see `AdminLaunchStatusPanel.test.ts`): it reads the component's raw source and
asserts the "Auth failures (24h)" chip's `tone` prop is not the literal `"bull"` and does
reference `total_24h`.

- **RED (pre-fix):** `AssertionError: Auth failures chip tone must not be hardcoded to "bull"` —
  `expected: '"bull"', actual: '"bull"'`.
- **GREEN (post-fix):** test passes once `tone` is
  `{data?.auth_failures && data.auth_failures.total_24h > 0 ? "amber" : "bull"}`.

`npx tsc --noEmit` clean. All 53 tests across `src/components/admin/*.test.ts` pass post-fix.

### Blast radius

Single call site — the "Auth failures (24h)" `MetricChip` in `AdminBieDashboard.tsx`'s hero
`chips` block. `data.auth_failures` is only read in this one place in the component (confirmed
via grep); no other panel or component reads `BieReportPayload.auth_failures`, so no other
render site shares this bug.

### Fix rationale

Matched the existing, already-correct sibling pattern (`Missed alerts`, `DB pool`, `Redis`,
`Embeddings` chips all condition `tone` on their own metric) rather than inventing a new
severity scheme: `tone={data?.auth_failures && data.auth_failures.total_24h > 0 ? "amber" : "bull"}`.
No threshold tuning needed — `>0` matches the exact convention `Missed alerts` already uses for
its own count (`outage_count > 0`). Nothing else in the file changed.
