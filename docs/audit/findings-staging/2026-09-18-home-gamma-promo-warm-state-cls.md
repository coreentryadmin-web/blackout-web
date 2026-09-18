# Homepage gamma-promo panel's mount-fetch self-heal caused a real CLS regression — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Component** | `src/components/landing/HomeGammaPromo.tsx` / `src/app/marketing-redesign.css` (`.gamma-promo-warm`) |
| **Severity** | P3 — SEO/UX Core Web Vitals, no data-correctness impact |

### Root cause

The homepage (`src/app/(marketing)/page.tsx`) is ISR (`revalidate = 3600`), seeded via
`readPublicGexSnapshotSeed` — a deliberate **cache-only** read (never live-computing, per that
page's own comment, to avoid poisoning the shared snapshot cache — see the 2026-09-03 incident
trace it references). That seed can legitimately lack full levels at the moment a given ISR page
was generated, and the page's own comment says the client "always self-heals with its own live
fetch on mount" — confirmed as deliberate, tested behavior by the existing
`HomeGammaPromo.test.ts` test asserting `loading` is seeded from `!hasLevels(initial)`.

What nobody had covered was the **visual** consequence of that self-heal: `HomeGammaPromo.tsx`
gates its render on `showLevels = hasLevels(snapshot)` with a hard structural branch —
`!showLevels` renders a small, centered `.gamma-promo-warm` placeholder (one line of text,
`padding: 2rem 1rem`), while `showLevels` renders a completely different, much taller subtree
(spot headline + regime badge, a 3-tile call/flip/put matrix, an optional ladder, and the
`snapshot.read` narrative). The `.gamma-promo-cta` "Open full snapshot" button sits immediately
after this conditional. When the mount-fetch resolves (typically within ~300ms–1s) and flips
`showLevels` from false to true, the panel visibly collapses-then-expands, pushing the CTA and
everything below it down.

### Evidence

Caught live during a routine SEO lane heartbeat (2026-09-18, desktop, post-Cloudflare-edge-purge
so the measurement reflects the real origin response, not a stale edge copy): `cls-measure.cjs`
returned **CLS 0.132** on the homepage — over the 0.1 "needs improvement" threshold — where prior
cycles had consistently measured ~0-0.03. Immediate re-runs (3x) returned to the usual near-zero
baseline (0.0003, 0, 0.0001), consistent with an intermittent, seed-dependent defect rather than a
constant regression.

Instrumented the exact shift with a `PerformanceObserver` capturing `sources` (element + before/
after rects) across 5 repeated purge+load rounds; 2/5 caught a real, non-trivial shift
(0.0195 and 0.0547) with `.gamma-promo-cta` and `.gamma-promo-read` consistently among the moved
elements — one capture showed the CTA link's own rect going from `height: 4` (effectively
collapsed) to `height: 109` (its real size), directly matching a `showLevels` flip mid-load.
Traced to the source: `showLevels` is computed once per render from `snapshot`, which starts as
`initial` (the ISR seed) and is replaced by the mount-fetch's live result — exactly the
"self-heals with its own live fetch on mount" behavior `page.tsx`'s own comment documents as
deliberate.

### Fix

`.rl .gamma-promo-warm` now reserves `min-height: 14rem` (plus `display:flex;
align-items:center; justify-content:center` so the short placeholder text sits centered in the
taller box rather than pinned to the top) — sized from the live-measured ~105-140px delta between
the compact and full states, generously rounded up. This does not touch the self-heal itself
(still correct and necessary, per the incident trace `page.tsx` documents) — it only removes the
visible layout consequence of the state it already needs to pass through.

### Fix rationale

Considered restructuring the component to always render the full DOM shape with `"—"` placeholder
values (matching the pattern `GammaSnapshotWidget.tsx` already uses for individual fields like
`WallRole`) instead of branching between two structurally different subtrees. Rejected for this PR
as a larger, riskier diff than the evidence justifies — the CSS reservation directly fixes the
measured defect with a small, additive, easily-reverted change. `GammaSnapshotWidget.tsx`
(`/tools/gamma-snapshot`) has the same branch shape and was investigated separately this session
for its own, still-inconclusive intermittent CLS anomaly (see `docs/audit/RUN-LOG.md`,
2026-09-15 13:55 UTC entry) — that page uses `force-dynamic` (not ISR), so this exact root cause
(a stale/level-less ISR seed) does not apply there; left untouched, not part of this fix.

### Blast radius

Single CSS rule (`.rl .gamma-promo-warm`), scoped to this one component's warm/loading state.
`.gamma-promo-warm-scan` (the absolutely-positioned scan-line overlay, `inset: 0`) is unaffected —
it still fills its positioned ancestor (`.gamma-promo-warm`, `position: relative`) regardless of
the new `display: flex`. No other selector reads `.gamma-promo-warm`'s box model.

### Tests

`src/components/landing/HomeGammaPromo.test.ts`: added a source-scan regression test (matching
this file's existing style) asserting the `min-height:14rem` rule is present on `.rl
.gamma-promo-warm` in `marketing-redesign.css`. RED→GREEN confirmed via `git stash` isolating the
CSS change from the test (1 fail → 3/3 pass). Full suite: 14839 pass / 0 fail / 3 skipped.
`npx tsc --noEmit`: clean. All on Node 20.20.2.

**Not independently re-verified live post-deploy in this cycle** — the fix has not merged/deployed
yet. Flagging for a follow-up RTH/heartbeat cycle to purge the edge and re-measure
`https://blackouttrades.com/` homepage CLS specifically watching for this panel once this PR is
live, per the standing "a merge is not a verification" discipline.

---
_Generated by [Claude Code](https://claude.com/claude-code)_
