## Meridian has no real product sigil anywhere in the system — stubbed as "largo" to satisfy the type checker — OPEN (design decision needed, not fixed here)

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | `src/lib/tool-access.ts`, `src/components/marks/ProductMark.tsx`, `src/components/marks/geometry.tsx` |
| **Severity** | P3 (wrong icon shown for a live product, no functional impact) |
| **Status** | OPEN |

### What's wrong

`src/lib/tool-access.ts:37-43`'s `TOOLS` entry for Meridian sets `product: "largo"` instead of a
Meridian-specific sigil:

```ts
{ key: "meridian", label: "Meridian", href: "/meridian", product: "largo", defaultLaunched: true }
```

This means Meridian's lock-screen/`ProductMark` renders the **Largo** icon — a live product
rendering a different product's visual identity. It cannot be fixed in place today:
`ToolSigil` (`tool-access.ts:16`) and `MarkProduct` (`ProductMark.tsx:9`, plus `MARK_ACCENT` and
`DEFAULT_TITLE`, both in the same file) have **no `"meridian"` member at all** — the type was
never extended when Meridian shipped, and `MARK_GEOMETRY` (`geometry.tsx:15`) has no Meridian
SVG geometry either. Whoever wired Meridian's launch gate stubbed `product: "largo"` to satisfy
the type checker rather than adding a real case.

Found by an independent background sweep of the admin dashboard layer (which surfaced it via
the admin "Tool launch" grid rendering no icon for Meridian at all, tracked separately as
`2026-10-12-admin-launch-status-vector-missing-icon.md` — Vector's half of that bug was a
simple missing-lookup-entry fix; Meridian's is this deeper one). Independently re-verified
directly against `tool-access.ts`, `ProductMark.tsx`, and `geometry.tsx` before writing this up.

### Why this is NOT fixed in this entry

Fixing it properly requires creating a genuinely new Meridian sigil: new SVG geometry (matching
the existing hand-drawn style of the other 6 sigils in `geometry.tsx`), a new accent color (not
colliding with the 6 existing `MARK_ACCENT` values), and a default title. That is original
design/content work, not a mechanical type extension — the kind of decision CLAUDE.md's
standing brief says to write up rather than unilaterally build. Every other 7-product launch
this session (Vector/Meridian additions to `product-manifest.ts`, `desk-nav-links.ts`, etc.) had
an existing design (icon, accent, copy) to extend into; this one does not — Meridian apparently
launched without a sigil ever being drawn for it.

### Consumers affected

- Lock screen / launch-gate UI wherever `<ProductMark product={toolMeta("meridian").product}>`
  renders (via `tool-access.ts`'s `TOOLS` → currently shows Largo's cyan icon for Meridian).
- The admin "Tool launch" grid (`AdminLaunchStatusPanel.tsx`) — currently renders no icon at all
  for Meridian (the separate, already-fixed half of this bug), and would render the *wrong*
  Largo icon if `meridian: "largo"` were naively added to `SIGIL_BY_KEY` to "fix" the blank slot
  — which is exactly why that map deliberately still omits Meridian.

### Recommended fix (not implemented — for the owning lane or operator)

1. Design a Meridian sigil: new SVG geometry in `geometry.tsx` (matching the existing
   hand-drawn style), a new accent color in `MARK_ACCENT` (distinct from the 6 existing values),
   and a `DEFAULT_TITLE` entry.
2. Add `"meridian"` to `ToolSigil` (`tool-access.ts:16`) and `MarkProduct` (`ProductMark.tsx:9`).
3. Fix `tool-access.ts:41`'s `product: "largo"` → `product: "meridian"`.
4. Add `meridian: "meridian"` to `AdminLaunchStatusPanel.tsx`'s `SIGIL_BY_KEY`.

### Related, lower-priority observation (same sweep, not a bug)

`AdminBieDashboard.tsx` has dedicated read-only health panels for SPX, Thermal/GEX, 0DTE
Command, and HELIX, but no equivalent panel for Vector or Meridian. Their cron jobs are still
correctly tracked generically (`admin-cron-health.ts`/`AdminCronDashboard.tsx` render whatever
`CRON_JOBS` contains dynamically — not stale), and Vector's wall-write observability is folded
into the generic `admin-health.ts` snapshot. This is a coverage gap/enhancement opportunity, not
a correctness bug — flagged for the owning lane's judgment, not actioned here.
