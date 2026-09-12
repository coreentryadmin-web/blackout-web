> **kind:** FINDING

# Night Hawk Legacy thesis never surfaced WHICH news drove a "news" scoring tag — FIXED

| Field | Detail |
|---|---|
| **Status** | FIXED |
| **Lane** | Night Hawk Legacy |
| **Severity** | P3 — product enhancement (genuine signal gap, not a correctness defect) |
| **Files** | `src/features/nighthawk/lib/deterministic-edition.ts` — `buildDeterministicThesis`, new `pickCatalystHeadline` |
| **PR** | (opened same session as this finding) |

## Root cause / gap

`scoreNewsCatalyst` (`scorer.ts`) already computes `news_score` from two real, already-fetched data
sources on every dossier: `dossier.news_headlines` (plain article titles from Benzinga/Polygon) and
`dossier.polygon_sentiment` (Polygon's own per-article sentiment classification plus a reasoning
string, sliced to 120 chars, e.g. `"positive: strong iPhone pre-order checks from supply chain"`).
When news is a strong enough signal, `news_score` can be one of the top-2 drivers rendered in the
published `key_signal` line members see on every card — e.g. `"BULLISH — news + flow · score 82
(A)"`.

But `buildDeterministicThesis`'s actual prose paragraph (the longer explanation below the card)
never read `dossier.news_headlines` or `dossier.polygon_sentiment` at all — confirmed by grep,
zero references in the file before this fix. So a member could see "news" named as a headline
driver of their pick and have **no way to find out what the news actually was** anywhere on the
card. This is exactly the "a signal that exists but isn't surfaced" gap the standing
aggressive-improvement-hunting mandate calls out by name.

## Fix

Added `pickCatalystHeadline(dossier, isLong)`: when `news` is present in `buildDeterministicThesis`'s
already-computed `topDrivers` (i.e. it materially influenced this specific pick, not just any name
with news coverage), pick one direction-matching, real piece of text to quote:
1. Prefer a `polygon_sentiment` entry whose polarity matches the play's direction (`positive` for a
   long, `negative` for a short) — this is real reasoning text, not just a title.
2. Fall back to any `polygon_sentiment` entry, then to the first plain `news_headlines` title.
3. Strip the leading `positive:`/`negative:`/`neutral:` tag (redundant — the thesis already states
   direction via `dirWord`), truncate to 110 chars, and render `Catalyst: "<text>".` in the thesis.

Returns `null` (renders nothing) when there is no real text to show — additive only, never
fabricates a catalyst. Scoped strictly to when news is an actual top-2 driver, so the thesis doesn't
get noisier for picks where news coverage exists but wasn't influential.

## Blast radius

- `buildDeterministicThesis` is Legacy-exclusive (confirmed via grep earlier this session while
  fixing the R:R rounding bug in the same function — no other desk imports it).
- Purely additive to the `parts` array the thesis renders from — no existing sentence, ordering, or
  field is removed or changed.

## Fix rationale

Kept the same "top-2 driver" gate the `key_signal` line already uses (`topDrivers`) rather than a
separate threshold, so the catalyst sentence appears exactly when — and only when — the member is
already being told "news" mattered for this pick. Preferring `polygon_sentiment` over plain
headlines surfaces the actual REASONING Polygon computed, not just a title the member would have to
interpret themselves.

## Regression tests

`src/features/nighthawk/lib/deterministic-edition.test.ts` — 4 new tests: quotes the
direction-matching sentiment entry when news is a top driver; falls back to a plain headline when no
sentiment data exists; renders nothing (never fabricates) when news is a top driver but no
headline/sentiment data exists at all; stays silent when news is present in the dossier but is NOT a
top driver for this specific pick. Verified RED (2 of the 4 failing) via `git stash` of the `.ts`
fix alone, then GREEN after restoring it (49/49 in the file). `tsc --noEmit` clean; full local suite
run alongside this fix.
