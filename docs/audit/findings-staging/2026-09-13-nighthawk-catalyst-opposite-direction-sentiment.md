> **kind:** FINDING

## Night Hawk catalyst headline could quote a sentiment entry of the opposite direction

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | `pickCatalystHeadline` (`src/features/nighthawk/lib/deterministic-edition.ts`) — the "Catalyst:" line in the member-facing thesis text |
| **Severity** | P2 — a real narrative-correctness defect: a bearish-toned headline was quoted as supporting evidence for a bullish thesis (or vice versa). No crash, no data loss, but a member reading the thesis was shown a direct contradiction between the stated direction and the quoted "catalyst". |

### Root cause

```ts
const matching = sentiment.find((s) => s.toLowerCase().startsWith(`${wantSentiment}:`));
const raw = matching ?? sentiment[0] ?? headlines[0];
```

This section only renders when news is a top scoring driver (the `topDrivers` gate a few lines
below), but `scoreNewsCatalyst` can reach that threshold purely from a plain-text keyword hit
(`upgrade`/`beat`/`downgrade`/`miss`/etc.) in `news_headlines` — a signal entirely independent of
whatever happens to be tagged in `dossier.polygon_sentiment`, even though both arrays are fed
from the same underlying news fetch (`dossier.ts` populates them separately: `news_headlines` is
the plain array, `polygon_sentiment` carries `"positive:"`/`"negative:"`-tagged entries).

When no direction-matching sentiment entry exists, the old fallback chain reached for
`sentiment[0]` — the first sentiment-tagged entry — **regardless of its own tag**.

Reproduced directly:

```ts
const headlines = ["Company reports strong beat on quarterly earnings"]; // plain, drives news_score bullish
const polygonSentiment = ["negative: guidance disappoints analysts", "negative: margin compression continues"];
// scoreNewsCatalyst({news_headlines: [...headlines, ...polygonSentiment]}, "long") -> 3 (news becomes the top driver)
buildDeterministicThesis(scoredLongCandidate, dossier).thesis
// -> `... Catalyst: "guidance disappoints analysts".` (BEFORE the fix)
```

A LONG pick scored bullish via the "beat" keyword in a plain headline still quoted a
`"negative:"`-tagged sentiment entry as its "Catalyst:" line — presenting evidence that
contradicts the stated direction as if it supported it.

### Blast radius

Only this one function/sentence was affected. The direction-matching path itself (`matching`) was
already correct and untouched.

### Fix

When no direction-matching sentiment entry exists, fall back to a plain (untagged) headline from
`news_headlines` instead of an opposite-direction sentiment entry:

```ts
const raw = matching ?? headlines[0];
```

Never falls back to `sentiment[0]` regardless of its tag anymore; omits the Catalyst line
entirely (as before) when neither a matching sentiment entry nor any plain headline exists.

### Why this fix, not an alternative

Considered scanning `sentiment` for a *neutral*-tagged entry as an intermediate fallback before
giving up — rejected as unnecessary complexity: a plain, untagged headline from `news_headlines`
already serves the same purpose (real news content, no sentiment claim attached) and is simpler
to reason about.

### Evidence

- Reproduced directly via `buildDeterministicThesis` + `scoreNewsCatalyst`: printed
  `Catalyst: "guidance disappoints analysts"` (bearish) for a BULLISH pick before the fix;
  `Catalyst: "Company reports strong beat on quarterly earnings"` (the real driver) after.
- RED: reverted `deterministic-edition.ts` only (kept the new test), 1/1 new test failed, exactly
  as predicted.
- GREEN: restored the fix, all 66 tests in `deterministic-edition.test.ts` pass (65 pre-existing +
  1 new).
- `npx tsc --noEmit`: clean.
- Full suite (Node 20): 14033 pass / 0 fail / 3 skipped.

### What was deliberately left unchanged

The direction-matching path itself (still prefers a real, tagged, agreeing sentiment entry first)
and the "no headline/sentiment data at all" omission case (already correct).
