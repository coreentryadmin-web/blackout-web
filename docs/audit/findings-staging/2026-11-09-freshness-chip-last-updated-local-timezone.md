# 2026-11-09: shared FreshnessChip's "Last updated" hover title rendered in the viewer's browser timezone, not ET — affects every one of its 18 call sites across every desk

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`src/components/ui/FreshnessChip.tsx` is the shared freshness/staleness indicator used across the
product (18 call sites across Vector, Thermal, Night Hawk, Helix, Meridian and others). Its hover
`title` attribute shows an absolute "Last updated …" stamp via `asOf.toLocaleString()` — with no
`timeZone`, so it rendered in the **viewer's own browser timezone** instead of ET, the one clock
this product quotes everywhere else (`src/lib/et-clock.ts`'s header: "A markets desk quotes one
clock: US/Eastern"). The chip's own *visible* text (the relative age, e.g. "· 5s") is computed from
epoch-ms deltas and is correctly timezone-agnostic — only the supplementary hover title, which
spells out the actual wall-clock moment, carried the bug. Same bug class already fixed three times
this session in `DarkPoolPanel.tsx` (#7824), the admin `SignalAnalyticsPanel` (#7826), and
`UserManagement.tsx` (#7828) — this is the fourth instance, and by call-site count the
highest-blast-radius one yet, since it is a single shared leaf component reused across nearly
every desk rather than a single page's own formatter.

## Root cause

```ts
title={
  [title, now != null && asOf ? `Last updated ${asOf.toLocaleString()}` : null]
    .filter(Boolean)
    .join(" · ") || undefined
}
```

`asOf.toLocaleString()` with no arguments renders using the runtime's configured locale AND
timezone — in a browser, the viewer's own OS/browser settings, not `America/New_York`. Confirmed
by switching `process.env.TZ` mid-process to a zone ahead of ET and reformatting the same instant:
a 2026-07-13 22:15 EDT instant (2026-07-14T02:15:00Z) read back as the correct ET wall-clock stamp
under `TZ=UTC` (sandbox default) but would read a full calendar day later for a viewer in
`Pacific/Auckland` (UTC+12 in July) with no pin.

## Evidence (RED → GREEN)

Extracted the title-formatting logic into a pure, exported helper (`formatFreshnessTimestamp`) so
it is directly unit-testable — the component itself only renders the title post-mount (`now !=
null`), so a pure sibling function is the same pattern `UserManagement`'s `admin-user-account-date.ts`
(#7828) used for a React component that can't be rendered+asserted as cheaply as a pure function.

RED (pre-fix, via `git stash` isolating only the source change, keeping the new test):
```
not ok 4 - formatFreshnessTimestamp anchors the hover-title stamp to ET, not the viewer's local zone
  error: '(0 , import_FreshnessChip.formatFreshnessTimestamp) is not a function'
```

GREEN (post-fix):
```
npx tsx --experimental-test-module-mocks --test \
  src/components/ui/FreshnessChip.freshness.test.ts src/components/ui/FreshnessChip.ssr.test.ts
# tests 6, pass 6, fail 0
```
The pre-existing SSR test (`FreshnessChip.ssr.test.ts`, the React #418 hydration-mismatch guard)
still passes unmodified — the title still only appears post-mount, so this fix changes nothing
about SSR determinism. `npx tsc --noEmit` clean on Node 20.

## Fix

Extracted `formatFreshnessTimestamp(asOf: Date): string` as a new exported pure helper that pins
both `timeZone: "America/New_York"` and the locale (`"en-US"`, matching `et-clock.ts`'s own
rationale: the same instant should read identically regardless of the viewer's OS locale, not just
their zone) and swapped the inline `asOf.toLocaleString()` call for it. No change to the chip's
visible relative-age text, status coloring, or any other prop — only the hover-title's absolute
timestamp is affected.

## Blast radius

One function, one file, but 18 call sites across the product all inherit the fix simultaneously —
grepped every `FreshnessChip` usage; none pass their own competing `title` logic that would need a
separate fix, since the "Last updated" stamp is always generated internally by the chip itself from
its own `asOf` prop. No caller asserts the old (unpinned) string in its own tests — grepped for
`"Last updated"` across the test suite and found none outside this component's own tests.
