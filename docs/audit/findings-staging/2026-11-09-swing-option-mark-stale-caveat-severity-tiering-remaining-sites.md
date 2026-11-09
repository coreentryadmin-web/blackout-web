> **kind:** `FINDING`

## Largo's swing play-brief still had 4 call sites rendering the flat, un-tiered option-mark stale caveat after #7795's own severity-tiering fix — FIXED

| **Status** | FIXED |
|---|---|
| **Severity** | P3 (severity-calibration / self-contradiction gap, not a correctness/hidden-absence violation — honored under the Ask Largo × Night Hawk Swings standing ownership mandate) |
| **Surface** | `src/lib/swing/play-brief.ts` (Position section's own `Mark:` line), `src/lib/swing/play-brief-absence.ts` (`collectOptionMarkStalenessAbsence`, the structured C3 feeder behind `envelope.unavailableSources`/`evidence[]`), `src/lib/swing/play-brief-intel.ts` (`watchForSection`'s premium stop/target rail caveat, and `dataFreshnessSection`'s own "Option mark" line) |
| **Found by** | Ask Largo × Night Hawk Swings 5-engine live-monitor deep-dive, adversarially verified against production, live repro `GET /api/market/swing/play-brief?playId=SWING:LABD:2484&ticker=LABD&positionId=2484` (markAsOf 2026-11-06T16:20:49Z, read 2026-11-09 — ~77h / ~3.2 days stale) |

### Root cause

PR #7795 (commit `e2feb9642`, merged earlier the same day as this finding) added a second,
severity-aware tier to `optionMarkStaleCaveat()` — `optionMarkSeverelyStale()` /
`SWING_OPTION_MARK_SEVERELY_STALE_MS` (4 hours) — so a quote merely 19 minutes past its 18-minute
mild-stale bound and one 70+ hours past it no longer render the identical flat
`" _(stale — same quote Mark flagged above)_"` text. But that PR's own diff touched only
`play-brief-absence.ts`'s `optionMarkStaleCaveat()` itself and TWO call sites —
`pnlSection()`'s P&L/Peak/Trough/Greeks/Spread/Exec-P&L lines (`play-brief.ts`, via the shared
`staleCaveat`/`execTotalLossStaleCaveat` locals) and `tradeManagerNarrativeSection()`'s break-watch
bullet (`play-brief-narrative.ts`, via `execTotalLossStaleCaveat`) — leaving FOUR other direct
callers of the OLD, flat `optionMarkIsStale()` boolean untouched:

1. `play-brief.ts:753` — the Position section's own `Mark:` line, the exact line every OTHER
   caveat in the brief cites as "same quote Mark flagged above."
2. `play-brief-absence.ts` (`collectOptionMarkStalenessAbsence`) — feeds
   `envelope.unavailableSources`'s `"option mark"` chip and `evidence[]` via a flat
   `reason: "stale — last synced ${stamp}"`.
3. `play-brief-intel.ts` (`watchForSection`'s `railStaleCaveat`) — the "What to watch" premium
   stop/target rail cushion lines.
4. `play-brief-intel.ts` (`dataFreshnessSection`'s own "Option mark" line) — the section whose
   entire job is disclosing freshness, carrying the LEAST information of any of the six call
   sites: no severity, no elapsed-time age label at all.

Confirmed live (SWING:LABD:2484, ~77h-stale markAsOf): the SAME envelope rendered this exact
staleness fact as a bare `_(stale)_` on the Position section's `Mark:` line and the "What to
watch" rail line, a bare `"stale — last synced ..."` with no age on the Data-freshness line and in
`unavailableSources`, while the narrative-coaching section (which DOES go through the already-
tiered `optionMarkStaleCaveat`) called the identical fact "⚠️ severely stale ... UNCONFIRMED by
live data" a few lines later in the same document — a self-contradicting document where the same
underlying fact reads as mundane in some lines and an explicit alarm in sibling lines.

### Fix

Additive only, mirroring #7795's own discipline exactly — no mild-tier wording changed anywhere:

1. **`play-brief.ts` Mark line (site 1)**: deliberately NOT a plain swap to
   `optionMarkStaleCaveat(play, readMs, false, false)` — that variant's "its own quote, last
   synced ${stamp}" text would duplicate the date this line already renders a few characters to
   its left, and the default (`sameContractAsMarkAbove: true`) wording would make this line
   circularly claim its OWN quote is "flagged above" (nothing is above it — it IS "above" for
   every other line). Instead, a dedicated, short severity tag: the existing bare `_(stale)_` is
   untouched byte-for-byte for the mild tier, and a quote that also clears
   `optionMarkSeverelyStale()` escalates to `` _(severely stale — ~${severelyStaleAgeLabel(...)} ago)_ ``.
2. **`collectOptionMarkStalenessAbsence` (site 2)**: the `reason` string gains a severity branch,
   but the literal `"stale — last synced "` PREFIX is preserved byte-for-byte in BOTH branches
   (mild: unchanged; severe: `"stale — last synced ${stamp} (severely stale, ~${ageLabel} ago)"`)
   rather than reordered to lead with "severely stale" the way the narrative caveat does — because
   `dataHonestyCoaching()` (`play-brief-narrative-coaching.ts`) reads this exact string back via
   `reason.startsWith("stale — last synced ")` to extract the stamp for its own "option mark from
   **\<stamp\>**" bullet. Reordering the prefix would have silently routed every severely-stale
   mark into that function's generic, stamp-less `else` branch instead ("mark not synced to live
   tape"), a real regression in a THIRD file this fix's own blast radius would otherwise have
   caused. Verified the existing `dataHonestyCoaching` tests (which exercise a markAsOf aged by
   over 2 months relative to the real wall clock — i.e. ALSO now severely stale) still pass
   unmodified with this prefix-preserving shape.
3. **`watchForSection`'s `railStaleCaveat` (site 3)**: replaced the local re-derivation with a
   direct call through the shared, already-tiered `optionMarkStaleCaveat(play, readMs)` — an exact
   drop-in, since this site's own pre-existing wording ("...same quote Mark flagged above") is the
   function's own default output shape.
4. **`dataFreshnessSection`'s "Option mark" line (site 4)**: gains a severity branch using the
   shared `optionMarkSeverelyStale()` + `severelyStaleAgeLabel()` (now exported from
   `play-brief-absence.ts` specifically so this and site 1 can both name the identical elapsed-span
   text instead of each re-deriving the hour/day rounding rule independently) — e.g. `"Option mark
   **severely stale** — last synced **11:19 ET** (~77h ago)"`.

`severelyStaleAgeLabel()` was exported (previously module-private to `play-brief-absence.ts`) so
all three consuming files can share one age-formatting rule rather than risk three independent,
potentially-drifting re-derivations of the same hour/day rounding boundary.

### Evidence

New/extended tests: `play-brief-absence.test.ts` (4 new tests: `severelyStaleAgeLabel`'s own
hour/day boundary, `collectOptionMarkStalenessAbsence`'s mild-vs-severe reason text and the
preserved `"stale — last synced "` prefix), `play-brief-intel.test.ts` (one pre-existing fixture
adjusted — see below — plus the sibling `railStaleCaveat`/`dataFreshnessSection` paths are already
exercised by the full suite below), `play-brief.test.ts` (one pre-existing fixture adjusted — see
below).

Two PRE-EXISTING fixtures, written before #7795's severity tier existed, happened to sit just past
the NEW 4-hour severe bar (one at ~4.5h, one anchored 365 days in the future for an unrelated
`ctx.readMs`-vs-wall-clock test) and so legitimately started asserting "severely stale" text where
they previously asserted the bare mild-tier text — both adjusted to stay inside the mild-but-not-
severe window (their actual, narrower intent), not to paper over a real behavior change:
- `play-brief.test.ts`'s "Greeks and Spread both carry a 'stale' caveat..." test: markAsOf moved
  from a 4.5h gap to a 1h gap.
- `play-brief-intel.test.ts`'s "dataFreshnessSection: uses ctx.readMs as the staleness anchor..."
  test: its future-anchored `readMs` offset moved from 365 days to 1 hour (its actual intent is
  readMs-vs-real-clock, not severity tiering, which has its own dedicated coverage).

RED → GREEN (plain file-copy backup/restore of the three touched source files, isolating only the
source fix while every test file — new and pre-existing — stayed as written; Node 20, `npx tsx
--experimental-test-module-mocks --test`):
- RED (pre-fix sources restored from backup, post-fix tests in place): new/updated assertions for
  sites 1-4 fail against the old flat-boolean behavior (confirmed per-file below); zero unrelated
  pre-existing test regressed.
- GREEN (fix restored): `play-brief-absence.test.ts` 136/136, `play-brief.test.ts` 203/203,
  `play-brief-intel.test.ts` 370/370, `play-brief-narrative.test.ts` +
  `play-brief-narrative-coaching.test.ts` 381/381 combined, full `src/lib/swing/*.test.ts` directory
  2338/2338.

Full repo suite (`npm test`, Node 20) and `npx tsc --noEmit`: both clean (see PR for exact counts).

### Blast radius

Grepped the whole `src/lib/swing/` tree (and anything importing from it) for every remaining
direct caller of `optionMarkIsStale()`: the two call sites #7795 already migrated
(`pnlSection`/`tradeManagerNarrativeSection`, via `optionMarkStaleCaveat`), the four fixed here, and
exactly one more — `play-brief.ts`'s `briefEvidenceFromContext` (`genericFreshness === "stale" &&
!optionMarkIsStale(...) ? "recent" : genericFreshness`) — deliberately left unchanged: it computes
a 4-value `BieFreshness` enum (`"live"|"recent"|"stale"|"unknown"`) for the evidence/provenance
array, a false-positive GUARD (downgrading an on-schedule mark wrongly bucketed "stale" by the
generic cross-product freshness rule), not a narrative severity caveat — a different kind of fix
entirely, out of scope for this severity-tiering sweep.

`collectOptionMarkStalenessAbsence`'s one known downstream string-consumer, `dataHonestyCoaching()`
(`play-brief-narrative-coaching.ts`), was checked and found to still work correctly unmodified
(see Fix §2) — its own tests (`play-brief-narrative-coaching.test.ts`) pass unchanged.

### What was deliberately left unchanged

The mild (18-minute) tier's wording at every one of the six call sites (2 from #7795, 4 here) is
byte-for-byte identical to before this fix. `optionMarkIsStale()`/`optionMarkSeverelyStale()`
themselves are untouched — this is purely about getting every narrative/structured surface to
consume the tiering #7795 already built, not about the tiering logic itself.
