## 2026-10-08 — [FINDING, largo-swing] Single-name news headlines were taken by raw recency, so broad multi-ticker co-tagged stories silently crowded out genuinely ticker-specific ones — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (no wrong number served — the "Catalysts & news" section just quoted real headlines that were technically tagged with the ticker, so every individual field passed validation; the defect is a selection/ranking one, where the genuinely relevant evidence existed in the same fetch batch but never reached the reader) |
| **Component** | `src/lib/bie/ecosystem-context.ts` (`assembleEcosystemArsenal`, new `rankNewsItemsBySpecificity` helper) |
| **PR** | fix/largo-news-specificity-ranking |
| **Found via** | Ask Largo standing sub-mandate — this cycle's 5-engine live monitor, deep-diving `GET /api/market/swing/play-brief` for fresh tickers (AMZN, CRWD, HUT closed; CMG open) against `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s C7 (evidence) point |

### Root cause

`fetchTickerNews(ticker)` (`polygon-news.ts`) IS correctly ticker-filtered server-side
(`tickers.any_of=<SYM>` against Benzinga) — that part was already verified working. The gap is one
layer up: Benzinga's own tagging is **co-occurrence, not aboutness** — a broad multi-company story
(an AI-industry product launch, a "stocks with whale activity" listicle, a sector-wide earnings
reaction piece) gets tagged with every megacap ticker it merely *mentions alongside* the one the
story is actually about. `assembleEcosystemArsenal`'s single-name news fold took
`reads.news.items.slice(0, 4)` — the top 4 by raw recency — with no regard for how many OTHER
tickers each item also carried, so when several broad stories happened to be more recent than the
name's own specific coverage, all 4 rendered slots went to noise.

### Evidence

Live `GET /api/market/swing/play-brief?playId=SWING:AMZN&ticker=AMZN&status=CLOSED` (2026-10-08,
~20:55 ET) rendered this "Catalysts & news" headline list, **0 of 4 about AMZN specifically**:

- "Anthropic Announces Claude Docs, Slides, And Design Are Out Of Beta..." (co-tagged `AMZN, GOOG,
  GOOGL`)
- "Anthropic Launches Cyber Mission To Equip Defenders With AI Tools..." (co-tagged with **9**
  tickers: `AMZN, GOOGL, GOOG, MSFT, PANW, CRWD, ACN, ROK, BAH`)
- "Stock Reaction To Samsung And TSMC Earnings Is An Early Indicator..." (co-tagged with **14**
  tickers)
- "Anthropic Is Deepening Its Support For American Scientific Research..." (co-tagged with 4
  tickers)

Queried the raw Benzinga feed directly (`tickers.any_of=AMZN`, bypassing this repo entirely, to
rule out a wiring/caching bug rather than a provider-tagging reality) — confirmed `fetchTickerNews`
IS doing exactly what it claims. The SAME 12-item batch also contained, ranked 8th and 11th by
recency and therefore cut off by `.slice(0, 4)`:

- "Amazon Web Services Announces Golden Age of Science Accelerator..." (co-tagged: **just `AMZN`**)
- "Amazon Introducing All-New Amazon Alexa Tablets With Alexa+ Built In" (co-tagged: **just
  `AMZN`**)

Both are genuinely about Amazon; neither reached the brief. A member or Largo reading this section
for "what's driving AMZN" would have been told about an Anthropic product launch and a
Samsung/TSMC earnings reaction — actively misleading, not merely unhelpful, for a question about a
specific name's catalysts.

### Fix rationale

Added `rankNewsItemsBySpecificity()` — a pure, exported helper that stable-sorts a ticker's news
items ascending by `tickers.length` (fewer co-tagged names = more specific to the one asked about),
preserving the provider's own `published.desc` order as the tiebreak within a specificity tier.
Wired into `assembleEcosystemArsenal`'s single-name news fold, applied **before** `.slice(0, 4)`,
and gated on `scope === "single_name"` only — a market-wide catalyst read (`scope: "index"`) has no
"this ticker" to be specific to, so re-ranking it by tag-count would just reorder by how many
stocks each macro story happens to list, which is noise there, not a correctness improvement
(covered by its own test: `assembleEcosystemArsenal(single_name): market catalysts (no single
ticker) are left in Benzinga's own recency order, not re-ranked`).

Considered and rejected: a fixed tag-count threshold (e.g. "specific" = ≤3 tags) to split items
into two buckets. Real data showed no clean universal cutoff — AMZN's genuinely specific items were
tagged with 1-2 names while CMG's genuinely relevant Starbucks-takeover coverage was tagged with
2-5 — so a relative ascending sort (no magic number, degrades gracefully to recency-only when every
item is equally broad) is the more defensible rule.

**Blast radius — fixed at the shared fold, not the one call site that surfaced it.** Three readers
consume `arsenal.news.headlines` off this same `assembleEcosystemArsenal()` output:
`catalystsSection` (`play-brief-intel.ts`, takes all 4 — the surface that exposed this), and
`ticker-verdict.ts` / `ecosystem-narrative.ts` (each take only `headlines[0]` for their own one-line
news mention). Before this fix, `headlines[0]` for AMZN right now would have been the Anthropic
Claude Docs story — this fix corrects that single quoted headline in both of those surfaces too,
not just the swing brief's list.

An item with no/empty `tickers` (a hand-built test fixture, or a defensive-normalize miss) sorts as
maximally specific (`length ?? 0` treats it as 0) rather than being penalized for metadata it never
had — covered by its own test.

### Evidence that the fix is real (RED → GREEN)

`git stash`-isolated the implementation change (kept the new tests): the two new
`rankNewsItemsBySpecificity` tests failed with `rankNewsItemsBySpecificity is not a function`
(function didn't exist yet) and, after un-stashing, all 36 tests in
`src/lib/bie/ecosystem-context.test.ts` passed, including the new specificity-ranking tests, the
existing fixture tests (unaffected — their fixtures carry no `tickers` field, so the stable sort is
a no-op on them), and the index-scope non-re-ranking test. `npx tsc --noEmit` clean. Full
`npm test`: 15835 pass / 0 fail / 3 skipped (pre-existing skips, unrelated).
