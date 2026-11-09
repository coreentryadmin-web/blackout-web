> **kind:** FINDING

## Scheduled-cancel email showed the billing-end date a day ahead of ET — FIXED

**Where:** `src/lib/email/templates/scheduled-cancel.ts`'s internal `formatDate(d: Date | null)`.

**Root cause:** `formatDate` rendered `accessUntil` — an absolute instant, built in
`src/app/api/webhook/whop/route.ts` straight from Whop's `renewal_period_end` webhook field —
via `d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })` with no
`timeZone` option. That call defaults to the Node process's local timezone, which is UTC in
production (`node:20-bookworm-slim`) and in this sandbox alike — not this product's one clock,
`America/New_York` (see `et-clock.ts`'s module header). For any period boundary landing in the ET
evening, the UTC calendar date is already the next day, so the email showed the member's access
running through the WRONG calendar day.

**Why this was missed:** the sibling template `trial-ending-soon.ts`'s `formatTrialEndLabel`
formats the SAME `renewal_period_end` field and already explicitly pins
`timeZone: "America/New_York"` (commented "(America/New_York date)") — `scheduled-cancel.ts` was
the one outlier that never got the same treatment. Existing tests for this file
(`scheduled-cancel-engine-list.test.ts`, `scheduled-cancel-tier-blind.test.ts`) only assert on
engine-list content, never on the rendered date string, so the gap had no test coverage.

**Evidence (RED→GREEN):** new test `scheduled-cancel-et-date.test.ts` passes
`accessUntil = new Date("2026-12-01T02:00:00Z")` (2026-11-30 21:00 ET, EST). Pre-fix, the
subject/body rendered "December 1, 2026" (the UTC calendar date) — confirmed live in this sandbox,
whose default TZ is also UTC (`Intl.DateTimeFormat().resolvedOptions().timeZone === "UTC"`).
Post-fix, with `timeZone: "America/New_York"` added to the same `toLocaleDateString` call, it
renders "November 30, 2026", matching the real ET date and the sibling template's own convention.
48/48+ relevant tests pass; `npx tsc --noEmit` clean on Node 20.

**Fix:** add `timeZone: "America/New_York"` to `formatDate`'s existing `toLocaleDateString` call
— one line, matching `formatTrialEndLabel`'s established pattern for the identical input field.
No other behavior changed.

**Blast radius:** `formatDate` is called once, from `scheduledCancelEmail` (used only by the
"cancel at period end" webhook branch in `whop/route.ts`). No other caller.

| **Status** | FIXED |
