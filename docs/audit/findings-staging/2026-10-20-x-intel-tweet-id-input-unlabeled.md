## 2026-10-20 — [FINDING, P3 Accessibility] Admin X-intel "record tweet ID" input relied on placeholder-only labeling — FIXED

> **kind:** FINDING

**Context.** DISCOVERY-lane accessibility sweep, follow-up to the earlier
`ExitIntentCapture.tsx` fix (same session, `#6352`) which found a marketing email input
with no accessible name beyond its placeholder. Dispatched a background sweep agent to look
for other instances of the same defect class across the non-owned-lane surface.

**Root cause.** `src/app/(site)/admin/x-intel/[id]/page.tsx`'s "After Publishing to X" form
renders a plain `<input>` for pasting the published tweet ID with only
`placeholder="Paste the X/Twitter post ID here..."` — no `aria-label`, no `<label>`, no
`aria-labelledby`. The preceding `<h3>Why This Package?</h3>`/`<h3>After Publishing to
X</h3>` headings are not programmatically associated with the input. Screen readers don't
reliably announce placeholder text (and it disappears once the field has a value), so the
input has no accessible name at all for an assistive-technology user.

**Fix.** Added `aria-label="X/Twitter post ID"` to the input, alongside its existing
placeholder (kept for sighted users — same approach as the ExitIntentCapture fix).

**Blast radius.** Single input, single admin-only page — no other consumer of this markup.

**Evidence of fix.** New test
`src/app/(site)/admin/x-intel/[id]/tweet-id-input-label.test.ts` asserts the input's
surrounding source carries `aria-label="X/Twitter post ID"`. RED→GREEN proven via
`git stash` on just `page.tsx`: fails on the pre-fix source (`not ok 1`), passes once the
fix is restored. `tsc --noEmit` clean.

**What was deliberately left unchanged.** Two other instances of the same defect class
found by the same sweep (`ThermalSavedDesksMenu.tsx`'s save-desk-name input,
`UserManagement.tsx`'s ~10 unassociated-label inputs/selects across two modals) are each
being fixed in their own separate branch/PR per the one-issue-per-PR policy.
