# 2026-10-31 FlowAnomalyBanner: a stale "Dismiss" click suppresses every future, unrelated anomaly for the rest of the session

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 product-correctness (member-facing alert suppression) |

## Root cause

`src/components/FlowAnomalyBanner.tsx` renders Helix's real-time flow-anomaly alert strip. It
polls `GET /api/market/anomalies` every 20s and on window focus, filters to anomalies within a
15-minute recency window (`isFlowAnomalyRecent`), and shows them in a `role="alert"` banner.

The dismiss state was a single module-level boolean:

```tsx
const [dismissed, setDismissed] = useState(false);
...
if (dismissed || anomalies.length === 0) return null;
...
onClick={() => setDismissed(true)}
```

Clicking "Dismiss" set `dismissed` to `true` **permanently for the component's lifetime** (i.e.
until the page is reloaded/unmounted) — not scoped to the specific anomalies that were on screen
at the moment of the click. Every subsequent poll tick still fetched and stored fresh anomalies
into `anomalies`, but the early-return at the top of the render made the whole banner invisible
regardless of what `anomalies` later contained.

Concretely: a member sees a single LOW-severity anomaly, dismisses it as noise. Anomalies are
real-time and short-lived (15-minute recency window) — in the very next poll(s) a completely
different, unrelated, possibly **CRITICAL** anomaly on another ticker can appear. The member never
saw it, never had a chance to act on it, and never dismissed it — yet it is silently hidden by a
dismissal of an unrelated, already-expired alert from minutes earlier. This directly defeats the
component's stated purpose (`role="alert" aria-live="polite"`, "Flow Anomalies Detected") for the
rest of the browsing session.

## Evidence

RED→GREEN proof via `git stash` on the source file alone (test file added first, so it fails to
even resolve the new export against the pre-fix source):

- **RED** (pre-fix `FlowAnomalyBanner.tsx` restored via `git stash`): all 3 new tests in
  `FlowAnomalyBanner.test.tsx` fail with `TypeError: visibleFlowAnomalies is not a function` — the
  pure filter didn't exist; the old component had no way to distinguish "still-dismissed" from
  "new since the dismissal" at all.
- **GREEN** (fix restored): all 3 tests pass, including the scenario above — a fresh,
  differently-id'd CRITICAL anomaly in a later poll is NOT suppressed by an earlier dismissal of a
  now-separate LOW anomaly.

```
$ npx tsx --experimental-test-module-mocks --test src/components/FlowAnomalyBanner.test.tsx
# pass 3
# fail 0
```

## Blast radius

- Single consumer: `src/features/helix/components/HelixPageShell.tsx` renders `<FlowAnomalyBanner
  />` with no props — unaffected by the internal state-shape change.
- No other file imports from `FlowAnomalyBanner.tsx` (`flow-anomaly-recency.ts` is a separate,
  already-correct helper it merely calls into — untouched).
- No test previously existed for this component; none depended on the old `dismissed` boolean
  internals.

## Fix rationale

Replaced the blanket `dismissed: boolean` with `dismissedIds: ReadonlySet<string>`, snapshotting
exactly the ids visible at the moment of the click (`setDismissedIds(new Set(anomalies.map((a) =>
a.id)))`). Rendering now filters through a new pure, exported helper:

```ts
export function visibleFlowAnomalies<T extends { id: string }>(
  anomalies: readonly T[],
  dismissedIds: ReadonlySet<string>,
): T[] {
  return anomalies.filter((a) => !dismissedIds.has(a.id));
}
```

This preserves the exact UX the dismiss button is for — hiding the anomalies the member has
already seen and acknowledged — while no longer suppressing anomalies the member has never seen.
An alternative (resetting `dismissed` back to `false` whenever `anomalies.length` changes) was
rejected: it would also un-hide a *re-dismissal-worthy* set the instant one previously-dismissed
anomaly ages out of the 15-minute recency window and a different, already-dismissed one is still
present — a per-id set is the only representation that gets both directions right at once.

Pulling the filter into a standalone exported function (rather than inlining the `.filter(...)`
call in the component body) follows the same pattern already used elsewhere in this component
tree (e.g. `AccountMembershipPanel.test.tsx`, `DarkPoolPanel.test.tsx`) for testing presentational
component logic without a DOM-rendering harness.

## Verification

- `npx tsx --experimental-test-module-mocks --test src/components/FlowAnomalyBanner.test.tsx` —
  3/3 pass (Node 20).
- `npx tsc --noEmit` — clean.
- `npx eslint src/components/FlowAnomalyBanner.tsx src/components/FlowAnomalyBanner.test.tsx` —
  clean.
