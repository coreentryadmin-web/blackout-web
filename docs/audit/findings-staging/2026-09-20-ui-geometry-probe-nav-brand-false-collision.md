> **kind:** FINDING

# Live-UI audit tooling: `ui-geometry-probe.mjs` reported a false "text over control" collision on every `nav-brand-ios-compact` desk page (Thermal/`/heatmap` confirmed live; same shared component also serves Vector/Night Hawk)

| | |
|---|---|
| **Status** | FIXED — PR opened same session, verified RED→GREEN locally and against live prod. |
| **Surface** | `scripts/audit/lib/ui-geometry-probe.mjs` (`probeGeometry`'s `vis()` and `visibleFraction()`), shared by `live-ui-interaction-audit.mjs` and `live-ui-deep-audit.mjs`. Tooling only — no application code, no runtime behavior change to the product. |
| **Severity** | P3 (tooling correctness) — no member-facing defect; the risk is a false FAIL training a reader to distrust or skip real findings from this harness. |

## What was found

This cycle's live-UI/interaction pass on `/heatmap` (Ask Largo × Night Hawk standing mandate's
required live-UI check, run via `scripts/audit/live-ui-interaction-audit.mjs` per
`docs/audit/LIVE-UI-CONNECTION.md`) reproducibly reported:

```
FAIL /heatmap [phone]: 1 COLLISION(s) on load — "BLACKOUT" over control "☰"
```

Reproduced 2/2 runs against live production at 430×932 under the harness's iOS-app UA
(`BlackOutiOSApp/1.0`, the shared tunnel context's default mobile UA). Direct DOM inspection
(same tunnel, same auth) showed this is a **false positive**, not a real layout defect:

```
span.nav-wordmark ("BLACKOUT")   rect x 233.2..305.4   own computed opacity: 1
button.nav-sheet-toggle ("☰")    rect x 225.2..269.2
a.nav-brand (the wordmark's real ancestor, class nav-brand-ios-compact)
                                  computed width: 0px, opacity: 0   ← the collapse the CSS rule
                                                                       (`.nav-bar-ios-tool .nav-brand-ios-compact`,
                                                                       globals.css) is supposed to enforce
```

The wordmark's containing `<a>` is genuinely collapsed to nothing (`opacity:0; width:0;
overflow:hidden`) — invisible to any real member — and this collapse is itself the fix for an
**earlier, already-documented incarnation of this exact defect** (the CSS rule's own comment
names the live coordinates `x 233..305` / `x 225..269`, byte-identical to what this cycle
re-measured). A closed, never-merged draft PR (#2143, opened 2026-08-13, closed unmerged
2026-08-19 — a "draft deadlock" casualty per this repo's own CLAUDE.md, never undrafted, no
review ever posted) had already diagnosed and fixed the exact same two probe bugs; `main` never
picked it up, so the tooling regressed to reporting the false positive again. This PR reapplies
that fix fresh against current `main`, with a new regression test (the original PR shipped none).

## Root cause (two compounding bugs in `ui-geometry-probe.mjs`)

**Bug 1 — `visibleFraction()` treated a zero-size clipping ancestor as "no constraint".**

```js
const pr = p.getBoundingClientRect();
if (pr.width === 0 || pr.height === 0) continue;   // WRONG: skips the clip entirely
```

`width: 0; overflow: hidden` is the standard idiom for collapsing an element to nothing — it is
the **strongest** clipping constraint there is, not the absence of one. Skipping it left the
descendant's own unclipped `getBoundingClientRect()` (which always reports where content *would*
render) unconstrained, so the collapsed wordmark scored `visibleFraction() === 1` ("fully
visible") despite being invisible behind its own collapsed container.

**Bug 2 — `vis()` read only the node's own `opacity`/`visibility`/`display`, never an ancestor's.**

```js
const s = getComputedStyle(el);
return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
```

`opacity` does not inherit as a *computed* value: a child of an `opacity: 0` parent still computes
its own `opacity: 1` while being completely invisible, because the parent composites its whole
subtree into a transparent layer. Reading only the node's own value calls a deliberately
faded-out subtree visible.

Both bugs independently let the invisible `nav-wordmark` span past the collision check's
visibility gate, at which point its real (unclipped) rect genuinely intersects the `☰` button's
rect (233..305 vs 225..269), producing the reported collision.

## Fix

- `visibleFraction()`: a zero-size `overflow: hidden` ancestor now `return 0` (fully clipped)
  instead of `continue` (no constraint).
- `vis()`: now walks every ancestor up to `<html>`, short-circuiting on the first
  `display:none` / `visibility:hidden` / `opacity:0` found at any level.

Both changes are scoped to the shared geometry-probe file only — no application code touched, no
change to what a member sees or how the product behaves.

## Evidence

- **Before (reverted fix, `git stash`):** new regression test `ui-geometry-probe.test.mjs` RED —
  reproduces the exact collapsed-nav-brand-vs-hamburger pattern and asserts no collision; fails,
  reporting the same `"BLACKOUT" over control "☰"` the live run produced.
- **After (fix applied):** same test GREEN, plus a negative-control test in the same file
  (visible, unclipped, unwrapped label genuinely overlapping the button) still correctly reports
  exactly one real collision — the fix does not blind the detector outright.
- **Live confirmation:** re-ran `live-ui-interaction-audit.mjs --pages=/heatmap` against prod
  before/after the fix. Before: `FAIL — 1 COLLISION(s) on load`. After: `ALL 1 PAGES BEHAVED`, 0
  fails, both desktop and phone viewports.
- `npx tsc --noEmit`: clean. Full `npm test` (Node 20): run alongside this PR.

## Blast radius

`ui-geometry-probe.mjs` is shared by both `live-ui-interaction-audit.mjs` (interaction sweeps) and
`live-ui-deep-audit.mjs` (page-load sweeps) — both get the fix. The same `nav-brand-ios-compact`
pattern is shared chrome across every desk (`src/components/Nav.tsx`), so this false positive was
not `/heatmap`-specific; the closed PR #2143 also measured it live on `/vector` and `/nighthawk`.
No other predicate (`hiddenByScroll`, `animated`, the CLIPPED loop) changes behavior — the CLIPPED
loop already independently excluded this exact pattern (its own comment names
`.nav-brand-ios-compact` by name), so this fix only changes the COLLIDE path's verdict, matching
the already-correct CLIPPED-path verdict.

## Fix rationale

Reapplying the diagnosed, already-written fix from #2143 rather than rediscovering a different
one — it was correct, well-commented, and independently reproduced end-to-end this cycle (live
DOM inspection down to the exact ancestor chain and computed styles, not just the symptom). The
one addition beyond #2143: a real regression test (`ui-geometry-probe.test.mjs`, RED→GREEN
verified), since the original PR shipped the fix with no automated test, which is very likely
part of why it went unmerged and unmissed for five weeks — a green draft with no test asserting
its own necessity gives a reviewer nothing beyond the PR description to check.
