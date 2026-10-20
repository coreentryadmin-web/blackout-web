## `dataHonestyCoaching`'s GEX-staleness check used the real wall clock instead of the shared `ctx.readMs` anchor — the exact documented "natural next sweep" gap, found and closed — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo standing mandate, a follow-up static-code read of
`play-brief-types.ts` (the `SwingPlayBriefContext.readMs` field's own doc comment explicitly names
this as open: *"Only `confluenceCoaching` and `watchForSection` ... are wired to this anchor so
far; the other ~18 `Date.now()` call sites are the same class of latent risk and a natural next
sweep, left as a documented follow-up rather than folded into this fix"* — a repo-wide grep for
every `gexMatrixStale(`/`gexMatrixAgeMs(`/`vectorSnapshotStale(`/`vectorAgeStale(` call across
`src/lib/swing/` and `src/features/spx/lib/` with the `readMs` argument omitted found exactly two,
both inside `dataHonestyCoaching` (`play-brief-narrative-coaching.ts`).

**Root cause:** `gexMatrixStale`/`gexMatrixAgeMs` (`play-brief-absence.ts`) both default their
`readMs` parameter to `Date.now()` when omitted. `dataHonestyCoaching` explicitly computes `const
readMs = ctx.readMs ?? Date.now();` near the top of the function — its own comment states the
purpose plainly: *"prefer ctx.readMs over a fresh Date.now() sample so this bullet's staleness
verdicts agree with every other section of the same brief judging the identical vec/mark
snapshot"* — and correctly threads `readMs` into every other staleness check in the function
(`vectorAgeStale(vec, readMs)`, and `gexMatrixStale(gex, readMs)` again 46 lines later for
`closedMarketNote`). The ONE GEX-staleness check in between (`if (!dead &&
gexMatrixStale(gex)) { ... gexMatrixAgeMs(gex) ... }`) simply omitted the argument it had
already computed for exactly this purpose — a narrow, isolated oversight, not a design choice: the
same function reads the identical `gex` object correctly-anchored just 46 lines later.

**Live impact:** this function's own "GEX matrix **Ns** stale — dealer posture may lag spot"
warning could disagree with a DIFFERENT section's verdict on the identical `gex` snapshot
elsewhere in the same composed brief, if enough real wall-clock time elapses during the brief's
sequential I/O (Meridian/ecosystem/vector/book-context reads, per this same file's own documented
compose sequence) between when `ctx.readMs` is stamped and when this line runs — exactly the
"two sections silently disagree about the identical fact" failure class the `readMs` anchor exists
to prevent (the 2026-09-21 original fix's own live repro, SNXX, was this exact shape for
`confluenceCoaching`/`watchForSection`). Confirmed live via direct trace rather than speculation:
a fixture with `gex.asof` fresh relative to a historical `ctx.readMs` (same shape several existing
tests in this file already use) reproduces a spurious "GEX matrix stale" warning under the buggy
code purely because the real wall clock has moved on since the fixture's anchor instant — the exact
scenario the bug enables in production whenever the compose sequence takes real time.

**Fix:** Pass `readMs` as the second argument to both calls, matching every sibling staleness check
in the same function.

**Fix rationale:** Minimal, single-line-per-call correction — the anchor variable already existed
in scope for exactly this purpose; no new mechanism, no behavior change beyond aligning this one
check with its own sibling checks 46 lines apart in the same function.

**Blast radius:** Single function (`dataHonestyCoaching`), two calls. Repo-wide grep confirms no
other `gexMatrixStale`/`gexMatrixAgeMs`/`vectorSnapshotStale`/`vectorAgeStale` call site in
`src/lib/swing/` or `src/features/spx/lib/` omits `readMs` — this closes the documented sweep
completely, not partially.

**Tests:** 1 new regression test, same proof shape as the file's existing "an explicit readMs
anchor (not the real wall clock) decides staleness" tests (confluenceCoaching/magnetCoaching/
vexCoaching/etc.) — a `gex.asof` fresh relative to a fixed historical `ctx.readMs` must not warn
stale, proving the verdict follows the anchor, not the real wall clock. RED→GREEN proven via
`git stash` (fails against the pre-fix source — the spurious "GEX matrix stale" warning renders —
passes post-fix). `tsc --noEmit` clean. Full `play-brief-narrative-coaching.test.ts` (187 tests)
green, run on Node 20.
