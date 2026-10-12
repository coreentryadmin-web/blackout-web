## 2026-10-12 — [Learn] Vector/Meridian guide pages showed two different chapter numbers for themselves — FIXED
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Learn/Academy | P2 — live, user-visible self-contradiction on two pages | FIXED |

**What's wrong.** Every Learn guide declares its own `chapter` field, and `curriculum.ts`
independently computes each guide's chapter from its position in `LEARN_NAV`
(`CURRICULUM = LEARN_NAV.map((item, i) => ({ ..., chapter: i + 1 }))`). These two numbers are
supposed to agree — and did, for 7 of 9 guides — but:
- `src/lib/learn/guides/instruments/vector.ts:5` declared `chapter: 8`; computed position is **7**.
- `src/lib/learn/guides/instruments/meridian.ts:5` declared `chapter: 9`; computed position is
  **8** — colliding with `glossary.ts`'s own (correct) `chapter: 9`.
- No guide anywhere declared `7`.

**Why this is user-visible, not just an internal inconsistency.** `LearnGuideView.tsx:27` renders
the page's own header badge as `guide.kicker ?? \`Chapter ${guide.chapter}\`` — the
self-declared field — while `LearnSidebar.tsx` (`CURRICULUM.find(...).chapter`) and the
prev/next chapter nav on the same page render the computed, authoritative position. Result:
visiting `/learn/vector` showed **"Chapter 8"** in its own page header while the sidebar
simultaneously showed it as **"Chapter 7 of 9"** — a direct on-page contradiction. `/learn/meridian`
showed **"Chapter 9"** in its header, identical to Glossary's "Chapter 9 · Reference" header, while
its own sidebar entry read "8".

**Root cause.** Left over from when Meridian was inserted into `LEARN_NAV` as the curriculum's
8th entry — `vector.ts`'s and `meridian.ts`'s own hardcoded `chapter` numbers were never
reconciled to the shift (they still reflect what looks like a later intended position, or a
simple off-by-one, rather than the actual insertion point).

**Fix.** `vector.ts` chapter `8 → 7`; `meridian.ts` chapter `9 → 8`.

**Regression guard added.** New `src/lib/learn/curriculum.test.ts` (none existed for this file):
asserts every guide's self-declared `chapter` matches its `CURRICULUM`-computed position, and
that no two guides declare the same number. Verified RED→GREEN: reverting just the two chapter
fields fails both new assertions; restoring them passes (2/2).

**Verification.** Full Learn test suite (`src/lib/learn/*.test.ts src/components/learn/*.test.ts`)
→ 48/48 pass. `tsc --noEmit` clean.

**Blast radius.** `vector.ts`/`meridian.ts` chapter fields only. No other guide's declared
chapter needed correction (getting-started=1, spx-slayer=2, helix-flows=3, largo-ai=4,
night-hawk=5, heat-maps=6 all already matched their computed positions).

Found via a background Explore-agent sweep of email templates and Learn content, independently
re-verified (every guide's declared vs. computed chapter number, both render sites in
`LearnGuideView.tsx`/`LearnSidebar.tsx`, and that no other guide needed correction) before
fixing.
