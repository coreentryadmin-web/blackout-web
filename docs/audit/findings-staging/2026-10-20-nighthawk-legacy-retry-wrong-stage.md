## Night Hawk Legacy's bounded dossier retry (PR #6380) retried the wrong pipeline stage and could never recover from the starved-funnel scenario it was written for — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, 5-engine live monitor cycle, Night Hawk Legacy live correctness check
(production, read-only) — independently verified against the current source before fixing.

**Root cause:** PR #6380 (merged `2026-10-20T18:54:25Z`, commit `326320d17`) added a bounded retry
in `src/features/nighthawk/lib/edition-builder.ts` meant to recover from the funnel collapsing to
`scoredList.length === 0` (recap-only, zero plays) — the incident it names cites "UW rate-limiter
congestion during the rescore pass" as the root cause. That retry wrapped the wrong call:

```ts
while (rescoreAttempt < MAX_RESCORE_ATTEMPTS && scoredList.length === 0) {
  if (rescoreAttempt > 0) { ...; await new Promise((resolve) => setTimeout(resolve, 2000)); }
  for (const d of Object.values(dossiers)) {
    rescoreDossier(d, regime, 1, { ... }); // <-- retried this
  }
  scoredList = Object.values(dossiers).filter((d) => d.scored != null).map((d) => d.scored!);
  rescoreAttempt += 1;
}
```

`rescoreDossier` (`hunt-builder.ts:148`) is a non-`async` function that synchronously calls
`scoreCandidate` (`scorer.ts:1059`, 270-line body, grep-verified zero `await`/`fetch(`/`async`
anywhere in it) — a pure function of already-in-memory dossier fields, with **zero network I/O**.
All the real network I/O (UW flow alerts, IV rank, positioning, tech, news, financials) happens
earlier and exactly once, in `fetchAllDossiers` → `fetchTickerDossierWithWall` → `fetchTickerDossier`,
**before** the retry loop ever runs. `fetchTickerDossierWithWall` returns `null` on its 45s
per-ticker wall timeout, and `fetchAllDossiers` silently drops nulls (`if (!d) continue;`) — so
under the exact congestion scenario the retry targets (every ticker times out), `dossiers` ends up
with **zero keys**, not "20 attempted, 0 scored." The retry loop then ran `Object.values(dossiers)`
(empty) twice with a 2s sleep in between, touching nothing that could change between attempts, and
fell through to recap-only exactly as before — a no-op dressed as resilience.

**Live impact confirmed before fixing:** `GET /api/market/nighthawk/edition` showed
`edition_for: "2026-10-20"`, `recap_only: true`, `no_plays: true`, `published_at` unchanged since
first publish (confirming no retry — old or new — ever re-fired for this edition), and
`funnel: {candidates: 20, dossiers: 0, ...}` — the `dossiers: 0` signature matches the "every
fetch timed out" failure mode exactly, not a "fetched but failed to score" one. This is also
Night Hawk Legacy's **4th** consecutive recap-only session day (Oct 17–20), worse than the "two
consecutive nights" PR #6380's own framing cited.

**Fix:** Moved the bounded retry to wrap the actual dossier-FETCH stage (both the checkpointing
and non-checkpointing branches of STAGE 3) instead of the rescore pass. The retry condition is now
`Object.keys(dossiers).length === 0 && candidates.length > 0` — i.e. it retries when the fetch
itself produced nothing, which is the real, recoverable failure mode. The rescore pass after the
loop is now a single, un-retried pass (retrying a pure function buys nothing). The `resumed` field
in the final result is captured once, before the retry loop (`alreadyDoneAtStart`), so a retry that
stages some dossiers on its own first pass doesn't get misreported as "resumed from an earlier run."

**Fix rationale:** The minimal correct fix is to retry the stage that can actually fail
transiently (network fetch) rather than invent a new mechanism — same fetch function
(`fetchAllDossiers`), same staging/job-status calls, just invoked again inside a bounded loop keyed
on the real failure signal (empty `dossiers`, not empty `scoredList`). Left unchanged: the
checkpointing/staging machinery itself, the `MAX_DOSSIER_FETCH_ATTEMPTS = 2` (initial + one retry)
and 2s delay (same bound PR #6380 picked, not re-litigated here), and every stage after dossier
scoring.

**Blast radius:** Single function (`buildEveningEdition`, STAGE 3). No other caller retries this
stage; `fetchAllDossiers`'s own signature and behavior are untouched.

**Tests:** `src/features/nighthawk/lib/edition-builder-dossier-fetch-retry.test.ts` — 5 new
source-inspection regression tests (full behavioral mocking of this "multi-thousand-line pipeline"
function is prohibitively expensive, per this same file's own established precedent in
`candidate-snapshot-alert-wiring.test.ts`): the retry condition checks `dossiers`, not
`scoredList`; `fetchAllDossiers` is called from inside the retry loop on both branches; the
rescore pass has no retry/sleep wrapper and the old `MAX_RESCORE_ATTEMPTS` constant is gone; the
recap-only reason names the fetch-attempt count; `resumed` reflects the pre-retry state.
RED→GREEN proven via `git stash` (5/5 fail against the pre-fix source, pass post-fix).
`tsc --noEmit` clean. Full nighthawk edition-builder test family (80 tests across 7 files) green,
no regressions.
