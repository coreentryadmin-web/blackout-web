> **kind:** FINDING

## Ask Largo "Deep dive" mode silently drops the Structure Ladder for every swing play-brief answer — FIXED

| **Status** | Fixed in this PR |
|---|---|

### Root cause

`src/lib/swing/play-brief-ladder.ts`'s `StructureLadder` (`envelope.structureLadder`) is a rich,
single-source price ladder swing play-briefs attach to every OPEN/WATCH position: real per-level
reward:risk measured against the actual structural stop, a cross-desk gamma-regime agreement flag,
and (when graduated) archetype/sub-lane historical win-rate context. `BieAnswer.tsx` — the shared
BIE envelope renderer — already renders it via `<BieStructureLadder ladder={envelope.structureLadder} />`
(line 128), right between the key-levels table and the scenario cards.

`LargoAnswerMessage.tsx` is the top-level component that decides which renderer a given answer uses.
It has THREE branches:

1. **Concrete mode** (`answerMode === "concrete"`, the default) → `LargoConcreteAnswer`.
2. **Deep dive mode** (`answerMode === "deep"`) **and** the envelope clears its own `richEnough` bar
   (`Boolean(envelope.headline || envelope.bias) && (levels.length>0 || sections.length>0 ||
   tradeDecision != null)`) → `<LargoDeskRead>`.
3. Deep dive mode but **not** rich enough, or no envelope at all → `<BieAnswer>` (the markdown-shim
   fallback path).

Branch 2 is the one every real swing play-brief answer takes in Deep dive mode — a swing brief
always carries `sections` (narrative text) and a `headline`, so it always clears `richEnough`. But
branch 2 renders `<LargoDeskRead>` and **never reads `envelope.structureLadder` at all**.
`LargoDeskRead` does render something it calls a "ladder" block (`answer-layout.ts`'s `AnswerBlock`
union includes `"ladder"`), but that block is built from `ladderFromLevels(envelope.levels)`
(`level-ladder.ts`) — a generic price-vs-spot rail with no reward:risk, no cross-desk agreement, and
no track-record context. It is a different, strictly poorer widget built from a different field, not
a rendering of `structureLadder`. Only branch 3 (`<BieAnswer>`) ever read the real field.

**Consequence:** a member who switches to Deep dive mode (a persisted, one-tap toggle —
`LargoAnswerModeToggle.tsx`/`useLargoChat.ts`'s `setAnswerMode`, stored across sessions via
`normalizeLargoDepth`) and asks about a swing position never sees the Structure Ladder at all — not
degraded, not partial, completely absent — even though the backend computed it in full and the
member-facing rich-prose answer right above it is rendered from the *same* envelope. A member on
Concrete mode, or asking a question whose envelope happens to miss the `richEnough` bar, saw it fine;
switching modes silently took it away. This is the same "field reaches the wire but no UI component
ever renders it" bug class as #7689/#7691/#7692/#7702, except the component existed and worked
correctly — it just was not reachable from this one render branch.

### Evidence

Reproduced with `react-dom/server`'s `renderToStaticMarkup` against the real, unmocked component tree
(`LargoAnswerMessage` → `LargoDeskRead`/`BieStructureLadder`), the same pattern this repo already
uses for JSX-logic regression tests (`LargoCompareCard.test.ts`, `BieSectionTable.test.ts` from
#7702):

- **RED (pre-fix):** rendering `<LargoAnswerMessage answerMode="deep" envelope={envelopeWithLadder}>`
  produced HTML containing the `largo-read` class (confirming the `LargoDeskRead` branch was taken,
  not a fallback) but no occurrence of `"Structure ladder"` or any rung label (`"Call wall"`) —
  `git stash` on just the fix file reproduces this exact failure (see test file history / this PR's
  diff for the stash-and-rerun proof).
- **GREEN (post-fix):** the same render now contains `"Structure ladder"` and `"Call wall"`, and a
  second test confirms Concrete mode (unaffected — it never used `LargoDeskRead`) still renders
  through `LargoConcreteAnswer` as before.

### Blast radius

Only `src/features/largo/components/LargoAnswerMessage.tsx` needed a change — `BieStructureLadder`
itself and its own call site in `BieAnswer.tsx` were already correct. No other consumer renders
`LargoDeskRead` directly without going through this same `richEnough` gate
(`src/features/largo/components/LargoAnswerMessage.tsx` is the only importer of `LargoDeskRead`), so
this is the single missing wire, not one of several.

### Fix rationale

Added `<BieStructureLadder ladder={envelope.structureLadder} />` to the `richEnough`/`LargoDeskRead`
branch, in the same relative position (`BieAnswer.tsx`'s own ordering: ladder before scenario cards)
so a member sees the identical block sequence regardless of which mode produced the render. Left
`LargoDeskRead`'s own generic `"ladder"` block (`ladderFromLevels`) untouched — it serves every other
Largo product (Vector/Helix/Meridian/Thermal reads) that has `levels` but no `structureLadder`, and
removing or replacing it would regress those. The two blocks are additive, not duplicative: the
generic ladder is omitted by `BieStructureLadder` doing nothing when `structureLadder` is
absent/empty (its own existing early-return guard), and conversely `ladderFromLevels` only fires when
`envelope.levels` has entries — a swing brief currently keeps `levels: []` for the OPEN/WATCH bucket
precisely because the Structure Ladder already covers those nodes (see `filterLevelsCoveredByLadder`
in `level-dedup.ts`), so in practice the two never double-print for the same answer.

### Market-open validation

See `docs/audit/MARKET-OPEN-VALIDATION.md` — add an entry: once the market opens, open an existing
OPEN/WATCH swing position's play-brief answer in Ask Largo, switch to Deep dive mode, and confirm the
Structure Ladder (reward:risk rungs, cross-desk agreement badge if present) now renders — it did not
before this fix.
