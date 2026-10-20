## 2026-10-20 — [FINDING, P3 Accessibility] Thermal saved-desk-name input relied on a dynamic placeholder for its accessible name — FIXED

> **kind:** FINDING

**Context.** DISCOVERY-lane accessibility sweep, same batch as the X-intel tweet-ID input
fix (`#6370`) — a background sweep agent looked for other instances of the "placeholder-only
labeling" defect class first found in `ExitIntentCapture.tsx` (`#6352`).

**Root cause.** `src/features/thermal/components/ThermalSavedDesksMenu.tsx`'s "save current
view" menu renders an `<input>` for the saved-desk name with
`placeholder={defaultSavedDeskName(snapshot.ticker, snapshot.lens)}` and no `aria-label`, no
`<label>`, no `aria-labelledby`. This is worse than a static placeholder: the placeholder
text itself is dynamic (changes per ticker/lens), so there is no stable accessible name at
all, and the preceding `<p>Save current view</p>` is plain text, not a `<label>` — not
programmatically associated with the input either way.

**Fix.** Added `aria-label="Saved desk name"` to the input, keeping the dynamic placeholder
as a sighted-user hint.

**Blast radius.** Single input, one dropdown menu component (`ThermalSavedDesksMenu`), one
consumer surface (the Thermal desk).

**Evidence of fix.** New test `src/features/thermal/components/ThermalSavedDesksMenu.test.ts`
asserts the input's surrounding source carries `aria-label="Saved desk name"`. RED→GREEN
proven via `git stash` on just the component file: fails on the pre-fix source (`not ok 1`),
passes once the fix is restored. `tsc --noEmit` clean.

**What was deliberately left unchanged.** Two other instances of the same defect class found
by the same sweep (`x-intel/[id]/page.tsx`'s tweet-ID input — fixed separately in `#6370` —
and `UserManagement.tsx`'s ~10 unassociated-label inputs/selects) are each handled in their
own branch/PR per the one-issue-per-PR policy.
