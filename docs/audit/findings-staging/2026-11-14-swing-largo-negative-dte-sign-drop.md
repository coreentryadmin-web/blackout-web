> **kind:** FINDING

# Ask Largo swing play-brief: negative (expired) DTE silently rendered with the sign dropped

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (correctness — misleading guidance, not a crash) |
| **Mandate** | Ask Largo × Night Hawk Swings standing ownership mandate |

## Root cause

`adapters.ts` (`terminalPlayFromHorizon`) stamps every `TerminalPlay.contract` string as
`` `${strike}${right} · ${dte}DTE` `` straight from the live `contract.dte` value, with no
clamping — so an OPEN position whose option has already expired (negative DTE) produces a
literal `"160P · -1DTE"` string.

Two narrative call sites parsed that string back out with the same regex:

```ts
const dteMatch = play.contract.match(/(\d+)DTE/);
```

`\d+` cannot match a leading `-`, but the regex still matches the `"1DTE"` substring *inside*
`"-1DTE"` — so `dteMatch[1]` comes back `"1"`, not `"-1"`, and the sign is silently dropped.
For a genuinely-expired contract this doesn't just lose precision, it **inverts the claim**:
`manageLifecycleCoaching` (`play-brief-narrative-coaching.ts`) rendered
`"**1 DTE** — theta accelerating; don't over-hold"` — telling the member they still have a day
left to manage a position that actually expired *yesterday*.

## Evidence (live repro)

Hit `GET /api/market/swing/play-brief?playId=SWING%3APLTR%3A74&ticker=PLTR&positionId=74&status=COMMIT&strike=160&right=P`
against production as part of the standing Ask Largo deep-dive (authenticated, one temp Clerk
session). The live `horizons?view=swings` board shows **all three currently-committed SWING
positions** (PLTR/74, GOOG/73, MRVL/70) with `contract.dte: -1` — their shared `2026-11-13`
expiry has already passed as of this read (`2026-11-14`), consistent with the already-documented
Polygon/Massive `/v3/snapshot` entitlement outage freezing marks/exit-management since
2026-11-06 (see `CLAUDE.md`'s "Environment realities" section — same root incident, different
symptom).

The live PLTR brief's "Trade manager read" section rendered:

```
Manage plan — ... session exit 16:00 ET · 50% runner after trims · 1 DTE — theta
accelerating; don't over-hold.
```

`play.contract` for this play is `"160P · -1DTE"` — confirmed by independently recomputing
`-1 DTE` from the live `contract.expiry` ("2026-11-13") vs today's date ("2026-11-14").

## Fix

Both call sites now capture an optional leading sign (`/(-?\d+)DTE/`) and branch on the true
(signed) `dte`:

- `play-brief-narrative-coaching.ts`'s `manageLifecycleCoaching`: `dte < 0` now renders
  `"**expired** (N DTE) — confirm settlement/close, don't manage as if still live"` instead of
  the misleading positive-DTE "theta accelerating" framing. `dte === 0` (expires today, not yet
  past expiry) is deliberately left in the existing `dte <= 7` "theta accelerating" branch — it
  has NOT expired yet.
- `play-brief-intel.ts`'s `holdPlanSection` ("Contract runway" line) — same root-cause regex,
  same fix. This section is unconditionally collapsed whenever the narrative line above renders
  (`NARRATIVE_COVERED_TITLES`'s "Hold plan" entry, `play-brief-intel-collapse.ts`), so it's a
  narrower blast radius (only reachable when `hasNarrative` is false) but carries the identical
  bug when it does fire.

### Deliberately left unchanged

- `adapters.ts`'s own `${dte}DTE` stamp — the raw signed value is correct and useful (it's the
  thing both narrative layers failed to parse back correctly); reformatting it there would just
  move the problem, not fix it.
- The underlying cause of the position having a past expiry at all (the Polygon/Massive
  real-time entitlement outage freezing exit-management marks) — not fixable from code, already
  tracked separately in `CLAUDE.md` and `docs/audit/MARKET-OPEN-VALIDATION.md`.

## Evidence (RED → GREEN)

`git stash` isolating the two source-file fixes, running
`npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-narrative-coaching.test.ts src/lib/swing/play-brief-intel.test.ts`:

- RED (pre-fix, new tests only): `# tests 584, pass 582, fail 2`
- GREEN (post-fix): `# tests 584, pass 584, fail 0`

Full `npm test` and `npx tsc --noEmit` run clean on Node 20 (see PR for exact counts).

## Files

- `src/lib/swing/play-brief-narrative-coaching.ts` — fix + comment
- `src/lib/swing/play-brief-narrative-coaching.test.ts` — 2 new regression tests
- `src/lib/swing/play-brief-intel.ts` — sibling fix + comment
- `src/lib/swing/play-brief-intel.test.ts` — 1 new regression test
- `docs/audit/findings-staging/2026-11-14-swing-largo-negative-dte-sign-drop.md` — this file
- `docs/audit/MARKET-OPEN-VALIDATION.md` — next-session live validation checklist entry
