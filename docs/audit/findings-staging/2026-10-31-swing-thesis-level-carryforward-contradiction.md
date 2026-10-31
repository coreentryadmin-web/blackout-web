# 2026-10-31 enrichPlay: carried-forward setupState/entryStatus can ride beside a reads-absent thesisLevel/thesisNote

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 — member-facing contradiction in Ask Largo's thesis-health panel for pre-entry swing plays |

## Root cause

`enrichPlay` (`src/lib/swing/serving-lane.ts`, ~line 228) merges a freshly-computed `meta` object
(`swingServingMetaFromDossier(dossier, reads)`, `src/lib/swing/serving-ingest.ts`) onto the
previously-persisted `play` object on every request. When this scan's grounded `reads` for a
ticker are unavailable (`reads?.setup` undefined — a transient per-scan/per-ticker drop, not a
universal outage), `meta.setupState` comes back `null`, and `enrichPlay` correctly falls back to
the carried-forward prior value:

```ts
setupState: meta.setupState ?? play.setupState,   // falls back correctly
entryStatus: meta.entryStatus ?? play.entryStatus, // falls back correctly
```

But `thesisLevel`/`thesisNote` were taken from `meta` **unconditionally**, with no equivalent
fallback:

```ts
thesisLevel: meta.thesisLevel,   // no fallback — THE BUG
thesisNote: meta.thesisNote,     // no fallback — THE BUG
```

`swingServingMetaFromDossier` computes `thesisLevel`/`thesisNote` from a **local** `setupState`
variable inside that function — purely THIS CALL's reads-derived value (`reads?.setup ?
deriveSetupState(dossier, reads.setup) : null`), never the merged value `enrichPlay` produces one
level up. `deriveSetupState` (`src/lib/swing/setup-state.ts`) is total over a supplied
`reads.setup` — it always returns one of FORMING/EXTENDED/TRIGGERED/INVALIDATED — so
`meta.setupState == null` is *exactly* "no grounded setup read was supplied this call," never
anything else. When that local `setupState` is null, `swingServingMetaFromDossier`'s branching
falls to:

```ts
} else {
  thesisLevel = "unknown";
  thesisNote = "no setup read attached to this name yet";
}
```

So in exactly the case where `enrichPlay` is correctly carrying forward a real
`setupState: "TRIGGERED"` / `entryStatus: "AT_TRIGGER"` from the prior play, the same served row
simultaneously got `thesisLevel: "unknown"` / `thesisNote: "no setup read attached to this name
yet"` — directly asserting "no setup read exists" while the sibling fields assert a real, live
trigger read does exist.

**Why a naive `meta.thesisLevel ?? play.thesisLevel` would not have fixed this.**
`SwingServingMeta.thesisLevel` is typed `SwingThesisLevel` — non-nullable, always one of
`"break"/"warn"/"intact"/"unknown"`, never `null`/`undefined`. A blanket `??` would never actually
fall back, because `meta.thesisLevel` is always a truthy string: it would compile and read like a
fix while changing no behavior. The real fix has to detect the *specific* case that produces the
contradiction — this call's reads were absent AND meta's own default actually fired (not an
independently-true "break"/"warn" from the dossier's own data quality, which must NOT be
overridden) AND a real prior value exists to carry forward — and act only then.

## Evidence

Live repro, 2026-10-31, NET (RESEARCH bucket, `GET /api/market/nighthawk/horizons?view=swings`):
served row carried `setupState: "TRIGGERED"`, `entryStatus: "AT_TRIGGER"` together with
`thesisLevel: "unknown"`, `thesisNote: "no setup read attached to this name yet"` in the same
object. 11 other RESEARCH-bucket plays in the same response (CRWD/ORCL/PLTR/NU etc.) showed the
fields in agreement — this is intermittent, firing only when reads drop for a specific ticker on a
given scan while a prior setupState/entryStatus is still being carried forward.

Proven via `git stash`-equivalent (serving-lane.ts reverted to its pre-fix content, test file
kept) + `npx tsx --experimental-test-module-mocks --test src/lib/swing/serving-lane.test.ts`:

- **RED** (pre-fix source): 23 pass / 4 fail — 3 fail on `resolveThesisHealth is not a function`
  (the helper didn't exist yet) and, critically, the integration test
  (`getSwingServingLane: a carried-forward setupState/entryStatus never rides beside a
  reads-absent thesisLevel/thesisNote`) fails on the **real assertion**, reproducing the exact
  live contradiction through the public `getSwingServingLane` API: `thesisLevel` comes back
  `'unknown'` where `'intact'` (the carried-forward value) was expected.
- **GREEN** (post-fix source): 27/27 pass.

## Blast radius

- `enrichPlay` is the only call site that merges `meta` onto a pre-entry discovery `play` this
  way — `attachThesisExplanation` (the sibling function for LIVE/committed rows) already
  deliberately does NOT copy `thesisLevel`/`thesisNote` from `meta` at all (its own comment: "a
  live row derives its thesis health from ongoing management, and a pre-entry read would overwrite
  a real 'thesis broken' with a stale 'intact'"), so it was never exposed to this bug and needed no
  change.
- Every consumer of `getSwingServingLane()`'s pre-entry rows inherits the fix for free:
  `src/app/api/market/nighthawk/horizons/route.ts` (the member Swings board — WATCH/RESEARCH
  sections), `src/lib/largo/product-reads.ts` (Ask Largo's `ProductRead` surface for swing), and
  `src/lib/swing/play-brief-resolve.ts` (the swing play-brief). In particular this feeds Ask
  Largo's thesis-health narrative via `thesisBreakFromMeta` (serving-ingest.ts) and
  `thesis-health.ts` downstream — a contradictory `{level: "unknown", note: "no setup read
  attached..."}` next to a live `setupState: "TRIGGERED"` would have rendered as the exact
  dishonest-sounding "we don't have data on this, but it's also at the trigger right now" prose
  the 9-6c honesty rule exists to prevent.
- No change to `swingServingMetaFromDossier`/`deriveSetupState`/the honest-absence "unknown"
  default itself — that behavior is correct and is now explicitly protected by a regression test
  (see Verify) rather than loosened.

## Fix

Added `resolveThesisHealth(meta, play)` (`src/lib/swing/serving-lane.ts`, exported for direct unit
testing) immediately above `enrichPlay`. It carries `play.thesisLevel`/`play.thesisNote` forward
**only** when all three hold:
1. `meta.setupState == null` (this call's reads were absent — the exact pre-`??` signal, read
   before `enrichPlay` applies its own `setupState`/`entryStatus` fallback a few lines below);
2. `meta.thesisLevel === "unknown"` (meta's own reads-absent default actually fired, as opposed to
   an independently-true "break"/"warn" the dossier's data quality established without needing
   reads — those must win regardless, and do, since this condition is false for them);
3. `play.thesisLevel != null` (there is a genuine prior value to carry — never invent one; a
   genuinely never-grounded play still renders the honest "unknown" default).

`enrichPlay` now calls `resolveThesisHealth(meta, play)` once and uses its result for both
`thesisLevel` and `thesisNote`, instead of taking `meta.thesisLevel`/`meta.thesisNote` directly —
keeping this fallback in lockstep with the `setupState`/`entryStatus` fallback already a few lines
below it, so the merged row can no longer assert two different realities about the same thesis.

**Deliberately left unchanged:** `swingServingMetaFromDossier`'s own branching (INVALIDATED >
degraded > setupState-present > unknown) is untouched — the fix lives entirely in how `enrichPlay`
*consumes* that output, not in how the meta itself is derived. `attachThesisExplanation` is
untouched (see Blast radius). `resolvedFactorsFor`'s pinned-factors self-healing (same file, same
general "merge meta onto play" family of fixes, FINDINGS 2026-09-20) is a separate, already-fixed
mechanism and was not touched.

## Verify

- `npx tsc --noEmit` — clean.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/serving-lane.test.ts` — 27/27
  green (23 pre-existing + 4 new: 3 direct `resolveThesisHealth` unit tests covering the
  carry-forward case, the honest-no-prior-value case, and the fresh-reads-always-win case; 1
  end-to-end `getSwingServingLane` integration test reproducing the live NET contradiction).
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/serving-ingest.test.ts
  src/lib/swing/serving-board.test.ts src/lib/swing/legacy-confirm-promote.test.ts
  src/lib/swing/banger-lane-merge.test.ts src/lib/swing/play-brief-resolve.test.ts` — 120/120
  green, no regressions in siblings/consumers.
- Full `npm test` run in progress/completed at PR time (see PR description for final count).
