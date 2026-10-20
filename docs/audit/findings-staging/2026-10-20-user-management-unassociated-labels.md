## 2026-10-20 — [FINDING, P3 Accessibility] Admin UserManagement modals had ~10 visible labels never associated with their inputs/selects — FIXED

> **kind:** FINDING

**Context.** Same DISCOVERY-lane accessibility sweep batch as `#6370`/`#6371`
(placeholder-only inputs). A background sweep agent also found this related — but
distinct — defect class in `src/components/admin/UserManagement.tsx`: here a visible
`<label>` element exists for every field, but it's a plain sibling of its control with no
`htmlFor`/`id` link, so a screen reader still gets no accessible name on focus despite the
label text being right there visually.

**Root cause.** `EditUserModal` (First name, Last name, Tier, Role) and `CreateUserModal`
(Email, Phone, First name, Last name, Tier, Role) each render the pattern:
```tsx
<div>
  <label className="admin-filter-label block mb-1">Tier</label>
  <select className="admin-filter-select w-full" value={tier} onChange={...}>...</select>
</div>
```
with no `htmlFor` on the label and no matching `id` on the control. Additionally,
`EditUserModal`'s read-only "one-time sign-in link" input had no `<label>` element at all —
only a preceding `<p>` — and no `aria-label`/`aria-labelledby`.

**Fix.** Added a unique `id` to each control (`edit-user-*` / `create-user-*` prefixes to
keep the two modals' ids distinct) and `htmlFor` on its corresponding `<label>`; added
`aria-label="One-time sign-in link"` to the read-only sign-in-link input, which has no
dedicated label element to attach to.

**Blast radius.** Two modal components (`EditUserModal`, `CreateUserModal`), both
admin-only, both in the same file — no other consumer renders this markup.

**Evidence of fix.** Extended the existing `src/components/admin/UserManagement.test.ts`
(which already had a `componentBody()` source-inspection helper for this file) with 3 new
tests covering all 10 field/label pairs plus the sign-in-link input. RED→GREEN proven via
`git stash` on just `UserManagement.tsx`: the 3 new tests fail on the pre-fix source
(3 pass / 3 fail), all 6 pass once the fix is restored. `tsc --noEmit` clean.

**What was deliberately left unchanged.** The other two instances of the placeholder-only
labeling defect class found by the same sweep (`x-intel/[id]/page.tsx`'s tweet-ID input,
`ThermalSavedDesksMenu.tsx`'s save-desk-name input) are each fixed in their own separate
PR (`#6370`, `#6371`) per the one-issue-per-PR policy — this finding covers only the
unassociated-label pattern specific to `UserManagement.tsx`.
