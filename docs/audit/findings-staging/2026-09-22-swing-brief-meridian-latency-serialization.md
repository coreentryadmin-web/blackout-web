## Ask Largo swing play-brief: meridian/meridianPeer were awaited BEFORE the context fan-out instead of racing inside it, tripling worst-case source-timeout budget — fix/swing-brief-meridian-latency-serialization

> **kind:** `FINDING`

**Status:** FIXED

### Root cause / gap

`loadSwingPlayBriefContext` (`src/lib/swing/play-brief-context.ts`) composes 8 independent
context reads for the swing play-brief, each individually bounded by `withBriefSourceTimeout`'s
8s budget (`brief-source-timeout.ts`) — a deliberate design the file's own header comment
documents was built specifically to stop a single slow upstream from hanging the whole brief past
Cloudflare's edge timeout (a real 2026-09-09 incident: a request hung past a 120s client timeout
while ALB `TargetResponseTime` showed repeated p99 spikes to 90-104s).

Two of those 8 sources — `fetchMeridianForTicker` and `fetchMeridianPeerForBrief` — were NOT
inside that bounding `Promise.all`. They were `await`ed one after another, sequentially, BEFORE
the `Promise.all` fanning out the other six sources (ecosystem, vector, open book, archetype
track record, roll history, ticker track record) ever started. meridianPeer does genuinely depend
on meridian's own result (`fetchMeridianPeerForBrief(meridian, ticker)` reads `meridian.items` to
find an earnings catalyst to fetch a peer cohort for) — but nothing about the other six sources
depends on either of them, so sequencing them ahead of the fan-out bought no correctness and cost
real worst-case latency: `meridian(≤8s) + meridianPeer(≤8s) + Promise.all(≤8s)` — up to ~24s
serialized into one request, on the exact code path the same file's header comment already flags
as latency-sensitive.

### Fix

`meridianPromise` is created immediately (still individually `withBriefSourceTimeout`-bounded).
`meridianPeerPromise` is chained off it with `.then()` — so it still only starts once `meridian`
resolves, preserving the real dependency — and both are added as two more entries in the SAME
`Promise.all` as the other six sources, instead of sitting outside it. Worst case drops to ~16s
(the `meridian`→`meridianPeer` chain, now the tallest single path, racing concurrently with the
other six 8s-bounded reads) instead of ~24s. No change to any source's own logic, timeout budget,
or the composed envelope's shape — purely a scheduling fix.

### Evidence

- New timing regression test (`play-brief-context.test.ts`, "independent sources fan out
  concurrently, not serially"): gives `fetchMeridianForTicker` and `fetchEcosystemContext` mocks
  an artificial 150ms delay each and asserts total elapsed stays well under their sum.
- RED confirmed pre-fix via `git stash` on `play-brief-context.ts` alone (test kept): 301ms
  elapsed — the two delays serialize almost exactly as before the fix.
- GREEN post-fix: ~152ms elapsed — the two sources race, bounded by the max delay, not the sum.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20): 15186 pass / 0 fail / 3 skipped (pre-existing, unrelated).

### Blast radius

One call site: `loadSwingPlayBriefContext` is the only place `fetchMeridianForTicker` and
`fetchMeridianPeerForBrief` are composed together (confirmed via repo-wide grep on both function
names — no other caller schedules them relative to the rest of a context fan-out). Both source
functions themselves are unchanged; this is a scheduling-only fix inside the one composition site.
