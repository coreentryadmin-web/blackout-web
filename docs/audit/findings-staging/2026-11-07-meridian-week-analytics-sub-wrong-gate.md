> **kind:** FINDING

## Meridian desk "universe chip" suppresses a real revenue beat rate when EPS has no gradeable prints — FIXED

| | |
|---|---|
| **Area** | Meridian desk, earnings-week universe chip (`MeridianDesk.tsx`) |
| **Severity** | P3 — cosmetic/data-display, no trading impact |
| **Status** | FIXED |

### Root cause

`weekAnalyticsSub` (added in #2513, which fixed a *different* cohort-mismatch bug in this
exact string) renders the desk's "universe chip" subtitle, e.g.
`"12/40 printed · rev beat 62% of 96 prints"`. Its gate was:

```ts
function weekAnalyticsSub(a) {
  const printed = `${a.printed_this_week}/${a.names_count} printed`;
  if (a.eps_beat_rate == null) return printed;              // <-- wrong field
  if (a.revenue_beat_rate == null) return `${printed} · rev beat —`;
  const of = a.revenue_graded && a.revenue_graded > 0 ? ` of ${a.revenue_graded} prints` : "";
  return `${printed} · rev beat ${Math.round(a.revenue_beat_rate * 100)}%${of}`;
}
```

The string only ever displays the **revenue** beat rate (there is no EPS clause in this
component at all), but the first gate checks `eps_beat_rate`, an unrelated field, instead of
`revenue_beat_rate`. `dualBeatRateFromPrints` (`meridian-benzinga-earnings-core.ts`) computes
`eps_beat_rate` and `revenue_beat_rate` from two **independent** cohorts (`eps_graded` = prints
with a gradeable EPS surprise, `revenue_graded` = prints with a gradeable revenue surprise) —
that function's own doc comment states this is a measured, live occurrence: "of 4,484 names
carrying both rates ... 52 (1.2%) have one side at <=2 while the other is >=6." So it is a
routine, real case for `eps_beat_rate` to be `null` (zero EPS-graded prints) while
`revenue_beat_rate` is populated and well-graded — and in exactly that case the chip rendered
bare `"N/M printed"`, completely dropping a real, available revenue beat rate.

This is the same defect *shape* as the bug #7508 fixed this session
(`meridian-beat-rate-display.ts`) — a shared/borrowed gate standing in for the availability of
a different, independently-sized measure — just in a different component the earlier audit
pass hadn't reached yet, and (per the `git log -p` history below) actually introduced by the
very PR that fixed the unrelated cohort-mismatch bug in this same string.

### Evidence

`git log -p -L 77,89:src/features/meridian/components/MeridianDesk.tsx` shows the function was
added whole-cloth by #2513 ("fix(meridian): a beat rate without its denominator is not a fact
about the company") with the `eps_beat_rate == null` gate present from the first commit — the
cohort-mismatch fix that PR shipped (denominator next to the right rate) is correct and
untouched here; the gate bug is a separate, pre-existing defect in the same function that
survived because nothing exercised the "EPS null, revenue populated" case.

RED → GREEN, proven with a manual stash-equivalent (new untracked file, so `git stash` could
not target it by pathspec — reverted the fix line-for-line, ran the test, restored it):

- **RED** (gate reverted to `eps_beat_rate == null`): 2/5 tests fail —
  `"EPS has no gradeable prints"` case returns `"12/40 printed"` instead of
  `"12/40 printed · rev beat 62% of 96 prints"`, and the "absent revenue_graded" case fails the
  same way.
- **GREEN** (fix restored): 5/5 pass.

Extracted the pure function from `MeridianDesk.tsx` (a `"use client"` component with no render
harness in this repo) to a new sibling lib file,
`src/features/meridian/lib/meridian-week-analytics-sub.ts`, per this repo's standing testing
convention, and imported it back into `MeridianDesk.tsx` in place of the local definition.

### Blast radius

One call site only: `MeridianDesk.tsx`'s earnings-week universe stat card
(`data.earnings_week_analytics` → `weekAnalyticsSub`). No other component reads
`MeridianEarningsWeekAnalytics` or calls this function. The server-side aggregate
(`meridian-benzinga-analytics.ts` / `dualBeatRateFromPrints`) is correct and untouched — this
was purely a display-gate bug on the client.

### Fix rationale

Changed the gate from `a.eps_beat_rate == null` to `a.revenue_beat_rate == null &&
a.eps_beat_rate == null` for the "nothing to show" case, and kept the existing
`a.revenue_beat_rate == null` check (now correctly reachable even when EPS is populated) for
the honest `"rev beat —"` case. This preserves every other existing behavior byte-for-byte
(both-populated, EPS-populated/revenue-null) and fixes exactly the one case that was wrong
(EPS-null/revenue-populated) — verified against all four input combinations in the new test
file. An alternative of gating purely on `revenue_beat_rate` (dropping EPS from the check
entirely) was considered but rejected: it would also change the previously-shipped "neither
rate present" case output, which is explicitly out of scope for this fix.
