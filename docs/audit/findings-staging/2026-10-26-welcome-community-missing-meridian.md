## welcomeCommunityEmail's Premium-upsell paragraph omitted Meridian from the six engines a community (SPX Slayer) member would gain by upgrading

> **kind:** `FINDING`

`welcomeCommunityEmail()` (`src/lib/email/templates/welcome-community.ts`), sent the moment a
member subscribes to SPX Slayer for the first time, closes with an upsell paragraph naming the
other products waiting behind a Premium upgrade: *"Down the road, if you ever want the wider
desk — Thermal, HELIX, Night Hawk, Largo AI, Vector — Premium's there."* That list names only five
of the six other live products — Meridian (the catalyst/earnings desk, shipped 2026-10-11, commit
`5103e7f8d`) was missing.

**Same bug class already fixed in three sibling templates** —
`welcome-premium-downgrade-product-count.test.ts` (welcome-premium.ts / downgrade.ts) and
`scheduled-cancel-engine-list.test.ts` (scheduled-cancel.ts) all caught and fixed the identical
"hardcoded engine list drifted behind the real 7-product lineup" defect. `welcome-community.ts`
was the one sibling template with this exact hardcoded-list shape that none of those prior passes
had re-checked.

**Blast radius:** every brand-new SPX-Slayer-only (community tier) member reads this as their
first introduction to what Premium actually contains. Undercounting the upsell by one full
product (Meridian — a materially differentiated catalyst/earnings desk, not a minor feature)
understates the value of upgrading and is a direct, if small, revenue-adjacent correctness bug —
the exact concern `welcome-premium-downgrade-product-count.test.ts`'s own comment already names
for this bug class.

**Fix:** added `, Meridian` to the hardcoded list in the Day-4-style upsell paragraph. No other
copy needed to change — the surrounding sentence ("the wider desk ... Premium's there") already
reads correctly with six names instead of five.

**Evidence (RED → GREEN):** new test `welcomeCommunityEmail: Premium upsell paragraph names all
six other live products, including Meridian` in
`src/lib/email/templates/welcome-community-engine-list.test.ts`. Pre-fix: fails asserting on
`Meridian` (confirmed via `git stash` on the fix commit, full failure output captured). Post-fix:
passes. Ran all 15 tests across `src/lib/email/templates/*.test.ts` — all green, including the
three sibling engine-list/product-count regression tests, confirming no cross-template drift was
introduced. `tsc --noEmit` and `eslint` clean on both touched files.

| **Status** | FIXED (PR #TBD) |
