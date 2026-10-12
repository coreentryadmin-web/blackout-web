## Correction + expanded blast radius: Meridian's icon gap already has a minimal existing workaround — and the real live-user-facing instance is the iOS tab bar, not the dormant admin lock-screen — OPEN (still a decision, not a drive-by fix)

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | `src/lib/ios-tool-routes.ts`, `src/components/Nav.tsx`, `src/components/DeskSidebar.tsx`, `src/components/learn/*`, `src/lib/tool-access.ts` |
| **Severity** | P3 |
| **Status** | OPEN |

### What this corrects

The prior entry in this file (`2026-10-12-admin-meridian-sigil-identity-gap.md`, folded into
`FINDINGS.md`) said fixing Meridian's icon gap "requires creating a genuinely new Meridian
sigil... original design/content work" and implied nothing existed for it yet. That's not
quite right, caught by following up on the same investigation rather than treating the
already-folded entry as closed: a repo-wide `grep -rn "meridian-mark"` found a **minimal,
already-deliberate, already-tested workaround** — a plain `✦` glyph in a `.meridian-mark` span,
used consistently across **6 real call sites**: `Nav.tsx:82`, `DeskSidebar.tsx:43`,
`LearnSidebar.tsx:68`, `LearnHub.tsx:86`, `LearnSectionBlocks.tsx:233,302` — with its own
dedicated regression test, `src/components/learn/learn-meridian-mark.test.ts`, whose own doc
comment states Meridian "can't use the shared animated-SVG sigil system the other six products
use" and that this `✦` glyph is "already used consistently in the real app['s nav/sidebar]."

So the correct framing isn't "nothing exists, design work is needed" — it's "a real, tested,
if minimal pattern already exists and three other call sites (the ones the prior entry found)
just don't use it, defaulting to Largo's icon instead." Checked and confirmed: `.meridian-mark`
has **no dedicated CSS rule anywhere** (`grep` across every `.css` file found none) — it's pure
inline Tailwind sizing with no accent color, so it is a real stopgap, not a full sigil matching
the other six products' animated SVG + accent-color treatment. Both things are true at once:
real existing pattern, genuinely minimal.

### Expanded blast radius — a third, more severe instance found

`src/lib/ios-tool-routes.ts:103-110` has the **same stub bug** the prior entry found in
`tool-access.ts`, but worse — it stubs BOTH the icon AND the accent color to Largo's values:

```ts
{
  href: "/meridian",
  label: "Meridian",
  short: "Meridian",
  mark: "largo",          // <- wrong icon, same bug class
  accent: "#22d3ee",      // <- literally MARK_ACCENT.largo's cyan, not a Meridian-specific color
  tagline: "Catalyst structure desk",
  code: "MRD",
},
```

This is the **highest-severity instance of the three found so far**: unlike `tool-access.ts`'s
stub (which only renders via `ComingSoon.tsx`, gated to `defaultLaunched: false` tools — and
Meridian's own `TOOLS` entry has `defaultLaunched: true`, so that lock-screen path is currently
**dormant/unreachable in production**, not live), this file drives the **iOS app's tab bar** —
a real, live, currently-rendering surface. Every iOS user sees Largo's icon and Largo's accent
color on their Meridian tab today, not a missing icon (the admin panel's lower-severity failure
mode) and not a design gap (there IS a color to use correctly, it's just the wrong one).

### Recommended fix (still not implemented — still a decision, narrower now)

The decision is now much smaller than "design a new sigil": either (a) extend the existing
`.meridian-mark` ✦ pattern to `ios-tool-routes.ts` (requires `IosToolMeta.mark` to accept
something other than a bare `MarkProduct`, since the current type can't express "render a
unicode glyph instead of a ProductMark" — a real type change, not just a data edit) and to
`tool-access.ts`'s dormant `ComingSoon.tsx` path for consistency, or (b) finally design a real
Meridian `MARK_GEOMETRY`/`MARK_ACCENT` entry so every one of these 9 call sites (6 using the
glyph workaround + 3 using the wrong-icon stub) converges on one real sigil instead of two
different stopgaps. Both are legitimate; which one is worth the effort is a product/design
call, not something to pick unilaterally from an audit pass — left here for the owning lane or
operator, same as the entry this corrects.

### Verification

Independently confirmed via direct `grep`/`Read` before writing this up: all 6 `.meridian-mark`
call sites exist as described; the dedicated test file and its doc comment exist verbatim as
quoted; `.meridian-mark` has no CSS rule; `ios-tool-routes.ts:106-107`'s stub values match
`MARK_ACCENT.largo` (`"#22d3ee"`) exactly; `ComingSoon.tsx` is genuinely the only consumer of
`tool-access.ts`'s `product` field and is genuinely gated to locked (`defaultLaunched: false`)
tools only, confirming that path's current dormancy for a `defaultLaunched: true` product like
Meridian. No code changed by this entry — correction + evidence only.
