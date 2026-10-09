## 2026-10-09 — [FINDING, largo-swing] #5717's news-specificity re-rank fetches too few items to ever find a genuinely ticker-specific headline for a high-news-volume name — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (same class as #5717 — every individual headline shown is real and genuinely tagged with the ticker, so no single field fails validation; the defect is that the fetch window is too narrow for the already-correct ranking logic to ever see the item it should promote) |
| **Component** | `src/lib/bie/ecosystem-context.ts` (`fetchEcosystemArsenal`'s single-name `fetchTickerNews` call) |
| **PR** | fix/largo-news-specificity-fetch-limit |
| **Found via** | Ask Largo standing sub-mandate — 5-engine live monitor, :20 cycle, deep-diving `GET /api/market/swing/play-brief` for fresh tickers (RILY/PHAT/KD open, INTC/AMZN/HUT/MSTR closed) against `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s C7 (evidence) point |

### Root cause

#5717 (merged 2026-10-08, the day before this finding) added `rankNewsItemsBySpecificity()` to stop
a broad multi-ticker co-tagged Benzinga story from crowding out a genuinely ticker-specific headline
in the swing play-brief's "Catalysts & news" section — a real, well-diagnosed fix, and its own unit
tests correctly prove the ranking function itself is right. But the ranking function can only
re-order whatever `fetchTickerNews` already fetched, and the live call site
(`fetchEcosystemArsenal`, same file) still requests `fetchTickerNews(ticker, { limit: 6 })` —
unchanged by that PR. For a high-news-volume megacap, Benzinga's 6 MOST RECENT items (by
`published.desc`) can ALL be broad co-tagged roundups, while a genuinely specific item (tagged with
only this one ticker) sits a few hours further back — just outside that 6-item window, so the
specificity re-rank never has the chance to promote it; there is nothing in the fetched batch to
promote.

### Evidence

Live `GET /api/market/swing/play-brief?playId=SWING:AMZN:48&ticker=AMZN&status=CLOSED` (2026-10-09,
~07:26 ET — one day after #5717 shipped, independently re-checked as part of this cycle's routine
ticker rotation, not a targeted re-test) still rendered **0 of 4 "Catalysts & news" headlines about
AMZN specifically**:

- "Anthropic Announces Claude Docs, Slides, And Design Are Out Of Beta..." (co-tagged `AMZN, GOOG,
  GOOGL` — 3 tickers)
- "Jim Cramer Says OpenAI Revenue Isn't 'Apples to Apples' With Anthropic..." (co-tagged 4 tickers)
- "Ahead of DAL Earnings, Elon Musk Mocks Delta's Starlink Snub..." (co-tagged 5 tickers)
- "Wall Street Still Treats Micron Like a Commodity Stock..." (co-tagged 7 tickers)

Queried the raw Benzinga feed directly (`tickers.any_of=AMZN`, bypassing this repo, same
rule-out-a-wiring-bug discipline #5717's own finding used): the SAME-day batch also contained, at
raw recency positions 11 and 12 — outside the live `limit: 6` fetch window —

- "Amazon Web Services Announces Golden Age of Science Accelerator..." (co-tagged: **just `AMZN`**)
- "Jeff Bezos Could Take Blue Origin Public. Amazon Investors Just Got a New Space Question"
  (co-tagged: `AMZN, SPCX` — 2 tickers)

Both are genuinely about Amazon and more specific than every item the brief actually showed; neither
reached the re-rank because `limit: 6` never fetched them in the first place. This is the identical
symptom #5717 reported fixing, one day later, with different headline instances — confirming the
gap is structural (the fetch window, not a one-off news cycle that #5717's fix happened to miss).

### Fix rationale

Widened the single-name `fetchTickerNews` call from `limit: 6` to `limit: 20` — still well under
`fetchTickerNews`'s own 50-item cap (`polygon-news.ts`: `Math.min(opts?.limit ?? 12, 50)`), and
Benzinga news carries no documented rate limit (same file's own header). This gives
`rankNewsItemsBySpecificity()` — already correct — a real pool to choose from instead of fixing the
ranking function a second time. `catalystsSection`'s own `.slice(0, 4)` display count is unchanged;
only the upstream fetch widened.

Considered and rejected: raising the limit all the way to 50 (the provider's own cap). 20 was chosen
as a bounded middle ground — enough to reach the specific items observed sitting at positions 8-12
in both this and #5717's own repro, without fetching (and holding in memory/cache) an unbounded
amount of news per ticker for no demonstrated benefit beyond that.

**Blast radius — same shared fold #5717 already fixed, now actually effective.** `fetchEcosystemArsenal`
feeds `assembleEcosystemArsenal()`'s single-name news fold, which in turn feeds three consumers:
`catalystsSection` (`play-brief-intel.ts`, takes all 4 — the surface that exposed this), and
`ticker-verdict.ts` / `ecosystem-narrative.ts` (each take only `headlines[0]`). Widening the fetch
window benefits all three the same way #5717 intended to, for every high-news-volume ticker, not
only AMZN.

### Evidence the fix is real (RED → GREEN)

Added a regression test asserting the single-name `fetchTickerNews` call requests a limit ≥ 15 (new
mock capture of the `opts` argument, which the existing mock previously discarded). `git stash`-only
the implementation line (kept the new test): failed with `fetchTickerNews limit must be wide enough
... (got 6)` before the fix; after restoring the one-line change, all 37 tests in
`src/lib/bie/ecosystem-context.test.ts` pass. `npx tsc --noEmit` clean. Full `npm test`: 15880 pass /
0 fail / 3 skipped (pre-existing, unrelated).
