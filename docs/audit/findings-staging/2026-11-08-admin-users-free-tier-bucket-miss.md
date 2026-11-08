> **kind:** FINDING

# Admin directory's Free filter/stat tile dropped rows whose `tier` column isn't the literal string `"free"` — including any row with `tier: null`

| | |
|---|---|
| **Area** | Admin user directory — `src/lib/admin-users.ts` (`buildAdminUserFilterSql`, `computeAdminUserListStats`) |
| **Severity** | P2 — same class as the two prior sibling fixes in this file (#7551 premium `pro`/`elite` alias, #7520 community alias): a dashboard row's own badge disagrees with the filter/stat tile for it, so an admin undercounts (or can't find) real Free-access members |
| **Status** | FIXED |

## Root cause

`src/lib/admin-users.ts` has three stat buckets (premium / community / free) plus matching SQL
filter clauses, all meant to agree with `classifyAdminUserAccess`'s own badge for a row —
`AdminUserStatsRow.tier` is typed `string | null`, and `classifyAdminUserAccess` normalizes
`tier` through `parseTier` (`lib/tiers.ts`), which maps **any** value it doesn't recognize
(`null`, an empty string, a stale value from before a write path started normalizing) to
`"free"`. The premium bucket was already fixed (round 394) to compare against the *normalized*
value (`parseTier(row.tier) === "premium"`) specifically so a legacy `tier = 'pro'`/`'elite'` row
still counts as Premium. The community bucket was already fixed to recognize `tier = 'community'`
directly, not just `membership_kind`. The **free** bucket was never given the same treatment —
it still compared the raw literal:

```ts
// computeAdminUserListStats, pre-fix
if (row.tier === "free" && !["community", "premium"].includes(row.membership_kind ?? "free")) {
  free++;
}
```

and the matching SQL clauses (`buildAdminUserFilterSql`, `access === "free"` and `tier ===
"free"`) likewise used a bare `tier = 'free'` comparison. In SQL, `NULL = 'free'` is `NULL`
(falsy), so a row whose `tier` column is actually `NULL` — a real, typed-for case per
`AdminUserStatsRow` — matches neither the free filter nor the free stat bucket, while its own
unfiltered-list badge (`classifyAdminUserAccess({ tier: null, ... })`) reads `"free"` with
`deskAccess: false`. The row is not miscounted into another bucket — it counts toward `total` and
toward *nothing else*, silently vanishing from every stat tile.

## Evidence (RED → GREEN)

Reproduced live against the actual exported functions before changing anything:

```
node --import tsx check-admin-free-bug.mjs
stats: {"total":1,"premium":0,"admins":0,"community":0,"free":0}
access=free SQL: WHERE tier = 'free' AND COALESCE(membership_kind, 'free') NOT IN ('community', 'premium') AND COALESCE(role, '') <> 'admin'
badge for tier=null: {"accessLabel":"free","deskAccess":false,"accessSummary":"Free signup — marketing site + /upgrade only"}
```

`total: 1` with every bucket at `0`, against a row `classifyAdminUserAccess` badges `"free"`.

Added three regression tests to `src/lib/admin-users.test.ts`:
- `computeAdminUserListStats counts a null-tier row as Free, matching classifyAdminUserAccess/parseTier (not silently dropped from every bucket)`
- `computeAdminUserListStats: a null-tier row with membership_kind='community' still counts as Community, not Free` (guards against the fix over-widening the free bucket)
- `buildAdminUserFilterSql free clauses match a NULL tier column too (COALESCE, not a raw literal comparison)`

```
git stash   (pre-fix source, new tests applied)
npx tsx --experimental-test-module-mocks --test src/lib/admin-users.test.ts
# pass 17 / fail 3  — the 3 new/updated assertions above fail exactly as expected

git stash pop   (post-fix)
npx tsx --experimental-test-module-mocks --test src/lib/admin-users.test.ts
# pass 20 / fail 0
```

Also ran `npx tsc --noEmit` (clean) and confirmed the two pre-existing tests that asserted the
old literal-`tier = 'free'` SQL shape (`buildAdminUserFilterSql maps tier and role filters`) were
updated to the new shape rather than left to silently pass on stale text.

## Blast radius

Only `buildAdminUserFilterSql`'s `free` branches (both `access === "free"` and `tier === "free"`)
and `computeAdminUserListStats`'s free-bucket condition. No other call site references the SQL
text directly (`grep` for `buildAdminUserFilterSql`/`computeAdminUserListStats` repo-wide turns up
only `admin-users.ts` itself and its test file; the one real caller,
`src/app/api/admin/users/route.ts`, consumes the returned `{ids, total}`/`AdminUserListStats`
shapes, both unchanged). The premium and community branches/buckets are untouched.

## Fix rationale

For the stats function, reuse the `normalizedTier` (`parseTier(row.tier)`) already computed for
the premium check, and the same dual-signal community check already used for the community
bucket, as the complete partition: a non-admin row is Premium (`normalizedTier === "premium"`),
else Community (the existing dual-signal check), else Free — the same three-way exhaustive split
`classifyAdminUserAccess` performs. This is simpler than adding a fourth ad-hoc literal
comparison, and by construction can't double-count or miss a row, since it's derived from the
same `normalizedTier`/`isCommunity` values the other two buckets already trust.

For the SQL, `COALESCE(tier, 'free') NOT IN ('premium', 'pro', 'elite', 'community')` is the direct
SQL translation of "`parseTier` would not call this premium or community" — i.e. everything else,
matching the JS-side partition exactly. Left unchanged: the `access === "free"` branch's existing
`COALESCE(role, '') <> 'admin'` exclusion and its absence from the plain `tier === "free"` branch
(a pre-existing, deliberate asymmetry between the "access" bucket filter and the plain "tier"
dropdown filter — not something this fix's scope touches), and the `membership_kind`-based
exclusion clause on both branches.
