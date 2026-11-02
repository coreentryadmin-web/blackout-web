> **kind:** FINDING

## Night Hawk Legacy `after_hours_catalysts` ships raw HTML-entity-encoded titles to both the API and the Ask Largo model — FIXED

| **Status** | FIXED (`fix/legacy-after-hours-catalysts-html-entities`) |
|---|---|

### Root cause

`src/features/nighthawk/lib/edition-builder.ts` builds the published edition's
`market_recap.after_hours_catalysts` directly from the raw Benzinga catalyst array at two call
sites (the recap-only path and the full-publish path):

```ts
after_hours_catalysts: ctx.after_hours_catalysts?.slice(0, 10) ?? [],
```

`ctx.after_hours_catalysts` comes straight from `fetchBenzingaAfterHoursMovers`/
`fetchBenzingaCatalysts` (`src/lib/providers/polygon.ts`), which stores `title: a.title` verbatim
from the Benzinga API with no entity decoding. This raw array reaches two places unsanitized:

1. The published JSON API response (`GET /api/market/nighthawk/edition`), where a title like
   `"12 Consumer Discretionary Stocks Moving In Friday&#39;s After-Market Session"` is served with
   the `&#39;` left undecoded.
2. The Ask Largo model's tool context: `src/lib/largo/nighthawk-edition-for-model.ts`'s
   `compactNightHawkEditionForModel()` keeps every `market_recap` key not in
   `DELEGATED_RECAP_BLOBS` (`{spx_desk, flow_tape}`) — `after_hours_catalysts` is not delegated, so
   it passes through unmodified — and `src/lib/largo/run-tool.ts`'s `get_nighthawk_edition` handler
   returns that object directly as the tool_result the model reads.

The SAME source array already has a correctly-sanitized sibling: `format.ts`'s `buildMarketRecap`
(line 310) already calls `sanitizeFeedText(c.title ?? "")` when building the rendered
`catalysts`/`recap_summary` strings — live-confirmed the edition's top-level `catalysts` field
already shows the clean, decoded text. The structured `after_hours_catalysts` array was simply
never run through the same sanitizer when it was added to `market_recap`.

### Evidence

Live `GET /api/market/nighthawk/edition` (2026-11-02 recap-only edition, found by the
five-engine-largo-cycle-73 workflow's `live:legacy` live check) returned titles like:

- `"12 Consumer Discretionary Stocks Moving In Friday&#39;s After-Market Session"`
- `"Alphabet Posts Worst Week Since 2011, Intel Suffers Record Crash as Warsh Sees &#39;Cracks&#39;"`

Regression test (`src/features/nighthawk/lib/edition-builder-after-hours-sanitize.test.ts`), RED
before the fix (`sanitizedAfterHoursCatalysts is not a function` — 3/3 fail, proven via
`git stash`), GREEN after (3/3 pass): decodes `&#39;`/`&#8212;` etc., preserves `channel`/`type`/
`published`, caps at 10, handles `undefined`. `npx tsc --noEmit` clean. Full related-suite re-run
(`format.test.ts`, the three `edition-builder-*.test.ts` files, `nighthawk-edition-for-model.test.ts`,
`discovery-quality.test.ts`, `play-critic.test.ts`, `candidates.test.ts`): 101/101 pass.

### Blast radius

Both `market_recap.after_hours_catalysts` call sites in `edition-builder.ts` (the recap-only early
return and the full-publish path) share the identical unsanitized expression — fixed at both.
`candidates.ts`'s own consumer of `ctx.after_hours_catalysts` (ticker extraction via regex on the
raw title, for discovery scoring) reads the pipeline's `ctx` object directly, not the published
envelope copy this fix touches, so it is unaffected — confirmed the ticker-extraction regex
(`/\b([A-Z]{1,5})\b/g`) cares only about uppercase letter runs, which entity decoding does not
disturb either way. The member-facing Legacy board UI never renders `after_hours_catalysts` at all
today, so the current exposure was (a) raw API/JSON consumers and (b) Ask Largo quoting these
titles verbatim to a member who asks about after-hours catalysts.

### Fix rationale

Added `sanitizedAfterHoursCatalysts()` (exported pure helper in `edition-builder.ts`) that maps
`sanitizeFeedText` over each catalyst's `title` while preserving `channel`/`type`/`published`
untouched, mirroring exactly what `format.ts`'s `buildMarketRecap` already does for the rendered
string fields — same sanitizer, same LARGO-6 prompt-injection hardening, just applied to the
structured array that was missed. Applied at both `edition-builder.ts` call sites. Left
`candidates.ts`'s raw-title ticker extraction untouched since it operates on a different copy of
the data (pre-publish `ctx`, not the published envelope) and sanitization would not change its
regex match set anyway.
