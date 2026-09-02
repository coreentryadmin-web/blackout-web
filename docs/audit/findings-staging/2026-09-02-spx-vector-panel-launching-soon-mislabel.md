> **kind:** `FINDING`

## SPX Dashboard's embedded Vector panel wrongly claimed the whole product was "launching soon" — FIXED

| | |
|---|---|
| **Severity** | P1 |
| **Surface** | `/dashboard` (SPX Slayer desk) — embedded Vector chart panel fallback |
| **Status** | FIXED |

### Context
Raised alongside a broader P1 about the Vector guide documenting a fully-built feature set
(universe screener, GEX ladder, regime banner, wall-integrity scoring, gamma magnet, confluence
zones, GEX-shift leaders, alerts, session replay) while public marketing copy elsewhere still said
"Soon"/"Rolling out." Investigation confirmed every one of those documented capabilities has a
real, wired production component (`VectorScanner`, `VectorGexLadder`, `VectorRegimeBanner`,
`VectorAlertsBell`/`VectorAlertsPanel`, `VectorReplayControls`, `GexShiftLeadersStrip`,
`vector-flow-confluence.ts`, gamma-magnet wiring in `VectorChart`/`VectorPageShell`, wall-integrity
scoring throughout the play-intel stack) and Vector's own launch gate
(`src/lib/tool-access.ts`'s `TOOLS` entry) is `defaultLaunched: true` — Vector has been globally
live, not a documentation-ahead-of-reality problem. The homepage/marketing "Soon" copy was already
fixed in PRs #3307/#3317/#3320 (this session).

While auditing every remaining "Vector" + "Soon"/"launching" occurrence in the codebase for
residue, found one more, in a different surface than marketing copy: the embedded Vector chart
panel on the SPX Slayer dashboard (`SpxDashboard.tsx`) showed **"Vector chart launching soon"**
whenever `vectorEnabled` was false.

### Root cause
`vectorEnabled` is `canAccessTool("vector")`, which combines the **global launch flag** (always
`true` for Vector) with **per-user tier/tool_access overrides** (`userCanAccessTool` in
`tool-access-server.ts`). Since the global flag can never be the reason this branch renders, the
fallback ONLY ever fires for an SPX-Slayer-only (non-Premium) member whose plan doesn't include
Vector — a plan-entitlement gap, not an incomplete-feature gap. The old copy told a paying member
the wrong thing (the product doesn't exist yet) and gave them no path forward.

### Fix
Changed the fallback to `"Vector isn't on your plan yet"` / `"The embedded SPX Vector chart is a
Premium feature. Vector itself is fully live — upgrade to unlock it here."`, with an `Upgrade to
Premium` button linking `/upgrade` (the same CTA pattern already used elsewhere in this file).

### Test
Extended `src/features/spx/spx-vector-ios-embed.test.ts`: asserts the fallback copy never claims
"launching soon" and does state the plan gate + upgrade CTA. Verified fails pre-fix (git-stash),
passes post-fix. Full suite 11709/11709 green, `tsc --noEmit` clean, Node 20.
