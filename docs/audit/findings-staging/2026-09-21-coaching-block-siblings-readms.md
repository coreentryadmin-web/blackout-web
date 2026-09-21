> **kind:** `FINDING`

## Swing play-brief: `magnetCoaching`/`expectedMoveCoaching`/`wallIntegrityCoaching` still sampled `Date.now()` instead of `ctx.readMs` — FIXED

| **Status** | FIXED (PR pending) |
|---|---|

**Context.** This session already threaded `ctx.readMs` (the single request-wide staleness anchor
`composeSwingPlayBrief` samples once into `SwingPlayBriefContext`) through ~20 call sites this
week (#5334/#5336/#5341/#5345/#5351/#5353/#5355/#5356). The sweep was believed complete for
`play-brief-narrative-coaching.ts`. It was not: three sibling functions in the exact same
coaching-aggregation block (`composeCoachingBullets`, lines ~1328-1336) that all read the identical
`vec` snapshot in the identical compose pass were still sampling a fresh `Date.now()` each:

```ts
push(magnetCoaching(ctx, vec, spot));
push(confluenceCoaching(vec, play, spot, ctx.sessionDate, ctx.readMs ?? undefined)); // already fixed
push(expectedMoveCoaching(vec, spot, ctx.sessionDate));   // NOT threaded
push(wallIntegrityCoaching(vec, play, ctx.sessionDate));  // NOT threaded
```

**Root cause.**
- `magnetCoaching` already receives `ctx` (which carries `ctx.readMs`) as its very first parameter
  — it simply called `Date.now()` directly inside `vectorSnapshotStale(vec, Date.now(), ...)`
  instead of `ctx.readMs`, despite the anchor being right there for free.
- `expectedMoveCoaching` and `wallIntegrityCoaching` never had a `readMs` parameter at all (unlike
  `confluenceCoaching`, their immediate neighbor in the same push() block, which already got one).

**Why this matters (same live-repro class as the `confluenceCoaching` fix these three sit next
to):** `confluenceCoaching`'s own doc comment explains the exact bug this reproduces — two
sections reading the SAME Vector snapshot at two different real clock instants during one compose
can straddle the 120s staleness window (`VECTOR_STALE_MS`) and disagree about whether the identical
data is fresh. `magnetCoaching`/`expectedMoveCoaching`/`wallIntegrityCoaching` sit one/two lines
away from `confluenceCoaching` in the same aggregation block, reading the same `vec` — they were
exposed to precisely the race the neighboring fix was built to close, just never patched
themselves.

**Fix.**
- `magnetCoaching`: changed `Date.now()` → `ctx.readMs ?? Date.now()` (ctx already in scope).
- `expectedMoveCoaching`/`wallIntegrityCoaching`: added an optional trailing `readMs?: number`
  parameter (default `Date.now()` for backward compatibility with existing callers/tests), mirroring
  `confluenceCoaching`'s existing shape exactly.
- Call site (`composeCoachingBullets`) now threads `ctx.readMs ?? undefined` into all four sibling
  calls uniformly.

**Blast radius.** Scoped to these three functions + their one call site; no other call sites for
`magnetCoaching`/`expectedMoveCoaching`/`wallIntegrityCoaching` exist repo-wide (verified by grep).

**Evidence (RED→GREEN).** Added three tests mirroring the existing `confluenceCoaching` anchor
test (same vec/asOf fixture, an anchor 60s after `asOf` renders FRESH, no anchor falls back to the
real wall clock — decades past the fixture — and renders STALE/null). Verified RED pre-fix via
`git stash` isolating only the source change: `not ok 94/95/96` (the 3 new tests), `# pass 121 /
fail 3`. Post-fix: `# pass 124 / fail 0`. `npx tsc --noEmit -p .` clean.

**Scope note (this cycle, market-open, 2026-09-21):** ran the standard 5-engine health check +
CloudWatch sweep alongside this fix; no other new defects found this cycle (0DTE board coherence
pass, live swing ticker sampling — see coordinator handback for detail).
