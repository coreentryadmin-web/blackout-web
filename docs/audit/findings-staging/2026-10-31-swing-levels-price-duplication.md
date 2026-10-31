> **kind:** `FINDING`

## Ask Largo swing play-brief `envelope.levels` restated a GEX-king/wall price collision twice under two labels in `evidence_numbers` — FIXED

| | |
|---|---|
| **Severity** | MEDIUM (Ask Largo × Night Hawk Swings standing ownership mandate — "narrative-vs-bullet-dump quality"; not a wrong number, but the SAME real number stated twice under two labels in the Largo-contract-facing `evidence_numbers` field) |
| **Surface** | `extractEvidence()` in `src/lib/swing/play-brief-adapter.ts` (lines 94-98 pre-fix), consumed by `GET /api/market/swing/play-brief`'s `evidence_numbers` field — every rich Largo answer over a swing play |
| **Status** | FIXED |

### Root cause

`levelsFromContext` (`src/lib/swing/play-brief.ts`) resolves call wall, put wall, gamma flip, GEX
king, max pain, dark pool, gamma magnet, spot and confluence zones **independently of one
another**, pushing each one that resolves non-null as its own `BieLevel` entry into
`envelope.levels`. A GEX king strike — definitionally wherever gamma concentration peaks — commonly
sits AT a major wall, so `envelope.levels` routinely carries two entries at the identical price
(e.g. `{label:"call wall", price:700}` and `{label:"GEX king", price:700}`).

`extractEvidence()`'s levels loop (the block directly after the SOXX rounding fix's own comment)
pushed **every** `envelope.levels[]` entry verbatim into the Largo-facing `evidence_numbers` array
with no price-collision check:

```ts
if (envelope.levels && envelope.levels.length > 0) {
  for (const level of envelope.levels) {
    evidence.push(`${level.label}: $${fmtPriceLevel(level.price)}`);
  }
}
```

So a collision surfaced as the identical real price restated twice under two different labels in
the structured evidence a Largo answer actually cites numbers from.

This is the sibling of the fix shipped the same day (PR #7000) for `collectFocalLevels`
(`play-brief-narrative.ts`) — that PR deduped the SAME collision for the structure-ladder's rungs
and the "Trade manager read" narration bullets, but its own write-up explicitly named
`envelope.levels` (`levelsFromContext`, play-brief.ts) as **"a separate, independently-computed
list filtered by label text, not by this function's output — out of scope here, unaffected either
way."** The gap that PR deliberately deferred is this one.

### Evidence

Live reproduction (2026-10-31, production, read-only, `GET /api/market/swing/play-brief`):

- **META** (`SWING:META:69`, OPEN/HOLD): `evidence_numbers` contained both `"call wall: $700.00"`
  and `"GEX king: $700.00"` — the identical $700 strike cited twice under two labels.
- **MRNA** (`SWING:MRNA:68`, OPEN/TRIM): `evidence_numbers` contained both `"call wall: $250.00"`
  and `"GEX king: $250.00"` — identical shape.

Confirmed the companion PR #7000 fix is already live and unaffected: META's
`structureLadder.rungs` carries exactly ONE entry at 700 and `evidence_numbers` carries exactly one
`"R:R to call wall ($700.00): 3.1R"` line (not two) — the ladder-side collision stays fixed; this
finding is specifically about the separate `envelope.levels` → `extractEvidence` levels-loop path.

RED→GREEN, `git stash` of just the source fix (`play-brief-adapter.ts`), keeping the new tests in
place:

- **Before the fix**: a hand-built `envelope.levels` collision (`call wall`/`GEX king` both at
  $700) produces two `evidence_numbers` lines at the same price; driving the REAL end-to-end
  pipeline (`composeSwingPlayBrief` → `adaptSwingBriefToLargo`) with a Vector fixture that
  independently resolves a call wall AND a GEX king to the same strike (110) reproduces the exact
  live META/MRNA shape — `envelope.levels` carries two entries at 110.00, and
  `largoRead.data.evidence` carries both `"call wall: $110.00"` and `"GEX king: $110.00"`.
- **After the fix**: exactly one bare-level evidence line survives per colliding price in both
  cases (the first-pushed label, `call wall`, per `levelsFromContext`'s own push order); a
  non-colliding level (`put wall: $610.00`) is unaffected.

`src/lib/swing/play-brief-adapter.test.ts`: 12/12 pass (2 new tests). Broader suite, Node 20:
`play-brief-adapter`/`play-brief-narrative`/`play-brief-ladder`/`play-brief`/`play-brief-intel`/
`play-brief-intel-collapse`/`play-brief-narrative-coaching`/`level-dedup` test files combined:
952/952 pass. `npx tsc --noEmit` clean repo-wide. `npx eslint` clean on both touched files.

### Blast radius

Single function, single file (`extractEvidence()` in `play-brief-adapter.ts`), but it is the sole
producer of the Largo-contract-facing `evidence_numbers` field for every swing play-brief response
(`GET /api/market/swing/play-brief`). Any ticker whose GEX king strike coincides with its call or
put wall — common, confirmed on 2/2 real OPEN tickers checked in one pass — was exposed. The UI's
own `BieKeyLevelsTable` (`BieAnswer.tsx`) was never affected by this specific gap: it already runs
`filterLevelsCoveredByLadder` (`src/features/largo/answer/level-dedup.ts`) to drop any
`envelope.levels` row the structure ladder already renders whenever a ladder is present, which
happens to absorb this exact collision for the rendered table (though for a different reason — it
drops ladder-covered labels wholesale, it does not merge price collisions). `extractEvidence()`
only reads `envelope.levels` directly and had no equivalent filter, so the plain-text
`evidence_numbers` array — the field Largo's own answer-engine context and any other API consumer
actually reads — carried the duplication regardless of what the UI showed.

### Fix rationale

Dedupe within the `extractEvidence()` levels loop itself, using the same `< 0.01` price-identity
tolerance this product already uses elsewhere for the identical purpose
(`confluenceZoneKindsLabel`, `play-brief-absence.ts`; `pushFocalLevel`,
`play-brief-narrative.ts`'s own PR #7000 fix). On a price collision, the first-pushed label is kept
and the rest are dropped — no additional hard/soft precedence logic is needed here, because
`levelsFromContext`'s own push order already puts call wall/put wall/gamma flip ahead of GEX
king/max pain, which naturally reproduces the same "wall wins over king" display convention PR
#7000 established for the sibling bug (built, and checked against this file's live evidence,
rather than assumed).

Deliberately scoped to just this one loop/array: it never mutates `envelope.levels` itself (the UI
and any other consumer of the raw envelope keep seeing every entry — that list's job is different
from this evidence array's job of citing distinct numbers), and it does not touch the
`LADDER_COVERED_LEVEL_LABELS`/`filterLevelsCoveredByLadder` UI-only filter, which solves a related
but different problem (hiding rows the ladder widget already renders) and is unaffected either way.

### Tests

`src/lib/swing/play-brief-adapter.test.ts` — 2 new tests:
- Hand-built `envelope.levels` collision (isolated unit test, mirrors the existing SOXX rounding
  test's style): asserts `extractEvidence`'s loop collapses a call-wall/GEX-king collision into one
  evidence line (the earlier-pushed label), while a non-colliding level passes through unchanged.
- Real end-to-end pipeline test (`composeSwingPlayBrief` → `adaptSwingBriefToLargo`, not a
  hand-built envelope): drives a Vector fixture that independently resolves a call wall and a GEX
  king to the same strike, asserts the real pipeline actually produced the collision in
  `envelope.levels` (so the test can't pass for the wrong reason), then asserts exactly one bare
  `"label: $price"` evidence line survives for that price (explicitly excluding the separate,
  already-correct `"R:R to ..."` structure-ladder evidence line at the same price, which comes from
  a different, independent evidence source PR #7000 already deduped).

Both proven RED without the source fix (`git stash` of just `play-brief-adapter.ts`, keeping the
tests) and GREEN with it restored.
