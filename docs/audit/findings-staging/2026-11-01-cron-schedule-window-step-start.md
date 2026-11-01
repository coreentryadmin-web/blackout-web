> **kind:** FINDING

## `cron-schedule-window.ts`'s cron-field parser silently discarded the start value of a bare `"N/M"` step field — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** discovery-lane audit sweep, round 277 (2026-11-01), while auditing utility code
outside the Night Hawk/Largo/SPX/Swing/Banger exclusion list for fresh correctness-bug veins.

**Root cause:** `src/lib/cron-schedule-window.ts`'s `parseIntList()` — the shared field parser
behind `isInOffScheduleIdleGap`/`lastExpectedCronFireUtc`/`nextExpectedCronFireUtc`, the functions
the admin cron-health dashboard (`admin-cron-health.ts`) uses to suppress false "stale cron" alerts
during a schedule's own idle gaps — handles four cron-field shapes: `*` (all values), `A-B`
(range), `A-B/N` (range + step), `*/N` (step from the field's own minimum), and a bare `N/M` (step
only, no range, no `*`). The first three, and the bare-`N`-only case, were all correct. The bare
`N/M` branch was not:

```ts
const stepOnly = part.match(/^(\d+)\/(\d+)$/);
if (stepOnly) {
  const step = Number(stepOnly[2]);                       // group 1 (the start value) ignored
  for (let v = min; v <= max; v += step) out.add(v);       // steps from the FIELD's bare minimum
  continue;
}
```

In standard cron/Quartz step syntax, `"N/M"` (no leading range, no `*`) means "start at `N`,
repeat every `M` until the end of the field's range" — e.g. `"5/15"` in a minutes field means
`:05, :20, :35, :50`, not `:00, :15, :30, :45`. The code captured the start value (`stepOnly[1]`)
in the regex but never read it, so every bare `N/M` field silently behaved as if it had been
written `"0/M"` (or, for an hour field, `"<min>/M"`) instead — the wrong set of fire times, with no
error, no empty result, and no other symptom that would call attention to the mismatch. This is
exactly the "parses successfully and returns something, but the wrong something" failure shape
this repo's audit culture flags repeatedly (see `darkpool-bias.ts`'s own header on the same
principle): a function that already correctly implements the *sibling* step forms (`*/N`'s start
is the field min by definition; `A-B/N`'s start is `A`, read and used correctly by the `stepMatch`
branch two cases above) left exactly one of the four documented step shapes half-implemented.

**Why it never surfaced live:** every `schedule_cron_utc` currently registered in
`src/lib/cron-registry.ts` uses either `*/N` or `A-B/N` (both already correct) or a bare literal
list/range with no step at all — none uses the bare `N/M` form with a non-zero start, so the
discarded start value happened to never matter against the live registry. But the function is a
general-purpose cron-field parser that already claims to support this exact syntax (it has a
dedicated branch for it), used by the admin dashboard to decide whether a currently-silent cron is
"expected to be silent right now" or genuinely stale — the day anyone adds a schedule using `N/M`
with `N != min`, the health check would silently compute the wrong idle window and either mute a
real staleness alert or fire a false one, with nothing in the code path announcing that it had
done so.

**Blast radius:** `parseIntList` is a private (unexported) helper with three call sites, all
through `enumerateFiresOnUtcDay` → `dailyFireBounds`/`lastExpectedCronFireUtc`/
`nextExpectedCronFireUtc` → `isInOffScheduleIdleGap`, which `admin-cron-health.ts` calls twice (the
summary snapshot and the per-job detail view) to decide whether a quiet cron job is inside an
expected gap. No other module reimplements this parser, so the one fix covers every consumer.

**Fix:** read the start value out of the already-captured regex group and step from it instead of
from the field's bare `min`, matching the same convention the `starStep` (`*/N`, start = `min`) and
`stepMatch` (`A-B/N`, start = `A`) branches immediately above it already use. No new parsing logic
was introduced — the fix makes the existing branch consistent with its two siblings.

**Fix rationale:** reusing the same "start, then step to `max`" loop shape as the other two step
branches (rather than inventing a new one) keeps the four branches visibly parallel, which is the
property that made the omission easy to spot once looked at side-by-side.

**Evidence (RED → GREEN):** added a regression test to `src/lib/cron-schedule-window.test.ts`
using `cron = "5/15 10 * * *"` and `now = 2026-07-30T10:10:00.000Z`. Correct behavior: the minute
field `"5/15"` fires at `:05/:20/:35/:50`, so the last fire at-or-before `now` is `10:05:00.000Z`
and the next fire strictly after `now` is `10:20:00.000Z`. RED (pre-fix): `lastExpectedCronFireUtc`
returned `10:00:00.000Z` (computed from the wrongly-substituted `0/15` set) — assertion failure,
`'2026-07-30T10:00:00.000Z' !== '2026-07-30T10:05:00.000Z'`. GREEN (post-fix):
`npx tsx --experimental-test-module-mocks --test src/lib/cron-schedule-window.test.ts` → 16/16
pass (15 pre-existing + 1 new). Also ran `src/lib/admin-cron-health.test.ts` (consumer of this
module) unaffected: 15/15 pass. `npx tsc --noEmit`: clean.
