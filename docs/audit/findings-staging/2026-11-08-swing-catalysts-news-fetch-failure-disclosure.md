# Ask Largo swing play-brief's "Catalysts & news" section conflates a failed news fetch with genuine zero-news — no disclosure, unlike its sibling "Meridian catalysts" section

> **kind:** `FINDING`

### Summary
`catalystsSection()` (`src/lib/swing/play-brief-intel.ts`) renders the "Catalysts & news" section
of the swing play-brief. Its news-headlines logic only branches on `arsenal.news?.headlines?.length`
(has headlines) vs `arsenal.news?.count === 0` (genuinely zero results) — there was no branch for
`arsenal.news` being `null` because the fetch itself FAILED. A failed fetch fell through both
checks and rendered nothing, even though `envelope.unavailableSources` (the same response's
top-level disclosure list) correctly carried `{"source":"news","reason":"ticker news <TICKER>
unavailable: Polygon /benzinga/v2/news → 403", ...}` for the same ticker in the same payload — a
reader of just this section could not tell "no news exists" from "the fetch failed," violating the
Largo product contract's absence principle (C3: a failure must never read as a confident absence).

### Root cause
`src/lib/bie/ecosystem-context.ts` sets `arsenal.news` to `null` in TWO distinct cases that are
otherwise indistinguishable from inside `catalystsSection()`:
- the news leg is genuinely irrelevant for this ticker/scope (stays `null`, nothing pushed to
  `unavailable_sources`), or
- the fetch itself errored/timed out/was refused (stays `null`, AND a `{source: "news", ...}`
  entry is pushed to `arsenal.unavailable_sources`).

`catalystsSection()` never read `arsenal.unavailable_sources` at all for its news block, so it had
no way to distinguish the two and silently treated both as "say nothing." The sibling
`meridianCatalystSection()` function three sections later in the same file already handles the
identical ambiguity for its own catalyst-calendar read (`slice?.unavailable` → an explicit "fetch
itself failed... not evidence the calendar is quiet" message) — and was patched again TODAY
(2026-11-08, same file) for a related absence gap on the earnings-calendar leg specifically. The
news leg in `catalystsSection()` was the one sibling read that never got the equivalent treatment.

Found by a parallel live-production audit workflow (SPX Slayer / 0DTE / Swings / Ask Largo probes)
run against `blackouttrades.com` under this session's standing Ask Largo deep-dive mandate, then
independently verified by reading the actual source (`play-brief-intel.ts` + `ecosystem-context.ts`)
before trusting the probe's own self-reported "low confidence" rating.

### Fix
Added an `else if` branch to the existing `headlines?.length` / `count === 0` chain in
`catalystsSection()`: when `arsenal.news` is `null` AND `arsenal.unavailable_sources` carries a
`source === "news"` entry, render `"Ticker news fetch failed on this read — not evidence of no
news."` — mirroring `meridianCatalystSection`'s existing wording for the identical failure shape.
When `arsenal.news` is `null` with NO such entry (the ticker-class-irrelevant case), behavior is
unchanged — nothing is rendered for news, same as before.

### Evidence
- RED: new test `catalystsSection: a FAILED news fetch discloses the failure, not silence` fails
  against the pre-fix source (confirmed via `git stash` of just `play-brief-intel.ts`: 365 pass /
  1 fail).
- GREEN: same test passes post-fix (366/366 in `play-brief-intel.test.ts`); a companion regression
  test (`news === null with NO unavailable_sources entry ... stays silent on news`) confirms the
  ticker-class-irrelevant case is unaffected.
- `npx tsc --noEmit` clean.
- Full `src/lib/swing/*.test.ts` regression: 2282/2282 pass.
- Live cross-check: fetched 13 real swing play-brief envelopes across 8 tickers (OPEN/WATCH/CLOSED,
  long/short) against prod on 2026-11-08 — this was the only genuinely new, verified issue found
  across all four parallel probes that cycle (SPX Slayer, 0DTE, Swings, and this Ask Largo probe
  all independently reconfirmed only already-known items otherwise).

### Blast radius
Only the "Catalysts & news" section's news-headlines block in `catalystsSection()`. No other
section, no other data path. Severity P3 — a narrative-honesty/absence-disclosure gap, not a
crash, wrong number, or anything affecting position sizing/risk.

| **Status** | FIXED — this PR. |
