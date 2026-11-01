> **kind:** FINDING

## `LegacyManageGeometry`'s `zoneLabel` uses live-position command language ("cut the position" / "take profit") for WATCH/SKIP plays that have no open position — FIXED

**Status:** Fixed, regression tests added (`src/features/nighthawk/command-deck/legacy-play-geometry.test.ts`).

### Root cause

`LegacyManageGeometry` (`src/features/nighthawk/command-deck/legacy-play-geometry.tsx`) rendered
the "What to watch" progress-gauge caption (`zoneLabel`) from an inline ternary keyed only on
`play.progress`, with no reference to `play.status`:

```ts
const zoneLabel =
  play.progress != null && spot != null
    ? play.progress <= 0
      ? "below stop — cut the position"
      : play.progress >= 1
        ? "at/above target — take profit"
        : ...
    : null;
```

`play.progress` is computed **unconditionally for every status** by `overlayLegacyQuotes`
(`use-legacy-quotes.ts` lines 149-158 — no `status` check anywhere near the progress calculation,
unlike the `recommendation`/`recNote` override four lines later at line 182, which explicitly
gates on `p.status !== "CLOSED" && p.status !== "SKIP"`). The call site,
`LegacyPlayDetailPanel.tsx` line 157, renders `<LegacyManageGeometry play={play} />` with no
status gating either — it is inside the "What to watch" section that is shown for every status
(`DeckStatus = "OPEN" | "HOLD" | "TRIM" | "CLOSED" | "WATCH" | "SKIP"`).

So for a WATCH or SKIP play — a setup that was never entered, with no open position — if the
stock has already drifted past where a hypothetical entry's stop or target band would put it,
the detail panel told the member to **"cut the position"** or **"take profit"** on a position
that does not exist. This is the same conceptual leak as a sibling, already-fixed bug in this
component's recommendation override (which IS correctly gated), just in the progress-gauge
caption instead of the colored verdict badge.

### Evidence

- Read the current source directly (not a description) and confirmed the exact unconditional
  ternary at `legacy-play-geometry.tsx` lines 36-47 (pre-fix) with no `play.status` reference,
  and confirmed the call site has no status gating (`LegacyPlayDetailPanel.tsx` line 157, inside
  the always-rendered "What to watch" section started at line 153).
- Confirmed `overlayLegacyQuotes` (`use-legacy-quotes.ts`) computes `progress` with no status
  check (lines 149-158), while the sibling `recommendation`/`recNote` override four lines below
  it (line 182) explicitly excludes `CLOSED`/`SKIP` — i.e. the codebase already knows this
  distinction matters for the verdict badge, but the gauge caption was never given the same
  treatment.
- **RED (pre-fix):** extracted the ternary into a pure `legacyZoneLabel(progress, status)`
  function and added 7 unit tests in `legacy-play-geometry.test.ts`. Ran them against the
  unmodified source (temporarily restored via `git show origin/main:...`) — all 7 fail with
  `TypeError: legacyZoneLabel is not a function` (the function did not exist pre-fix, proving the
  tests actually exercise the new code path rather than passing vacuously).
- **GREEN (post-fix):** same 7 tests pass against the fixed source
  (`npx tsx --experimental-test-module-mocks --test
  src/features/nighthawk/command-deck/legacy-play-geometry.test.ts`), including explicit
  assertions that the WATCH/SKIP strings do **not** contain `"cut the position"` / `"take
  profit"`, and that OPEN/HOLD/TRIM/CLOSED keep the original live-position wording unchanged.
- Ran the full existing sibling suites after the fix (`legacy-play-geometry.test.ts` +
  `use-legacy-quotes.test.ts` + `adapters.test.ts`): 184/184 pass, no regressions.
- `npx tsc --noEmit` clean on the whole project after the fix.
- All tests run on Node 20 (`/opt/node20/bin`) with `--experimental-test-module-mocks`, per the
  repo's sandbox note (container default Node 22 is not evidence here).

### Blast radius

Single call site reached from two render paths: `PlayTerminal.tsx` line 793 and
`LegacyPlayDetailPanel.tsx` line 157 both render the same `LegacyManageGeometry` component, so
both pick up the fix automatically — no duplicated logic to chase down elsewhere. `overlayLegacyQuotes`
itself (the `progress` computation) is untouched; only the caption derived from it changes.

### Fix rationale

The audit's own recommendation was followed: extract a pure `legacyZoneLabel(progress, status)`
helper (status-aware only for the two extreme branches) with its own unit tests, following this
repo's established pattern of testing extracted pure logic rather than rendering the component
(e.g. `FlowAnomalyBanner.test.tsx`'s `visibleFlowAnomalies`). Only the `progress<=0` and
`progress>=1` branches change behavior for WATCH/SKIP — reworded to "already below stop — would
be invalidated" / "already at/above target before entry" — describing the setup's own standing
rather than issuing a trade instruction. The `progress` computation itself and the three
middle-zone labels ("near stop — elevated risk" / "mid-range — hold per plan" / "nearing target —
watch for exit") are left completely unchanged for every status, exactly as the audit
recommended: the progress/track gauge is legitimately useful context for a WATCH candidate too,
and only the two extreme labels' imperative phrasing was the issue.

### Deliberately left unchanged

- The `progress` computation in `overlayLegacyQuotes` — correct and useful for every status.
- The three middle-zone labels — they describe the gauge, not an action, so they are
  status-independent by design.
- `overlayLegacyQuotes`'s `recommendation`/`recNote` override — already correctly gated on
  `status !== "CLOSED" && status !== "SKIP"` (note: it excludes CLOSED/SKIP, not WATCH/SKIP;
  OPEN/HOLD/TRIM plays with a live position DO get the override, which is correct — this
  pre-existing gate was not touched by this fix).
