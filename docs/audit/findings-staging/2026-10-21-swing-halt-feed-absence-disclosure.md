## 2026-10-21 — [FINDING, swing] Live gate-blocking reason "Trading-halt feed unavailable" never surfaced by the swing envelope's own absence/freshness disclosure

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (Largo contract absence-principle violation — a real, gate-evaluated outage is invisible on the exact surfaces built to disclose outages) |
| **Surface** | `src/lib/swing/play-brief-absence.ts` — `collectBriefUnavailableSources()`; `src/lib/swing/play-brief-intel.ts` — `dataFreshnessSection()` |

### Root cause

`collectBriefUnavailableSources` (`play-brief-absence.ts`) is the single function that feeds both
`envelope.unavailableSources` (the array the UI's `UnavailableChip` renders) and `confidence.why`'s
source list. It independently checks HELIX flow, option mark, GEX positioning/matrix staleness,
lane-rank fetch failure, Vector desk state, Meridian peer cohort, Night Hawk Legacy, and
thesis-health availability — but never references halt/LULD data at all (a case-insensitive grep
for "halt" in the file returns nothing). G-S12 (`v2/halt-read.ts`'s `readSwingHaltStateForTickers`)
is a real, live-computed system state evaluated at discovery/commit time; `entry-verdict.ts` turns
a stale halt feed into the gate-block reason "Trading-halt feed unavailable — desk will not open
until halt/LULD data recovers." `dataFreshnessSection` (`play-brief-intel.ts`) — the section
literally titled "Data freshness" — has the identical blind spot: it only checks option-mark
staleness, swing-scan staleness, Vector/GEX age, and HELIX flow.

### Evidence

Live TSLA WATCH envelope's "Trade manager read" section states, as one of the (moot, but real and
gate-evaluated) blocking reasons: "**g_s12_halt_feed_stale**: Trading-halt feed unavailable — desk
will not open until halt/LULD data recovers." The SAME envelope's `confidence.why` read "6 sources
unavailable this cycle (HELIX flow, Vector heatmap, Vector dark pool, Meridian peer cohort, swing
discovery scan, Night Hawk Legacy) — see below" — halt feed is not among the 6, and the enumerated
`unavailableSources` array likewise has no halt/LULD entry. The "Data freshness" section ("Swing
scan: ..." / "HELIX flow: pipeline stale ...") also said nothing about it. A reader relying on the
brief's dedicated, purpose-built staleness disclosure — the exact surface the Largo product
contract's absence principle exists to guarantee — had no way to learn the halt feed is currently
unavailable, even though every other upstream dependency this brief uses is already wired into it.

Added 3 tests to `play-brief-absence.test.ts` (surfaces when `g_s12_halt_feed_stale` is present;
does NOT surface for a genuine halt `g_s12_halted` — a real market-state fact, not a missing read;
does not fabricate the source when no halt gate is present) and 2 to `play-brief-intel.test.ts`
(disclosed / not fabricated). RED→GREEN, git-stash-verified on both source files together: 403/405
(2 fail) before the fix, 405/405 after. Broader regression sweep: `play-brief.test.ts` +
`entry-verdict.test.ts` + `entry-enterability.test.ts` — 620/620 total. `tsc --noEmit` clean.

### Blast radius

Two call sites, both named in the root cause. Halt-feed staleness is structurally a WATCH-only
signal (the gate is only ever evaluated pre-commit by `v2/gates.ts`/discovery.ts), so both checks
are naturally no-ops for OPEN/HOLD/TRIM/CLOSED buckets — consistent with the `!isNotLive` gating
every other live-desk-state check in `collectBriefUnavailableSources` already uses.

### Fix

Both functions now check `play.gateBlocks?.some((g) => g.code === "g_s12_halt_feed_stale")` (the
exact code `entry-verdict.ts` already stamps) and, when present, add a "Trading-halt feed"
unavailable-source entry / "Data freshness" line respectively. Deliberately scoped to the
feed-staleness code only — a genuine halt (`g_s12_halted`) is a real market-state fact, not a
missing read, so it does not belong in an "unavailable sources" disclosure built for data gaps.

### Why not a bigger fix

Did not add a general halt-state display elsewhere in the brief (e.g. a dedicated "Trading halted"
callout) — out of scope; this finding is specifically about the absence/freshness disclosure
surfaces already built for exactly this kind of gap, matching every other source already wired in.
