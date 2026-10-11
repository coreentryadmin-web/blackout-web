## Getting Started guide's nav/pipeline lists were 2 products behind the live site nav, plus a dead export removed — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Academy/Learn — `src/lib/learn/site-map.ts`, `src/lib/learn/guides/getting-started.ts` |
| **Severity** | P3 (member-visible stale content, no functional impact) |
| **Status** | FIXED |

### Root cause

`PRIMARY_NAV` (`site-map.ts`) is rendered verbatim into the Getting Started guide's "Navigate
the website" section (`getting-started.ts:39`) — the first content a new member reads. It is a
hand-maintained THIRD copy of the desk nav, independent of `DESK_NAV_LINKS`
(`src/lib/desk-nav-links.ts`), the canonical source `Nav.tsx`/`DeskSidebar.tsx` both read from
specifically to stop this exact class of drift (per that file's own doc comment — it replaced
two previously-hand-duplicated arrays for the same reason). When Vector and Meridian shipped,
`DESK_NAV_LINKS` was updated but `PRIMARY_NAV` was not, so the guide's nav list was missing
both — 7 of 9 live app routes, 2 behind. A second, separate hand-written list in the same
guide — the pipeline section's "Surfaces" layer (`getting-started.ts:60`) — had the identical
gap for the identical reason. Found by an independent background sweep of the Academy/Learn
content layer; re-verified directly against `desk-nav-links.ts` and both files before fixing.

### Evidence

Direct read of `site-map.ts` confirmed `PRIMARY_NAV` listed only SPX Slayer/HELIX/Thermal/
Largo/Night Hawk/Learn/Account/Upgrade — no Vector, no Meridian — while `TOOL_ROUTES` in the
same file already correctly includes both (`site-map.ts:14-15`), showing the gap is specific to
the hand-written `PRIMARY_NAV` array, not a missing route. `desk-nav-links.ts`'s `DESK_NAV_LINKS`
(7 entries) confirmed as the real, live, canonical nav — it already lists both. The pipeline
Surfaces list at `getting-started.ts:60` was independently confirmed to have the same 2-item gap.

### Blast radius

Two lists, one file each, both in the same guide (`getting-started.ts` consumes `PRIMARY_NAV`
from `site-map.ts`, plus its own separate pipeline list). The background sweep also checked
Learn routing/slugs/FAQ coverage (all clean, well-tested, zero broken links across ~55 markdown
link targets) and flagged one dead export (`SITE_ROUTES`, zero callers anywhere, no retention
comment) and one stale doc comment (`guide-faqs.test.ts:8` said "6 of the 7 guides," LEARN_NAV
has grown to 9 entries/8 non-glossary since) — both folded into this same fix since they're
small, safe, and in the same files already being touched.

### Fix rationale

Added Vector and Meridian to `PRIMARY_NAV` (matching the existing hand-written prose style of
the sibling entries, in the same order `DESK_NAV_LINKS` uses) and to the pipeline Surfaces list.
Deliberately did **not** refactor `PRIMARY_NAV` to fully derive from `DESK_NAV_LINKS` —
`PRIMARY_NAV` carries richer per-entry prose (`description`) than `DESK_NAV_LINKS`'s `sub` field
and also includes three non-desk utility entries (Learn/Account/Upgrade) with no equivalent in
the canonical list, so a full derivation would be a bigger, riskier rewrite than this bug
warrants and would risk subtly changing the five already-correct entries' text. Instead added a
regression test that checks `PRIMARY_NAV` against `DESK_NAV_LINKS`'s own labels (not a hardcoded
count), so this specific drift can't recur silently at the next product launch — it will fail
loudly instead. Removed `SITE_ROUTES` outright (no reuse site exists). Fixed the stale "6 of 7"
comment to "8 of 9," matching the real current `LEARN_NAV` count.

### Test

New `src/lib/learn/site-map.test.ts` (2 tests): `PRIMARY_NAV` covers every `DESK_NAV_LINKS`
label (the canonical oracle, not a hardcoded list — self-updates when a future product ships),
and the Surfaces pipeline layer names every live desk. Proven RED→GREEN by temporarily
reverting both fixed lists to their pre-fix content — both tests failed ("missing Vector") —
then restored. Full `src/lib/learn/*.test.ts` suite (40/40) and `tsc --noEmit` (clean,
confirming the `SITE_ROUTES` removal broke nothing) re-run after restoring the fix.
