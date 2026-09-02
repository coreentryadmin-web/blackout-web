> **kind:** FINDING

## Sign-up/sign-in value-prop panel omitted Thermal, Vector and Meridian — FIXED

| **Status** | Fixed in this PR |

**Root cause:** `AuthProofRail.tsx` (rendered by both `/sign-up` and `/sign-in` via `AuthShell`)
rendered `FEATURE_MATRIX.slice(0, 4)` — only the first four rows of the shared feature matrix
(HELIX, SPX Slayer, Largo, Night Hawk). `upsell-features.ts`'s `FEATURE_MATRIX` array never had
dedicated rows for Thermal, Vector, or Meridian at all; the closest thing was a generic
"Strike-level heatmaps" row with no product framing. So the page closest to conversion — account
creation — advertised 4 of the platform's 7 desk products and described Night Hawk only as an
"overnight scanner," omitting its intraday 0DTE role entirely.

**Evidence:** Read `FEATURE_MATRIX` pre-fix: 11 rows total, first 4 were
`HELIX live flow feed / SPX Slayer desk / Largo AI desk analyst / Night Hawk overnight scanner`;
`AuthProofRail.tsx:32` sliced `(0, 4)`. The About page (`src/app/(marketing)/about/page.tsx`)
independently confirmed only "Six modules" were being marketed platform-wide, matching the same
omission pattern, and the FAQ (`src/lib/faq/content.ts:139`) already correctly lists Meridian —
so the drift was isolated to the auth/about surfaces, not systemic.

**Blast radius:** Same root cause (a hardcoded feature/module list independently duplicated per
surface, with no canonical product registry) hit three files:
- `src/lib/upsell-features.ts` — `FEATURE_MATRIX` missing Thermal/Vector/Meridian rows.
- `src/components/auth/AuthProofRail.tsx` — hardcoded `.slice(0, 4)` cap.
- `src/app/(marketing)/about/page.tsx` — "Six modules" copy, no Meridian bullet.

Also flagged (not fixed here, separate concern): `src/components/auth/AuthShell.tsx` claimed
"End-to-end encrypted" next to the proof rail — no E2EE implementation exists anywhere in the
codebase (only standard TLS + server-rendered Clerk auth), so the claim was corrected to
"Encrypted in transit" in the same PR since it sits on the same panel.

**Fix:** Added Thermal (`Thermal dealer-gamma heatmaps`, mark `heatmap`), Vector (`Vector
cross-ticker scanner`, mark `vector`) and Meridian (`Meridian earnings intelligence`, no mark —
`MarkProduct` has no meridian entry, falls back to the generic checkmark honestly rather than
inventing one) rows to `FEATURE_MATRIX`, removed the now-redundant generic "Strike-level
heatmaps" row, renamed the Night Hawk row to include "+ 0DTE scanner", widened
`AuthProofRail`'s slice to `(0, 7)` so all 7 desk products render, and updated the About page
copy from "Six modules"/"All six ship" to "Seven modules"/"All seven ship" with a new Meridian
bullet.

**Fix rationale:** Kept the fix additive/surgical — no new abstraction, no canonical product
registry (a larger refactor flagged separately, not attempted here to keep this PR single-issue).
Did not touch `whop-checkout.ts`'s or `upsell-features.ts`'s hardcoded pricing strings
(`PLAN_VALUE_PROPS`) — that's a separate pricing-consistency finding, out of scope for this
copy-staleness fix.

**Test:** `src/lib/upsell-features.test.ts` rewritten — asserts all 6 marked product rows carry a
valid `MarkProduct`, every mark on the matrix is valid, the `AuthProofRail` slice(0,7) covers all
7 desk product labels, and Meridian's row intentionally has no mark. `node --import tsx --test
src/lib/upsell-features.test.ts`: 4/4 pass. `npx tsc --noEmit`: clean.
