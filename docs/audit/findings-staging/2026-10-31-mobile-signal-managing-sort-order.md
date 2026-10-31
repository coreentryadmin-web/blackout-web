> **kind:** FINDING

## Mobile Signals feed: `managing` phase sorted out of its documented position — FIXED

| | |
|---|---|
| **Area** | `src/lib/mobile/signals-projection.ts` (iOS Signals tab aggregator, consumed by `GET /api/mobile/signals`) |
| **Severity** | P3 — currently dormant (no live producer emits `managing` yet), but the ordering contract the comparator claims to implement is wrong for any future caller that does |
| **Status** | FIXED |

### Root cause

`sortSignals()`'s own doc comment states the feed order explicitly:

> "Ordering rule for the feed: active first, then confirming, then detected, then
> managing/closed/invalidated/graded."

But the `STAGE_WEIGHT` table it reads from did not implement that order:

```ts
const STAGE_WEIGHT: Record<SignalPhase, number> = {
  active: 0,
  managing: 1,     // <- placed right after "active", before "confirming"/"detected"
  confirming: 2,
  detected: 3,
  closed: 4,
  invalidated: 5,
  graded: 6,
};
```

`managing` was given weight `1`, which sorts it between `active` and `confirming` — directly
contradicting the comment's stated order of `active → confirming → detected → managing/closed/
invalidated/graded`. Every other phase in the table (`closed`/`invalidated`/`graded`) is already
correctly ordered after `detected`; `managing` is the one value that was out of place, which is
consistent with a single misplaced line (most likely `managing` and `confirming` getting
transposed) rather than a deliberate design choice — nothing elsewhere in the file or its history
explains why `managing` specifically would need to rank above `confirming`/`detected`.

### Why it wasn't caught earlier

`SignalPhase` is a 7-value union (`detected | confirming | active | managing | closed |
invalidated | graded`), mirrored from the iOS app's `SignalLifecycle` Swift enum so filter chips
line up across both lifecycle producers. Today only two of those values are ever actually
produced:

- `spxPhaseFor()` returns `active | confirming | detected` only.
- `nighthawkPhaseFor()` returns `active | detected | invalidated` only.

Neither producer emits `managing`, `closed`, or `graded` yet — they're reserved for lifecycle
stages the two live sources don't surface today (e.g. an in-progress trim/manage state, or a
fully-graded historical signal). Because `managing` never appears in a real payload, the
existing test suite's only ordering test (`"sortSignals orders active > confirming > detected >
invalidated..."`) never exercised it, and the mismatch between the comment and the table was
invisible to every prior audit pass that read the file (it reads as a correctly-ordered,
monotonically-increasing table unless you check every value against the prose above it).

### Evidence

Added a test that builds a `Signal` directly with `phase: "managing"` (bypassing both producers,
since neither can emit it today) and asserts the order the comment promises:

```
RED (before fix):  ["a", "m", "c", "d"]   // managing sorted 2nd, ahead of confirming/detected
GREEN (after fix): ["a", "c", "d", "m"]   // managing now sorts after confirming/detected
```

Full RED→GREEN captured via `npx tsx --experimental-test-module-mocks --test
src/lib/mobile/signals-projection.test.ts` — 7/7 pre-existing tests stayed green throughout, 8th
(new) test went RED→GREEN across the fix.

### Blast radius

`signals-projection.ts` has exactly one consumer in the codebase: `src/app/api/mobile/
signals/route.ts` (`GET /api/mobile/signals`, the one endpoint the native iOS Signals tab reads).
No other module imports `sortSignals`, `STAGE_WEIGHT`, or `SignalPhase`. Because no current
producer emits `managing`, this fix changes zero observed output today — it corrects the ordering
rule for the day a future producer (e.g. a Night Hawk "trim in progress" stage, or an SPX
playbook state once that engine exposes a mid-management phase) starts emitting it, so the feed
doesn't silently misorder that signal relative to `confirming`/`detected` on day one.

### Fix rationale

Re-numbered `STAGE_WEIGHT` to match the comment's own stated order verbatim: `active(0) →
confirming(1) → detected(2) → managing(3) → closed(4) → invalidated(5) → graded(6)`. This is the
minimal diff that makes the table agree with its own doc comment — no other phase's weight needed
to change, confirming the bug was isolated to `managing`'s placement rather than a broader
re-think of the intended order. Left the comment text unchanged since the table was the thing out
of step with it, not the other way around.
