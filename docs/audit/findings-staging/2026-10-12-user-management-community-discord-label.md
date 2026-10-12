## 2026-10-12 — [FINDING, P3 Admin console] UserManagement's "Community (Discord)" filter conflated the paid SPX Slayer tier with the free Discord perk — FIXED
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Admin console | P3 — misleading label, no access-control or data impact | FIXED |

**What's wrong.** `src/components/admin/UserManagement.tsx`'s "Access type" filter had:

```ts
{ value: "community", label: "Community (Discord)" },
```

But `"community"` is the paid SPX Slayer ($49/mo) tier, not Discord:
- `src/lib/tiers.ts`: `TIER_LABELS.community = "SPX Slayer"`.
- `src/lib/admin-user-access.ts:44-48`: the accessSummary for a `community`-tier user is literally
  `"SPX Slayer ($49) — SPX desk only"`.
- `src/components/admin/AdminToolsPanel.tsx:154` labels the *same* filter value correctly in the
  same admin console: `{ value: "community", label: "SPX Slayer ($49)" }`.
- Discord is a separate, free perk — `HomeCommunityRail.tsx`'s own test explicitly asserts the
  free Discord rail copy must never say "Community Discord tier" or "paid membership," i.e. the
  codebase already treats "paid community tier" and "Discord" as two things that must never be
  conflated. `UserManagement.tsx`'s label did exactly that.

**Impact.** An admin filtering users by "Community (Discord)" was actually filtering for paid
SPX Slayer subscribers, and would be confused finding no Discord-related field on any of them —
the same filter value is labeled correctly one panel over (`AdminToolsPanel.tsx`).

**Fix.** Changed the label to `"Community (SPX Slayer)"`, matching `AdminToolsPanel`'s existing
correct wording while keeping this filter's own `"X (Y)"` phrasing convention (its sibling options
read `"Premium (full desk)"`/`"Free (marketing only)"`).

**Regression guard.** Added to `UserManagement.test.ts` (which already uses a source-text
assertion convention for this exact file, from the 2026-10-12 Tier-select sync fix): asserts the
word "Discord" never appears near "community" in this file, and that the filter option reads
`"Community (SPX Slayer)"`.

**Verification.** RED→GREEN confirmed via `git stash` (1/3 fail pre-fix → 3/3 pass post-fix).
`npx tsc --noEmit` clean.

**Blast radius.** `UserManagement.tsx`'s Access-type filter dropdown label only — the filter's
underlying logic (what it actually filters by) was already correct; only the displayed text was
wrong. No other call site renders this string.

Found via a background Explore-agent sweep of the admin console beyond the cron dashboard,
independently re-verified (confirmed the exact label text, `TIER_LABELS.community`,
`admin-user-access.ts`'s accessSummary, and `AdminToolsPanel.tsx`'s correct sibling label directly
from source) before fixing.
