## Admin "Tool launch" grid rendered Vector with no icon — the sigil lookup map was never extended when Vector shipped — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Admin dashboard — `src/components/admin/AdminLaunchStatusPanel.tsx` |
| **Severity** | P4 (admin-only UI, no member/product impact) |
| **Status** | FIXED |

### Root cause

The Operations tab's "Tool launch" grid picks each row's icon via a local
`SIGIL_BY_KEY[tool.key]` lookup, rendering nothing when the key is absent
(`{sigil ? <ProductMark .../> : null}` — a silent blank slot, not a crash or error). The map
only had `spx, flows, heatmap, largo, nighthawk`. Vector shipped with a complete, real sigil
everywhere else in the app — `ToolSigil`/`MarkProduct` (both in `tool-access.ts` and
`ProductMark.tsx`), `MARK_ACCENT`, `MARK_GEOMETRY`, and `DEFAULT_TITLE` all already include
`"vector"` — but this one admin-only lookup map was never extended to match when Vector
launched, so its row in this one panel rendered with no icon. Found by an independent
background sweep of the admin dashboard layer; re-verified directly against `tool-access.ts`,
`ProductMark.tsx`, and `geometry.tsx` before fixing (confirmed Vector's sigil is genuinely
complete everywhere, not itself a stub).

### Evidence

Direct read of `AdminLaunchStatusPanel.tsx:6-12` confirmed the pre-fix map. `grep` across
`tool-access.ts`/`ProductMark.tsx`/`geometry.tsx` confirmed `"vector"` is a real, fully-defined
member of `ToolSigil`, `MarkProduct`, `MARK_ACCENT`, `MARK_GEOMETRY`, and `DEFAULT_TITLE` — the
gap is specific to this one map, not a missing Vector asset.

### Blast radius

One file, one map, one missing key. Meridian is in the same `TOOLS` array and also missing from
this map, but is deliberately NOT fixed here — see the companion write-up
(`2026-10-12-admin-meridian-sigil-identity-gap.md`): unlike Vector, Meridian has no real sigil
anywhere in the system yet, so adding it to this map today would swap a blank icon slot for the
*wrong* icon, not a correct one.

### Fix rationale

Added `vector: "vector"` to `SIGIL_BY_KEY` — a one-line, zero-risk completion since every other
piece of Vector's sigil identity already exists and is correct. Did not touch Meridian's entry
(absent and staying absent until it has a real sigil, per the companion write-up).

### Test

New `src/components/admin/AdminLaunchStatusPanel.test.ts` (1 test), following this repo's
established source-text-assertion convention for "use client" components (no React Testing
Library here) — asserts `SIGIL_BY_KEY` contains every tool key that already has a complete
sigil, including `vector`. Proven RED→GREEN via `git stash` against the pre-fix map — failed on
the missing `vector:` key, passed once restored. `tsc --noEmit` clean.
