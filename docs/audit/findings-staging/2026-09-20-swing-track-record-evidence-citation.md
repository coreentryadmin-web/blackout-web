## Archetype/ticker track-record numbers now also surface as citable evidence[], not just prose — ENHANCEMENT

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Status** | FIXED |
| **Area** | `src/lib/swing/play-brief.ts` (`evidenceFromContext`) |

### How found

A deliberate, systematic sweep of `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s ten C1-C10 points this
cycle (per the standing Ask Largo × Night Hawk Swings mandate), covering C-points this session
hadn't yet explicitly audited (this session already organically touched C2/C3/C4/C9 via #5306-
#5313). Reading C10 ("HISTORICAL CONTEXT... expose it as a **tool** carrying the fields above...
historical reasoning baked into prose cannot be joined, verified or cited") led to checking
`archetypeTrackRecordSection`/`tickerTrackRecordSection` (`play-brief-intel.ts`) — both already cite
C10 explicitly in their own doc comments — and confirming their real wins/losses/n numbers only
ever reach the model flattened into the "Track record"/"Ticker track record" SECTIONS' prose, never
as a structured `evidence[]` entry the way every other citable fact in `evidenceFromContext` already
is.

### What this is (and isn't)

Not a bug — the two sections work correctly and their own authors already named the C10 gap in
their doc comments (`tickerTrackRecordSection`'s header: *"Largo product contract C10, 'historical
context'"*). This is a genuine, additive enhancement toward closing that named gap further: it does
not build the full dedicated Largo tool C10 describes as the ideal (a larger, separate design call,
out of scope here), but it does make the same numbers available in a second, structured form
(`evidence[]`, which already carries typed `provenance: {source, asOf, freshness}` on every entry)
alongside the existing prose, so a consumer that wants to cite/join the number no longer has to
parse free text to get it.

### Fix

Two new `evidenceFromContext()` (`play-brief.ts`) pushes, additive, at the end of the function:

1. **Archetype track record** — when `graduatedArchetypeEntry(ctx.archetypeTrackRecord,
   swingArchetype)` returns a graduated entry (the same call/gate `archetypeTrackRecordSection`
   already uses — an ungraduated bucket is correctly never cited, per the existing C6 omission
   discipline), pushes `"Archetype track record: <label> <wins>W / <losses>L across <n> graded
   plays (Wilson 95% floor <pct>%)."` with `provenance: {source: "Swing ledger", asOf:
   <snapshot's own write time>, freshness: <computed from that write time>}`.
2. **Ticker track record** — when `ctx.tickerTrackRecord.priorClosedTrades > 0` (the same gate
   `tickerTrackRecordSection` uses), pushes `"Ticker track record: <ticker> <wins>W / <losses>L
   across <n> prior closed trade(s)."` with `provenance: {source: "Swing ledger", asOf: ctx.asOf,
   freshness: "recent"}` — the same live-read provenance shape the file's existing sibling-position
   evidence line already uses, since this is a fresh per-request DB read, not a cached snapshot.

### Blast radius

One file, one function, purely additive — no existing evidence line's gating, ordering, or content
changed. The two prose sections (`play-brief-intel.ts`) are completely untouched.

### Verification

Two new tests in `play-brief.test.ts`, mirroring the existing prose-section test's fixtures exactly
(same graduated/ungraduated/absent-snapshot cases for archetype; present/zero-prior-trades cases for
ticker) so the evidence-citation behavior is proven against the identical inputs the prose tests
already cover. RED→GREEN proven via `git stash` on `play-brief.ts` alone (test file kept): 2
failures without the fix, 0 with it (99/99). `npx tsc --noEmit` clean. Full `npm test` (Node 20) run
before opening the PR, result recorded in the PR description.

Per CLAUDE.md's rescinded Cursor-sign-off carve-out (2026-09-10): merges on green CI + clean
mergeable state, no Cursor review wait required.
