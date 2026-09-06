## 2026-09-06 — [FINDING, shared UI, P3] `DeskSidebar` and `Nav` hand-duplicated the same 7-desk nav list — a false "reuses" comment plus a real drift landmine — FIXED

> **kind:** `FINDING`

### Symptom

Found during a DISCOVERY-lane sweep of shared, non-desk-specific UI components for the
population/cohort-mismatch bug class — this time the "two near-duplicate implementations that
drift apart" shape appeared as **two separately hand-maintained copies of the same nav list**,
with a comment that claimed a stronger guarantee than the code actually provided.

### Root cause

`src/components/DeskSidebar.tsx` (the desktop icon rail) and `src/components/Nav.tsx` (the main
nav's Features menu/mega-menu) each defined their own array of the 7 desk entries
(href/label/accent, plus `sub`/`adminOnly` in Nav's richer version). `DeskSidebar.tsx`'s top-of-file
comment claimed:

> "Reuses Nav's FEATURE_LINKS accent/href/label data so the two navs can never drift into listing
> different systems."

But 12 lines below, the array's own comment told the truth:

> "Kept in sync with Nav.tsx's FEATURE_LINKS by hand (same 7 systems) — importing from Nav.tsx
> directly would pull in its full client-side auth/mobile-menu state tree into this much smaller
> component for no benefit."

The code did the second thing (hand-copy), not the first (import/reuse) — the file-level comment
was simply false about its own implementation. The two arrays happened to still agree (verified by
diffing them entry-by-entry) — not a live bug yet — but nothing enforced that agreement: the next
desk added, renamed, or reordered in one file and not the other would silently show a different
product list in the sidebar vs. the nav dropdown, with no compiler or test catching it.

### Fix

Extracted the canonical 7-entry list into a new, dependency-free `src/lib/desk-nav-links.ts`
(`DESK_NAV_LINKS`, carrying the full `href`/`label`/`sub`/`accent`/`adminOnly?` shape Nav needs).
`Nav.tsx` now imports it directly as `FEATURE_LINKS` (identical shape, no behavior change).
`DeskSidebar.tsx` imports the same `DESK_NAV_LINKS` and maps each entry down to the
`{href, label, accent}` fields it actually renders — preserving the original design constraint
(the rail must not pull in Nav's heavy auth/mobile-menu client state tree) while eliminating the
drift risk entirely: there is now exactly one array to edit, not two to keep in sync by hand.

### Evidence

- RED→GREEN: `git stash push` both component edits (keeping the new test + new module) → test
  fails (`Nav.tsx`/`DeskSidebar.tsx` still define their own array literals, no import) →
  `git stash pop` → test passes.
- New test file `desk-nav-links.test.ts`: asserts the 7-entry shape, plus a **source-scan drift
  guard** that fails loudly if either `Nav.tsx` or `DeskSidebar.tsx` ever reintroduces a local
  array literal instead of importing `DESK_NAV_LINKS` — the same class of guard used earlier this
  session for the analogous `spx-desk-levels.ts` (King node) and `meridian-thermal-scope.ts` fixes.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20): see PR for final count.

### Blast radius

New `src/lib/desk-nav-links.ts` + test. `Nav.tsx` (removed 15-line local array + type aliases,
added 1 import) and `DeskSidebar.tsx` (removed 10-line local array, added 1 import + a 3-field
map) — both files' rendered output and admin-filter behavior are unchanged (verified: no current
entry sets `adminOnly: true`, so `DeskSidebar`'s lack of admin-filtering is unaffected by this
change).

| **Status** | FIXED — PR opened, merge pending CI/peer-review per standing policy |
