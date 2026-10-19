## Swing play-brief evidence/levels still sample the real wall clock, not `ctx.readMs` — FIXED

> **kind:** `FINDING`

| **Status** | FIXED — PR pending merge. |
|---|---|
| **Severity** | P3 — latent in production today (no real caller pre-stamps `ctx.readMs` yet), live-risk the moment one does |
| **Found by** | Ask Largo × Night Hawk Swings standing deep-dive mandate, round 5 (2026-10-19) |

### Root cause

`composeSwingPlayBrief` (`src/lib/swing/play-brief.ts`) stamps one canonical "now" onto `ctx.readMs`
at the top of the function (`ctx = { ...ctx, readMs: ctx.readMs ?? readMs }`) specifically so every
staleness check downstream reads the *same* instant rather than each section independently sampling
`Date.now()` at whatever moment it happens to compose (the function does real sequential I/O between
sections, so those instants can be seconds apart). `play-brief-types.ts`'s own doc comment on the
`readMs` field documents the live defect this closes (2026-09-21, SNXX repro: two sections reading
the identical cached Vector snapshot landed on opposite sides of the 120s staleness boundary and
silently disagreed about whether a GEX wall was live or stale) — and names it as a **known, still-open
follow-up**: *"Only `confluenceCoaching` and `watchForSection` ... are wired to this anchor so far;
the other ~18 `Date.now()` call sites are the same class of latent risk and a natural next sweep."*

A 2026-10-12 fix (same file, `composeSwingPlayBrief`'s WATCH/OPEN branches) closed two more of those
~18 — `watchEntrySection`/`pnlSection` were being called with the bare `readMs` local (always the
real `Date.now()` sampled at this function's top) instead of `ctx.readMs ?? readMs`. That fix's own
blast-radius check never reached `evidenceFromContext`/`levelsFromContext` — the sole feeders of
`envelope.evidence`/`envelope.levels` — which were calling `evidenceFromContext(ctx, readMs)` /
`levelsFromContext(ctx, readMs, bucket)` with the same bare local, unchanged.

### Why this is latent, not an active production bug today

The one real caller (`GET /api/market/swing/play-brief`, via `loadSwingPlayBriefContext`) never
pre-stamps `ctx.readMs` before calling `composeSwingPlayBrief` — so `ctx.readMs ?? readMs` and the
bare `readMs` evaluate identically in production right now. This is not a live, member-visible defect
today. It *is* a real, traceable deviation from this file's own established and partially-enforced
convention, and it silently reactivates the exact already-twice-documented bug class (SNXX repro,
2026-09-21; the 2026-10-12 watch/pnl fix) the moment any future caller or test pins `ctx.readMs` to a
shared anchor — which `readMs`'s own doc comment explicitly anticipates ("a caller that composes
multiple briefs off one shared anchor"). `evidence`/`levels` are core, high-visibility parts of every
brief (every "Why this setup"/"Watch levels" freshness tag derives from them), so a regression here
would be exactly as consequential as the original SNXX repro.

### Fix

`src/lib/swing/play-brief.ts` — changed the two call sites to `ctx.readMs ?? readMs`, matching the
2026-10-12 precedent exactly:

```ts
const evidence = safeCompose("evidence", () => evidenceFromContext(ctx, ctx.readMs ?? readMs), [], trackBuildFailure);
const levels = safeCompose("levels", () => levelsFromContext(ctx, ctx.readMs ?? readMs, bucket), [], trackBuildFailure);
```

### Regression test

`src/lib/swing/play-brief.test.ts` — new test "option-mark evidence freshness honors ctx.readMs, not
the real wall clock": pins `ctx.readMs` to a past instant (2026-09-10) and sets `play.markAsOf` 30s
before it (must read `freshness: "live"`). RED before the fix (read `"stale"` — the mark's real age
against today's wall clock is ~six weeks); GREEN after. `npx tsc --noEmit` clean; full
`play-brief.test.ts` suite 156/156 pass.

### What this does NOT do

Does not sweep the remaining ~16 documented `Date.now()` call sites named in `readMs`'s own doc
comment — those live inside the staleness HELPER functions themselves (`gexFreshness`,
`vectorFreshness`, `gexMatrixStale`, etc.), which correctly use whatever `readMs` value their caller
passes them; the defect here was specifically at the two remaining `composeSwingPlayBrief`-level call
sites that hadn't been updated to pass the right value in. A wider sweep of every other caller of
those helpers (outside `composeSwingPlayBrief`) is explicitly out of scope for this fix, consistent
with the file's own "a natural next sweep" framing — this closes two more of the ~18, not all of them.

### Blast radius

`src/lib/swing/play-brief.ts` only (two call-site arguments changed) + its own test file. No type or
behavioral change to any helper function; `evidenceFromContext`/`levelsFromContext` themselves are
untouched.
