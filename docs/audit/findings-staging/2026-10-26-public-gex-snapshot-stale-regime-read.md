## Public GEX snapshot served a stale actionable regime read across a session boundary — FIXED

> **kind:** `FINDING`

**Status.** FIXED (branch `fix/public-gex-snapshot-stale-regime-read`, PR pending).

### Area

`src/lib/public-gex-snapshot.ts` (`degradedFromLastGood`) and
`src/lib/public-gex-snapshot-types.ts` (`applyPublicReadFreshnessGate`) — the free, unauthenticated
lead-magnet snapshot backing `/tools/gamma-snapshot` and the homepage gamma promo
(`buildPublicGexSnapshot`). Non-owned.

### Found by

Code-correctness read, DISCOVERY-lane sweep, 2026-10-26 (fresh angle: the public lead-magnet
snapshot surface, not previously covered today).

### Root cause

`buildSnapshotFromHeatmap` composes the regime narration through
`applyPublicReadFreshnessGate(correctPublicRead(sanitizePublicRead(...)), session.market_session)`
at the moment of a successful live compute — this gate exists specifically to stop the regime
read's actionable claim ("→ short gamma: momentum / vol expansion, moves accelerate" / "→ long
gamma: range-bound, fade extremes") from being published next to a price that is not actually a
live quote (the 2026-09-02 P1 this gate itself fixed).

That composed snapshot — including the already-gated `read` string — is then persisted into the
24h "last known good" cache (`persistLastGood`, `LAST_GOOD_TTL_SEC = 86_400`), whose entire stated
purpose (per its own comment) is to survive being re-served long after it was computed, so the
public acquisition surface never goes blank on a transient upstream miss.

`degradedFromLastGood` (invoked from `resolveMiss` whenever a live refresh fails and a last-good
copy exists) correctly recomputed `market_session`/`session_date`/`as_of_et` from the CURRENT
moment before serving — but passed `lastGood.read` straight through unchanged:

```ts
read:
  lastGood.read ||
  "Last known dealer positioning — live feed temporarily unavailable. ...",
```

So a snapshot built while the market was OPEN (actionable, ungated read) and later re-served while
CLOSED/PRE-MARKET/AFTER-HOURS during a live-fetch outage would report `market_session: "CLOSED"`
(correct) while `read` still asserted live momentum/range-bound behavior (stale and wrong) — the
exact contradiction `applyPublicReadFreshnessGate` exists to prevent, reachable specifically
through the one cache path (`LAST_GOOD_TTL_SEC`, 24h) explicitly designed to span a session
boundary. No existing test exercised this: `public-gex-snapshot-degraded.test.ts`'s fixture read
("Long gamma regime.") never contained the actionable clause the gate matches on, and no test
mocked `et-session-facts` to force a session transition between the live build and the degraded
re-serve.

### Fix

1. `degradedFromLastGood` now re-applies `applyPublicReadFreshnessGate(lastGood.read, session.market_session)`
   against the CURRENT session before serving, instead of carrying the stale-gated text forward.
2. Made `applyPublicReadFreshnessGate` idempotent/reversible (`public-gex-snapshot-types.ts`): it
   first undoes any PRIOR application of the gate (strips the `"Prior-session structural
   reference — "` prefix and restores the original live clause) before re-gating for the session
   passed in. Required because re-gating a read that may already be gated — in either direction,
   as the market opens or closes between the original compute and the last-good re-serve — must
   never stack a second prefix or leave mismatched wording, and the function had no way to know
   whether its input was already gated.

### Blast radius

Only `degradedFromLastGood`'s one call site (`resolveMiss`) is affected — the live-compute path
(`buildSnapshotFromHeatmap`) and the plain cache-hit path (`buildPublicGexSnapshot`'s/`readPublicGexSnapshotSeed`'s
`withAgeFields(cached)`, which only re-serves within the 5s `CACHE_TTL_SEC` and therefore cannot
span a session boundary) are unchanged. `applyPublicReadFreshnessGate` is exported and used
identically everywhere else; the reversibility change only affects behavior when it is called a
second time on already-gated text, which previously happened nowhere in the codebase.

### Tests

4 new unit tests, RED→GREEN via `git stash` on the two source files (3 failed pre-fix, 0 post-fix):
- `public-gex-snapshot.test.ts`: `applyPublicReadFreshnessGate` re-gating the same session is a
  no-op (no doubled prefix); re-gating for a different session transitions cleanly in both
  directions (CLOSED→OPEN fully restores the original live read, for both the short- and
  long-gamma clauses).
- `public-gex-snapshot-degraded.test.ts`: a new `et-session-facts` mock lets the test move the
  session between a live OPEN build and a forced last-good re-serve; asserts the degraded read no
  longer claims "moves accelerate" once `market_session` is `CLOSED` and carries the expected
  "Prior-session structural reference" prefix.

Full suite + `tsc --noEmit`: clean (see PR for the exact run).
