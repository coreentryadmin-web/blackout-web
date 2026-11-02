> **kind:** FINDING

## SPX desk `news_headlines[].title` leaks raw HTML entities to the API/Legacy edition/Largo model — FIXED

| **Status** | FIXED (`fix/spx-news-headlines-html-entity`) |
|---|---|

### Root cause

`src/features/spx/lib/spx-desk.ts`'s `buildSpxDesk()` built `newsHeadlines` by copying the raw
Benzinga article `title` verbatim:

```ts
const newsHeadlines: DeskNewsHeadline[] = (newsRaw ?? [])
  .map((a) => ({
    title: a.title,
    published: a.published,
    tickers: a.tickers ?? [],
  }))
  ...
```

`fetchBenzingaNews()` (`src/lib/providers/polygon.ts`) returns the Benzinga title string
unmodified, which routinely carries HTML entities (`&amp;`, `&#39;`, etc.) straight from the
upstream feed. No `sanitizeFeedText` call existed on this path, so every consumer of
`SpxDeskPayload.news_headlines` — the SPX desk API response, the Night Hawk Legacy edition's
`market_recap.spx_desk.news_headlines`, and Ask Largo's tool-result payload — received titles
like `"Here&#39;s How Much $1000 Invested In W.W. Grainger"` instead of the decoded text.

This is the exact bug *class* fixed hours earlier for a sibling field in the same
`market_recap` blob — `after_hours_catalysts` (PR #7377, `edition-builder.ts`'s
`sanitizedAfterHoursCatalysts`) — but that fix only covered its own call site; `spx-desk.ts`'s
independent, unsanitized copy of the same upstream Benzinga data was never touched.

### Evidence

Live repro found by the `five-engine-largo-cycle-74` workflow's Legacy live-check agent on
production (`blackouttrades.com`), 2026-11-02 — today's Night Hawk Legacy edition
(`recap_only:true`) served:

> `"JP Morgan Maintains Neutral on Floor &amp; Decor Hldgs..."`
> `"Here&#39;s How Much $1000 Invested In W.W. Grainger..."`

in `market_recap.spx_desk.news_headlines[].title`.

Extracted the sanitization into a new pure, exported helper `sanitizedNewsHeadlineBase()` (same
pattern as `sanitizedAfterHoursCatalysts`) and added
`src/features/spx/lib/spx-desk-news-headline-sanitize.test.ts` (3 tests: entity decoding,
published/tickers preserved untouched, empty-title filtering + undefined-input handling).

RED proof (`git stash push -- src/features/spx/lib/spx-desk.ts`, source-only): 3/3 new tests
fail (`sanitizedNewsHeadlineBase is not a function`). GREEN after `git stash pop`: 3/3 pass.
`npx tsc --noEmit` clean. Full `src/features/spx/lib/*.test.ts` suite: 947/947 pass.

### Blast radius

Single function (`buildSpxDesk`'s `newsHeadlines` construction), single call site. Reaches
every consumer of `SpxDeskPayload.news_headlines`: the public SPX desk API route, the Night Hawk
Legacy edition's `market_recap.spx_desk.news_headlines`, and any Ask Largo tool-result payload
that forwards the SPX desk's recap. Not the same code path as `after_hours_catalysts`
(`edition-builder.ts`) — that fix (PR #7377) remains correct and unrelated; this is a second,
independent unsanitized copy of upstream Benzinga data.

### Fix rationale

Extracted the map+filter step into an exported, pure helper (`sanitizedNewsHeadlineBase`) rather
than inlining `sanitizeFeedText` directly in the pipeline, mirroring the exact pattern
`sanitizedAfterHoursCatalysts` established for the sibling fix — keeps the function unit-testable
in isolation from `buildSpxDesk`'s provider-fetch pipeline (which pulls in a transitive
`server-only` import), and gives any future audit a single, grep-able call site to check rather
than an inline anonymous map. The existing `.sort()`/`.slice(0, 10)` relevance-ranking logic is
left untouched, operating on the now-sanitized array.
