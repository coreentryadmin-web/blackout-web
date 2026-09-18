# Swing play-brief: canonical "brief facts" precompute layer — DESIGN (not yet implemented)

> **kind:** `DESIGN` — this document proposes an architecture. **No `play-brief*.ts` source file
> has been changed to produce it.** A future implementation pass should start here rather than
> re-cataloging the duplication from scratch — the catalog below was built by reading all four
> `play-brief*.ts` files in full plus every `docs/audit/findings-staging/*.md` entry from
> 2026-09-07 through 2026-09-09 whose title mentions "swing" or "play-brief".

## 1. Problem statement

`src/lib/swing/play-brief.ts`, `play-brief-intel.ts`, `play-brief-narrative.ts`, and
`play-brief-narrative-coaching.ts` together compose one `BieAnswerEnvelope` per swing play. They
do this as **four independent files, each free to recompute any derived fact it needs from the raw
context (`SwingPlayBriefContext`) and the raw `VectorFullState`/`GexPositioning` objects inside
it**. There is no shared "here is today's GEX king strike" / "here is whether Vector disagrees
with this swing's direction" layer — every section-builder function reaches into `ctx.vector` /
`ctx.ecosystem.gex_positioning` and re-derives the fact itself.

The result, visible in the 2026-09-07…09 findings-staging record alone:

- The same fact (GEX king strike) was computed **three different ways in three files** and two of
  them disagreed in production for a real ticker on a real date (`2026-09-09-swing-brief-gex-king-narrative-precedence.md`).
- The same formatting bug (a signed-delta `"+"` glued onto an absolute, never-negative premium
  price) was written **three separate times** in three files and had to be found and fixed
  **three separate times** the same day (`#4645` → `2026-09-09-swing-narrative-premium-sign-additional-instances.md`).
- The same narrative fact (Vector disagrees with this swing's direction) was independently
  re-derived by **three different functions** and, because there is no shared "has this already
  been said" answer, had to be patched with a boolean manually threaded through three call sites
  (`2026-09-09-swing-narrative-vector-conflict-triple-restated.md`) — a fix that only works for as
  long as every future editor remembers to thread the flag too.
- A level narrated prominently in prose (the gamma magnet) was **silently absent** from the
  structured `envelope.levels` array for weeks because the two consumers of `vec.magnet` never
  shared a "does this level belong in the structured output" decision
  (`2026-09-09-swing-play-brief-gamma-magnet-missing-from-structured-levels.md`).

Every one of these was found and fixed *after* it reached production, one incident at a time, by
the standing Ask Largo audit mandate. That pattern is not sustainable — it means every future
derived fact this code needs is a new opportunity for the same class of bug, and every fix is
reactive rather than structural. This document proposes a **canonical precompute layer**: one
function per derived fact, called by every consumer instead of each consumer reimplementing it.

An earlier review of this idea correctly flagged it as "the least concrete next step" in the
backlog — a real, multi-file refactor that should not be attempted blind. This document is the
concrete decision that review asked for: the exact interface, the exact migration path, the exact
first slice, and the exact places a rushed implementation would introduce new bugs.

## 2. Catalog: every derived fact computed in more than one place

Read all four files end-to-end (`play-brief.ts` 561 lines, `play-brief-intel.ts` 905 lines,
`play-brief-narrative.ts` 711 lines, `play-brief-narrative-coaching.ts` 791 lines, as of
2026-09-10) plus every 2026-09-07…09 findings-staging entry matching "swing"/"play-brief". Grouped
by fact family, most-duplicated first.

### 2A. GEX/Vector level precedence (`vecX ?? gex.x`, staleness-gated) — the dominant family

Every one of these levels follows the identical shape: prefer a live Vector reading, fall back to
the GEX matrix, but only if the GEX matrix isn't itself stale (and never resurface a value that
came from a stale source with no live alternative). That precedence rule is **re-derived from
scratch at every call site** rather than living in one function.

| Level | Independent call sites (file → function) | Count | Documented bug? |
|---|---|---|---|
| **Spot** | `play-brief.ts:levelsFromContext` · `play-brief-intel.ts:chartLevelsSection` · `play-brief-intel.ts:watchForSection` · `play-brief-narrative.ts:tradeManagerNarrativeSection` · `play-brief-narrative.ts:resolveBreakInvalidation` | 5 | not yet, but see §4 risk |
| **Call wall** | `play-brief.ts:levelsFromContext` · `play-brief-intel.ts:chartLevelsSection` · `play-brief-intel.ts:watchForSection` · `play-brief-narrative.ts:collectFocalLevels` · `play-brief-narrative.ts:counterThesisLine` | 5 | not yet |
| **Put wall** | same 5 sites as call wall | 5 | not yet |
| **Gamma flip** | `play-brief.ts:levelsFromContext` · `play-brief-intel.ts:chartLevelsSection` · `play-brief-intel.ts:watchForSection` · `play-brief-narrative.ts:collectFocalLevels` · `play-brief-narrative.ts:dealerPostureLine` · `play-brief-narrative.ts:resolveBreakInvalidation`/`tradeManagerNarrativeSection`'s own flip re-derivation | 6 | not yet |
| **GEX king strike** | `play-brief.ts:levelsFromContext` · `play-brief-narrative.ts:collectFocalLevels` · `play-brief-intel.ts:chartLevelsSection` | 3 | **YES** — production divergence, `2026-09-09-swing-brief-gex-king-narrative-precedence.md` (330.00 vs 320 for the same ticker/instant) |
| **Max pain** | `play-brief.ts:levelsFromContext` · `play-brief-intel.ts:chartLevelsSection` · `play-brief-narrative.ts:collectFocalLevels` | 3 | not yet |
| **Gamma magnet** | `play-brief-narrative.ts:collectFocalLevels`/`narrateMagnet` · `play-brief-narrative-coaching.ts:magnetCoaching` · `play-brief.ts:levelsFromContext` (added reactively) | 3 | **YES** — was narrated in prose but absent from structured `levels`, `2026-09-09-swing-play-brief-gamma-magnet-missing-from-structured-levels.md` |
| **Dark pool levels** | `play-brief.ts:levelsFromContext` · `play-brief-intel.ts:chartLevelsSection` · `play-brief-narrative.ts:collectFocalLevels` | 3 | not yet |
| **Confluence zones** | `play-brief.ts:levelsFromContext` · `play-brief-intel.ts:chartLevelsSection`/`formatConfluenceZone` · `play-brief-narrative-coaching.ts:confluenceCoaching` | 3 | not yet |

**Gamma posture** (dealer long/short gamma) is a partial success story worth citing as precedent:
a shared helper (`resolveGammaPosture`, `play-brief-absence.ts`) already exists and is correctly
used by `play-brief-narrative.ts:dealerPostureLine` and `play-brief-narrative-coaching.ts:magnetCoaching`.
But **two more call sites never adopted it**: `play-brief.ts:evidenceFromContext` independently
re-derives `postureFromVec`/`postureFromGex` precedence inline (needs the shared function to also
expose `net_gex` and nearest-wall distance, which `resolveGammaPosture` today does not return), and
`play-brief-intel.ts:gexPostureSection` reads `gex.gamma_posture` **directly, with no Vector
blending at all** — which may be intentional (a "raw GEX matrix only" view) rather than a bug; see
§4. This is the single clearest proof in this codebase that **a canonical function existing is not
sufficient — call sites must be migrated to it, and nothing currently enforces that migration.**

### 2B. Absolute premium price formatting — the named example, already a 3-for-3 recurring bug

Three near-identical private formatters, one per file, each formatting a per-contract option
premium (entry/mark/stop/target — always ≥ 0, never a signed delta):

- `play-brief.ts:fmtUsd`
- `play-brief-narrative.ts:fmtOptionUsd`
- `play-brief-narrative-coaching.ts:fmtUsd`

All three carried the identical bug (`n >= 0 ? "+" : ""` — a signed-delta sign glued onto an
absolute price, so a **stop-loss trigger price read as a gain**). `play-brief.ts`'s copy was fixed
first (`#4645`); the other two were found "copy-pasted" the same day
(`2026-09-09-swing-narrative-premium-sign-additional-instances.md`). Each fix comment now
explicitly cross-references the other two files by name — the comments are doing, by hand, exactly
what one shared function would do structurally.

### 2C. Signed percentage formatter (`fmtPct`) — same shape, not yet a documented bug

`fmtPct(n, digits = 1)` (sign-prefixed percentage) is defined **separately in all four files**,
byte-for-byte identical logic each time:
`play-brief.ts:fmtPct` · `play-brief-intel.ts:fmtPct` · `play-brief-narrative.ts:fmtPct` ·
`play-brief-narrative-coaching.ts:fmtPct`. No production bug found in this window, but it is the
exact same shape as 2B (a tiny pure formatter, copy-pasted instead of shared) — worth centralizing
proactively rather than waiting for its own incident.

**Contrast — `fmtPremium` (aggregate $ formatting, k/M/B scaling) is the example of this pattern
already fixed correctly**: it lives once in `@/lib/fmt-money` and every file imports it (aliased
`fmtFlowUsd` in two of them). It was NOT always this way —
`2026-09-07-largo-helix-flow-premium-format.md` documents the exact same class of bug (one HELIX
number rendered two different ways in one brief) being fixed by routing everyone through the one
shared helper. **This is the existence proof that the proposed pattern works when applied — 2B/2C
are the same fix, just not yet done.**

### 2D. Trim ladder + rails rendering

`ep.trim_levels.map(t => `+${t.trigger_pct}%${t.fired ? " ✓" : ""}`).join(" · ")` appears
**byte-for-byte identical** in `play-brief.ts:managementSection` and
`play-brief-narrative.ts:railsFallback`. A third, differently-shaped view of the same
`exitPolicy.trim_levels` array (fired-count "X/Y trims banked" instead of the full ladder) lives in
`play-brief-narrative-coaching.ts:manageLifecycleCoaching`. The stop/target rail pair
(`stop_premium`/`target_premium`) is independently rendered in **three** places:
`managementSection`, `railsFallback`, and `play-brief-narrative-coaching.ts:progressRatchetCoaching`.
This is the fact family 2B's bug actually lived in — the sign bug was found three times because
this exact ladder/rails content is composed three times.

### 2E. Vector `starred[0]` duplicate-headline — the named example

`VectorPlayEmit.starred` is documented (`vector-play-engine.ts`) to always carry the play headline
as element `[0]`. Two swing call sites independently discovered — and independently had to fix —
the same "don't repeat element 0" rule the same day:
`play-brief-narrative-coaching.ts:vectorPlayCoaching` (`vp.starred?.slice(1)`) and
`play-brief-intel.ts:vectorDeskSection` (`p.starred.slice(1, 5)`), each with its own near-identical
doc comment citing the same live repro
(`2026-09-09-swing-play-brief-vector-starred-headline-duplicated-as-watch-now.md`). A third,
correct consumer of the same convention already existed elsewhere in the codebase
(`src/lib/bie/vector-desk-brief.ts`) that neither swing call site referenced before failing the
same way.

### 2F. Cross-desk / Vector-conflict restatement — the named example

Three independent functions each re-derive "does Vector's `play.bias` disagree with this swing's
`direction`" from the identical `vec.play`/`play.direction` inputs:

- `play-brief-narrative-coaching.ts:crossDeskCoaching` — fires a **Cross-desk friction** bullet.
- `play-brief-narrative-coaching.ts:vectorPlayCoaching` — independently re-derives the same
  `aligned` boolean and appends a "cross-check" clause quoting the same headline.
- `play-brief-narrative.ts:counterThesisLine` — independently re-derives the same misalignment a
  third time and pushes it into the counter-thesis reason list.

All three fired for the same live NRG position on the same day, restating the identical fact three
times in one document (`2026-09-09-swing-narrative-vector-conflict-triple-restated.md`). The fix
that shipped is a boolean (`vectorConflictAlreadyNoted`/`conflictAlreadyNoted`) hand-threaded
through the call order — it works only because `collectCoachingBullets`/`tradeManagerNarrativeSection`
happen to call the three functions in a fixed order and someone remembered to check the
already-built bullet list before calling the next one. **A fourth restatement site added later
would silently reintroduce this exact bug** unless its author also remembers to thread a fourth
flag — this is a fragile, non-scaling patch for what is really a missing single source of truth.

### 2G. Round-trip / MFE-capture-outcome restatement

`play-brief-intel.ts:lessonsSection` and `play-brief-narrative-coaching.ts:closedCoaching` both
independently call the same shared `mfeCaptureOutcome()` helper (`mfe-capture.ts`) on the same
`play.peak`/`play.exitPnlPct` inputs and, when the outcome is `round_trip`, both render a
"**Round-tripped past breakeven**" sentence quoting the identical percentages
(`2026-09-09-swing-lessons-roundtrip-restated.md` — explicitly filed as "same threading pattern as
PR #4650", i.e. the same shape as 2F, fixed the same way: a hand-threaded
`roundTripAlreadyNoted` boolean).

### 2H. Data staleness / freshness warnings

`play-brief-intel.ts:dataFreshnessSection` and `play-brief-narrative-coaching.ts:dataHonestyCoaching`
independently derive nearly the same warning set — option-mark staleness
(`collectOptionMarkStalenessAbsence`), Vector data age (`vec.dataAgeMs`), GEX matrix age
(`gexMatrixAgeMs`/`gexMatrixStale`), HELIX pipeline freshness (`flow_feed_fresh`), and swing-scan
staleness (`scanSessionDay` vs `sessionDate`) — from the identical primitives, formatted two
different ways (a structured bullet section vs. one coaching sentence). No cross-desk-style
production incident yet, but this family of primitive (freshness/staleness) is the single most
bug-prone category in the whole findings-staging record this quarter (`#4452`, `#4454`, `#4471`,
every "C2"-tagged finding) — duplicating its *consumption*, even off already-centralized
primitives, is exactly the kind of surface that produces the next one.

### 2I. Earnings/catalyst "day countdown" phrase (today / tomorrow / in N days)

Independently implemented at least **three** times: `play-brief-intel.ts:catalystsSection`
(earnings), `play-brief-intel.ts:formatMeridianItem` (Meridian calendar items), and
`play-brief-narrative-coaching.ts:catalystCoaching` (both an earnings version and a separate
Meridian version inline — arguably 4 implementations). `catalystsSection`'s earnings version has a
4th branch (`days_until == null → ""`) the other three lack — a real behavioral difference between
"identical-looking" implementations that a naive merge could silently drop (see §4).

### 2J. Thesis "worst fading pillar" selection

`play-brief-narrative-coaching.ts:thesisPillarCoaching` selects the worst fading pillar via
`.filter(status is lost/faded).sort(by deltaPts ascending)[0]`. `play-brief-narrative.ts:counterThesisLine`
selects via a plain unsorted `.find(status is lost/faded)` on the same `play.thesisHealth.pillars`
array. **These can name a different pillar** when more than one has faded — same predicate, two
different selection rules, never reconciled because neither function is aware the other exists.

### 2K. Exec-vs-mid P&L slippage gap

`play-brief-narrative-coaching.ts:execSlippageCoaching` (open/watch plays) and
`play-brief-intel.ts:lessonsSection`'s own inline check (closed plays) both independently compute
`Math.abs(execPnlPct - exitOrPnlPct) > 5` from the same two fields and render near-identical
"slippage" language — same threshold, same derivation, two call sites.

### 2L. Wall-event ("bead") dynamics — three different windows on the same array

Three independent readers of `vec.wallEvents`, each with its own slice: `play-brief-intel.ts:wallDynamicsSection`
(top 5), `play-brief-narrative-coaching.ts:wallDynamicsCoaching` (last 2), and
`play-brief-narrative.ts:tradeManagerNarrativeSection`'s own inline "Wall just moved" bullet (last
1). **Unlike the other families above, these are not meant to render identically** — they are
different display needs on the same underlying array. Flagged separately from the others because
the correct fix is parameterizing one reader by `limit`, not collapsing to one fixed view (see §5).

### Already-centralized, working examples (cite as precedent, do not touch)

- `thesisHealthUncalibrated()` (`thesis-health.ts`) — one predicate, used identically by all four
  files, zero incidents.
- `fmtPremium()` (`@/lib/fmt-money`) — see 2C above; the actual before/after proof this pattern
  works.
- `vectorSnapshotStale()` / `gexMatrixStale()` / `gexMatrixAgeMs()` (`play-brief-absence.ts`) — the
  staleness *primitives* are already centralized and consistently reused. **The duplication
  documented in this file lives one layer above these** — in the precedence/selection/formatting
  logic each call site builds on top of the (correctly shared) staleness booleans, not in the
  staleness checks themselves. The proposed design in §3 builds on top of this file; it does not
  replace it.
- `breakTrigger()` (`play-brief-narrative.ts`) — the actual invalidation-decision function is
  already shared between `resolveBreakInvalidation` and `tradeManagerNarrativeSection`. What is
  *not* shared is the assembly of its own inputs (`spot`/`flip`/`focal`) — see the risk note in §4.

## 3. Proposed interface

### 3.1 Where it lives

One new file: **`src/lib/swing/play-brief-facts.ts`**. It sits directly on top of
`play-brief-absence.ts` (imports its staleness primitives; does not duplicate or replace them) and
below `play-brief.ts`/`play-brief-intel.ts`/`play-brief-narrative.ts`/`play-brief-narrative-coaching.ts`,
which become its consumers. No new directory — this repo's convention for the swing play-brief
subsystem is flat files under `src/lib/swing/`, matching `play-brief-absence.ts`,
`play-brief-technicals.ts`, `play-brief-lane-rank.ts`, etc.

### 3.2 Shape: one pure function per derived fact, not one giant "compute everything" call

Each fact gets its own small, independently testable, independently importable function — **not**
a single `buildAllFacts(ctx)` object that every consumer must adopt in one PR. This is the
deliberate choice that makes the migration incremental (§5): a call site can start calling
`resolveGexLevelFact(ctx, readMs, "gex_king")` today without any other call site changing, and
without any signature change to the section-builder functions that surround it (they already
receive `ctx` and can call a new pure function with it).

```ts
// src/lib/swing/play-brief-facts.ts

import type { SwingPlayBriefContext } from "./play-brief-types";
import { vectorSnapshotStale, gexMatrixStale } from "./play-brief-absence";
import type { BieFreshness } from "@/lib/bie/answer-envelope";

/**
 * A single GEX/Vector-preferred price level, with its provenance and staleness already resolved.
 * `status` distinguishes "no reading at all" from "a reading exists but is suppressed because its
 * only source is stale" — callers that need the Largo contract's absence principle (report WHY a
 * fact is missing, not just that it is) read `status`; callers that just want a number or null do
 * `fact.status === "live" ? fact.price : null`.
 */
export type LevelFact =
  | { status: "live"; price: number; source: "vector" | "gex"; asOf: string | null; freshness: BieFreshness }
  | { status: "stale_suppressed"; price: number; source: "vector" | "gex"; ageMs: number | null }
  | { status: "absent" };

export type GexLevelKind =
  | "call_wall"
  | "put_wall"
  | "gamma_flip"
  | "gex_king"
  | "max_pain"
  | "gamma_magnet";

/**
 * THE canonical precedence rule for every "prefer live Vector, else non-stale GEX matrix, never a
 * stale-only reading" level. One function, one `kind` per level, instead of one from-scratch
 * copy of this rule per level per file (§2A). Behavior is DEFINED to match `levelsFromContext`'s
 * and `collectFocalLevels`'s CURRENT (post-2026-09-09-fix) precedence for every kind — see the
 * equivalence-test requirement in §6, not a fresh derivation.
 */
export function resolveGexLevelFact(
  ctx: SwingPlayBriefContext,
  readMs: number,
  kind: GexLevelKind,
): LevelFact { /* ... */ }

/** Vector-preferred spot, same precedence family as resolveGexLevelFact. */
export function resolveSpotFact(ctx: SwingPlayBriefContext, readMs: number): LevelFact { /* ... */ }

/** Dark pool levels and confluence zones — arrays, same staleness gate, distance-from-spot attached. */
export function resolveDarkPoolLevels(ctx: SwingPlayBriefContext, readMs: number, spot: number | null): LevelFact[] { /* ... */ }
export function resolveConfluenceZones(ctx: SwingPlayBriefContext, readMs: number, spot: number | null) { /* ... */ }

/**
 * Every focal level sorted by |distance from spot| — replaces play-brief-narrative.ts's own
 * collectFocalLevels, reusable by anything that wants the same distance-sorted list (today only
 * play-brief-narrative.ts needs it; play-brief.ts's structured `levels` array and
 * play-brief-intel.ts's chartLevelsSection want the individual named facts, not the sorted list).
 */
export function resolveFocalLevels(ctx: SwingPlayBriefContext, readMs: number, spot: number) { /* ... */ }

/**
 * Superset of play-brief-absence.ts's resolveGammaPosture — same precedence, but also returns the
 * net_gex/nearest-wall fields play-brief.ts:evidenceFromContext needs, so that call site can adopt
 * this instead of its own inline postureFromVec/postureFromGex re-derivation. Does NOT change what
 * play-brief-intel.ts:gexPostureSection does — see the explicit open question in §4 about whether
 * that section's GEX-only read is a bug or a deliberate "raw matrix" view.
 */
export function resolveGammaPostureFact(ctx: SwingPlayBriefContext, readMs: number) { /* ... */ }

/** vec.wallEvents reader, parameterized by how many events the caller wants — see §2L. */
export function resolveWallEvents(vec: /* VectorFullState */ unknown, limit: number) { /* ... */ }

/** Single "worst fading pillar" rule — sorted by deltaPts, matching thesisPillarCoaching today. */
export function resolveWorstFadingPillar(thesisHealth: /* TerminalPlay["thesisHealth"] */ unknown) { /* ... */ }

/** "today" / "tomorrow" / "in Nd" / "" — the countdown phrase from §2I, including the null-days branch. */
export function resolveCountdownPhrase(daysUntil: number | null): string { /* ... */ }

/** Absolute per-contract premium PRICE — never signed. Replaces the 3 fmtUsd-alikes from §2B. */
export function fmtAbsolutePremium(n: number | null | undefined): string { /* ... */ }

/** Signed percentage — replaces the 4 fmtPct-alikes from §2C. */
export function fmtSignedPct(n: number | null | undefined, digits?: number): string { /* ... */ }
```

`resolveVectorConflict` (the §2F fact) and `resolveMfeOutcomeFact` (the §2G fact) are deliberately
**not** in the phase-1 function list above — see §5's "smallest first slice" for why they are a
second-phase item, and §3.3 for the mechanism they need that plain extract-a-function does not.

### 3.3 The "already stated elsewhere" problem (2F/2G) needs a different mechanism than 3.2

2F and 2G are not simple "same number, computed twice" bugs — they are "same **narrative
sentence**, independently composed twice," and the current fix (hand-threaded booleans) is a
workaround for the fact that there is no shared place to ask "has this fact already been narrated
in this compose pass?" A structural fix generalizes that question instead of adding a fifth
one-off boolean the next time this happens:

```ts
/** One resolved fact plus a stable identity key other renderers can check before restating it. */
export type ClaimableFact<T> = { key: string; value: T };

export function resolveVectorConflict(ctx: SwingPlayBriefContext): ClaimableFact<{
  conflicting: boolean;
  direction: "long" | "short" | null;
  headline: string | null;
}> { /* key: "vector_conflict" */ }

export function resolveMfeOutcomeFact(play: /* TerminalPlay */ unknown): ClaimableFact<
  ReturnType<typeof import("./mfe-capture").mfeCaptureOutcome>
> | null { /* key: "mfe_round_trip" */ }
```

A small `claimed: Set<string>` threaded alongside the existing `bullets`/`seen` state already
inside `tradeManagerNarrativeSection` (and passed into `collectCoachingBullets`,
`buildIntelSections`'s call to `lessonsSection`) replaces the current per-fact boolean-threading —
any renderer calls `claimed.has(fact.key)` before restating, and `claimed.add(fact.key)` after
rendering it. This is genuinely a **signature change** to several exported functions (they need to
accept and pass through a `claimed` set), unlike 3.2's functions, which is why §5 treats it as a
second-phase item, not part of the first slice.

## 4. Migration risk — specific call sites a rushed implementation would get wrong

- **GEX king strike, and every other 2A level.** The three current call sites do **not** all agree
  today (that was the live bug). A migration must define the canonical resolver's behavior as
  "whatever `levelsFromContext`/`collectFocalLevels` already do" — the two call sites an actual
  fix already confirmed correct — and must **not** re-derive "the right precedence" from first
  principles, or it risks copying `chartLevelsSection`'s now-fixed-but-recently-wrong GEX-only rule
  back in. Require an equivalence test (§6) asserting the new resolver matches the two
  already-correct call sites' current output, for every one of the 7 level kinds, before switching
  any of them over.

- **`gexPostureSection` (play-brief-intel.ts).** This is the one gamma-posture call site that
  reads `gex.gamma_posture` directly with **no** Vector blending — unlike `dealerPostureLine` and
  `magnetCoaching`, which both go through `resolveGammaPosture`. Before migrating this call site to
  `resolveGammaPostureFact`, determine whether the GEX-only read is a bug (it silently disagrees
  with the rest of the brief whenever Vector's `regime.posture` differs from the GEX matrix's
  `gamma_posture`) or a deliberate "raw matrix view" the section's own title ("GEX posture", not
  "dealer posture") implies. Do not assume; ask/verify before switching this one.

- **`evidenceFromContext` (play-brief.ts).** Needs `net_gex` and nearest-wall distance alongside
  posture — a plain swap to `resolveGammaPosture`'s existing (narrower) return shape would silently
  drop those two fields from the HELIX/GEX evidence line. The canonical `resolveGammaPostureFact`
  must be scoped to be a superset of every current consumer's needs from day one (read ALL
  consumers before freezing the return shape), not extended piecemeal mid-migration.

- **`resolveBreakInvalidation` / `tradeManagerNarrativeSection`'s inline break-trigger path.** The
  actual decision function (`breakTrigger`) is already shared — but its inputs (`spot`, `flip`,
  `focal`) are independently re-assembled by each caller today. If a migration centralizes the
  *level values* (via `resolveGexLevelFact`/`resolveSpotFact`) but still lets each caller decide
  independently how to null out a stale reading before passing it to `breakTrigger`, the two
  callers can still silently diverge again the next time either is edited without the other. The
  fix must make `resolveGexLevelFact`/`resolveFocalLevels` the **only** place staleness-gating
  happens for these levels — callers must never again write their own `xFromStaleGex` boolean.

- **Wall-event dynamics (§2L).** These three call sites are **not** supposed to render identically
  — collapsing them into one canonical "wall dynamics" fact with a fixed shape/limit would be a
  real behavior change (e.g. if the shared fact hardcodes `limit: 5`, the narrative's single "Wall
  just moved" beat would suddenly show 5 events). The correct migration is a `resolveWallEvents(vec,
  {limit})` that preserves each caller's own limit as a parameter, not a single fixed view.

- **Thesis worst-fading-pillar unification (§2J).** `thesisPillarCoaching` (sorted-by-deltaPts) and
  `counterThesisLine` (unsorted `.find()`) may already usually agree in practice if real committed
  rows rarely have more than one faded pillar at a time — but unifying them is a genuine **behavior
  change** for `counterThesisLine` on any row where they'd disagree. This needs a check against
  real historical `thesisHealth.pillars` arrays with 2+ faded pillars (not just a synthetic
  single-pillar unit-test fixture) before shipping, to confirm the unification doesn't silently
  change which pillar a live counter-thesis cites.

- **Earnings/catalyst countdown phrase (§2I).** `catalystsSection`'s earnings branch has a 4th
  case (`days_until == null → ""`) the other implementations don't handle explicitly. A canonical
  `resolveCountdownPhrase` must include this branch, or a caller that relied on the empty-string
  fallback (rather than omitting the whole clause) starts rendering a broken sentence with a
  dangling connective.

- **2F/2G's `ClaimableFact` mechanism (§3.3).** This is explicitly **not** part of the first slice
  (§5) precisely because it changes function signatures across `buildIntelSections`,
  `collectCoachingBullets`, and `tradeManagerNarrativeSection` — a wider blast radius than any
  single-fact extraction in 3.2. Do not fold it into the same PR wave as the 3.2 formatter/level
  extractions; it needs its own scoped implementation pass with its own equivalence tests against
  the current hand-threaded-boolean behavior (§2F/§2G's existing regression tests already pin that
  behavior — the new mechanism must keep them green, not just add new ones).

## 5. Migration path

**Phase 1 (no signature changes anywhere):** for each fact in §3.2, extract the function into
`play-brief-facts.ts`, write a unit test pinning its behavior against the CURRENT correct call
site(s) (per the §4 risk notes), then edit each duplicate call site to import and call the new
function instead of its own inline copy. Because every one of these functions takes the same `ctx`
(and sometimes `readMs`/`spot`) that every call site already has in scope, **no exported function's
signature changes** — this is a pure extract-and-replace refactor, one fact at a time, independently
PR-able and independently revertable. This matches the repo's existing single-issue-per-PR
discipline exactly: one fact family per PR, same as any other finding.

**Phase 2 (signature changes, scoped separately):** the `ClaimableFact`/`claimed`-set mechanism
from §3.3, needed only for the "already narrated elsewhere" fact family (2F/2G). Deliberately
sequenced after phase 1 proves the simpler pattern works, and scoped as its own PR wave because it
does change exported signatures.

**Not proposed at all:** a single `buildSwingBriefFacts(ctx): SwingBriefFacts` object computed once
at the top of `composeSwingPlayBrief` and threaded through every section-builder. This "compute
once, thread everywhere" design is the natural end state if phase 1 fully lands, but it requires
changing every section-builder's signature in one wave to add real value beyond what phase 1
already delivers (these are pure, cheap, in-memory computations over data already fetched — there
is no IO or expensive recomputation being saved by hoisting them to a single call per request, only
a code-organization win). Revisit only if phase 1's per-fact functions are themselves found to have
drifted apart again after adoption (i.e., if the discipline of "always call the shared function"
turns out not to hold without also forcing the shape via a single object) — not before.

## 6. Verification approach for phase 1

Per this repo's standing RED→GREEN discipline: for every fact moved in phase 1,

1. Add a test for the new `play-brief-facts.ts` function that pins its output against a fixture
   built from the CURRENTLY-correct call site's real behavior (not a hoped-for behavior) — for the
   §2A family specifically, build one fixture per level kind with both a live-Vector and a
   GEX-fallback case, asserting parity with `levelsFromContext`'s current output.
2. Edit one call site to use the new function; run that file's existing test suite; it must pass
   **unchanged** (proving the extraction is behavior-preserving) — if any existing test needed to
   change to keep passing, that is a red flag the "canonical" behavior differs from what that call
   site actually did before, and needs the discrepancy resolved explicitly (per §4), not silently
   absorbed.
3. Repeat per call site, one PR per fact family, full `npm test` + `tsc --noEmit` clean before each
   merge — no different from any other fix in this codebase's issue-handling policy.

## 7. Smallest first slice

Ranked by (a) how many independent computations exist today, (b) whether it has already caused a
real production incident, (c) how cheaply it can be extracted (pure function, no IO, no ambiguous
precedent to reconcile):

1. **Formatters (`fmtAbsolutePremium`, `fmtSignedPct`) — §2B/§2C.** Zero domain ambiguity, zero
   staleness gating, already has a working precedent (`fmtPremium`) to copy the pattern from. The
   sign bug shipped to production **three times in one day** before this document existed — the
   highest bug-recurrence-to-effort ratio in the whole catalog. This is the cheapest possible proof
   the pattern works and should land first.
2. **The GEX/Vector level-precedence family (§2A) — `resolveGexLevelFact`/`resolveSpotFact`.** The
   single most-duplicated fact family (up to 7 independent computations for gamma flip alone), with
   a real, already-fixed production divergence (GEX king) and a real, already-fixed production gap
   (gamma magnet) as direct evidence this exact bug class recurs. One parameterized resolver
   (`kind: GexLevelKind`) prevents the *entire class* going forward — a hypothetical future level
   (e.g. a new wall tier) gets the precedence/staleness rule for free instead of needing its own
   from-scratch copy in N files, which is the actual structural win over fixing each incident
   reactively.

These two slices alone touch every file (`play-brief.ts`, `play-brief-intel.ts`,
`play-brief-narrative.ts`, `play-brief-narrative-coaching.ts`) and retire the exact two bug
families that have already cost the most reactive-fix cycles this quarter, without requiring
phase 2's signature changes at all. Everything else in §2 (D, H, I, J, K, L, plus phase 2's F/G)
should follow only after these two slices are merged and have proven the pattern in production —
per this repo's own "prove the pattern before the rest follow" instinct, not a speculative
big-bang rewrite.

## 8. Explicitly out of scope for this document

- No source file under `src/lib/swing/play-brief*.ts` is changed by this document.
- No `findings-staging` entry accompanies this document — nothing was fixed; this is a proposal.
- This document does not decide `gexPostureSection`'s open question (§4) — that is a product/intent
  question for whoever implements the migration to raise, not something to guess at here.
- This document does not propose changing any *behavior* — every phase-1 function is defined to
  match an already-correct existing call site, never to introduce a new precedence rule.
