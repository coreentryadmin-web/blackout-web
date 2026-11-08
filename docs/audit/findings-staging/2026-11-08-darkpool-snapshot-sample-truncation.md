> **kind:** FINDING

## `fetchUwDarkPool`/`fetchUwDarkPoolMarketWide` presented a UW page-capped SAMPLE's count/premium as today's definite total — FIXED

| | |
|---|---|
| **Area** | `src/lib/providers/unusual-whales.ts` — the server-side dark-pool `DarkPoolSnapshot` builder consumed by the Meridian Earnings Intel panel ("today's session prints" `total_premium`/`detail`), the HELIX desk dark-pool fallback (`spx-desk.ts`), the GEX heatmap dark-pool overlay, Night Hawk's dossier text, and Largo's `dark_pool` tool answer |
| **Status** | FIXED |
| **Files** | `src/lib/providers/unusual-whales.ts`, `src/lib/providers/unusual-whales.test.ts` |

### Root cause

`fetchUwDarkPool(ticker, opts)` asks UW's `GET /api/darkpool/{ticker}` for at most
`Math.min(opts?.limit ?? 20, 100)` rows, then filters those raw rows down to the ones dated
`today` (ET) and sums their premium. The resulting `total_premium`/`call_premium`/`put_premium`
and the `detail` headline (`"${prints.length} print(s) | $${totalM}M"`) were derived directly from
that *page-capped* sample — with no signal, anywhere in the object, that the sample might not
cover the whole session:

```ts
const rows = extractRows(data);               // at most `limit` rows (default 20, cap 100)
...
for (const row of rows) { /* filter to today, accumulate total/callPrem/putPrem */ }
...
return {
  total_premium: total,                        // <-- can silently exclude earlier-today prints
  detail: prints.length ? `${prints.length} print(s) | $${(total/1e6).toFixed(2)}M` : "No prints today",
};
```

`fetchUwDarkPoolMarketWide` (the `/api/darkpool/recent` sibling, used as the desk fallback when a
ticker has no equity dark-pool entries, e.g. SPX) had the byte-for-byte identical shape over a
different raw fetch.

`fetchUwDarkPoolRecent`'s own name — and the convention every other "recent" fetcher in this
codebase follows (`fetchRecentFlows`, `/api/darkpool/recent`) — means UW returns newest-trade-first.
So for any ticker whose real dark-pool activity for the day exceeds the requested page size (the
default call sites pass `limit: 20`; `dossier.ts` and `largo/run-tool.ts` pass no `opts` at all,
also defaulting to 20), the fetch silently returns only the MOST RECENT `limit` prints — dropping
every earlier-today print from the sum entirely, with no error and no visible sign anything was
capped. This is the identical "total capped at sample-query LIMIT" shape already found and fixed
three times this audit cycle: `error-sink.ts`'s `countAuthFailures` (#7574), `admin-gex-health.ts`'s
`summarizeRegimeEvents` (#7575), and `discord-eod-recap.ts`'s HELIX/dark-pool EOD recap headlines
(#7576) — one layer removed here, since the cap is on an *external provider's* own page size rather
than one of our own `LIMIT`-bounded SQL queries, so there is no cheap unbounded `COUNT(*)` to fall
back on the way #7575 did.

The claim this produces is load-bearing: `shapeMeridianDarkPool` (`meridian-earnings-intel-core.ts`)
renders `total_premium_label` on the Meridian Earnings Intel panel as the definite day total
("today's session prints"), and the same `detail`/`total_premium` reach Night Hawk's dossier text
and Largo's `dark_pool` tool answer unchanged.

### Evidence (RED → GREEN)

Added `darkPoolSampleMayBeTruncated(rawRows, requestedLimit, today)` — a pure helper that decides,
from the raw (pre-filter) row set, whether today's total may be an undercount: a response SHORTER
than the requested limit proves nothing more exists upstream (never flagged); a FULL-cap response
whose OLDEST returned row is still dated `today` proves the cutoff landed mid-session (flagged); a
full-cap response whose oldest row is from a PRIOR day proves every today-row already sorted before
it, so the day is fully captured regardless of the cap (not flagged); a row with no parseable
timestamp is treated as the worst case (flagged), matching this file's existing "absence of
evidence is not evidence of absence" discipline for the `uwGetSafe`-null-vs-empty case a few lines
above it. A second pure helper, `darkPoolDetailLine(count, total, truncated)`, appends `+` to BOTH
the count and the dollar figure when truncated, so the headline reads as the honest lower bound it
is rather than a definite total.

Added 6 new tests to `unusual-whales.test.ts`. RED confirmed by stashing only
`unusual-whales.ts` (keeping the new tests): `npx tsx --experimental-test-module-mocks --test
src/lib/providers/unusual-whales.test.ts` fails 6/40 — the 5 new direct-logic tests (the two
exports didn't exist pre-fix) plus a source-wiring test asserting both `fetchUwDarkPool` and
`fetchUwDarkPoolMarketWide` route their `detail` through the shared formatter and no longer inline
the old un-truncation-aware template. GREEN with the fix restored: 40/40 pass. Also ran the
downstream consumer test files unchanged (`meridian-earnings-intel-core.test.ts`,
`darkpool-recent-cache.test.ts`, `uw-lit-dark-ratio.test.ts`) — 39/39 pass, confirming zero
behavior change to any fixture that constructs a `DarkPoolSnapshot` by hand rather than through
these two fetchers. `npx tsc --noEmit` clean.

### Blast radius

Both call sites sharing the exact bug shape (`fetchUwDarkPool`, `fetchUwDarkPoolMarketWide`) are
fixed identically via the two shared pure helpers, so the two cannot drift into different wording
for the same condition. The sibling WS-path normalizer in the same file,
`normalizeDarkPoolWsPayload`, is **not** affected and was deliberately left alone — it processes
whatever a single live WS frame actually contained, with no `limit`/page-size parameter at all, so
there is no sample cap to disclose.

No consumer's type or call signature changed — `DarkPoolSnapshot`'s shape is untouched, only the
`detail` string's content on the (previously rare, now disclosed) truncated case. `shapeMeridianDarkPool`,
the GEX heatmap overlay, `spx-desk.ts`'s dark-pool fallback, the Night Hawk dossier, and Largo's
`dark_pool` tool all pass `detail` straight through verbatim, so every one of them inherits the
honest "+"-marked lower bound automatically with no code change on their side. `total_premium`
itself is intentionally left as-is (still the real sum of whatever was fetched) — fetching more
than the UW page cap to produce a truly exhaustive total is a larger, separate change (repeated
upstream pagination against a rate-limited external provider) explicitly out of scope for this fix,
which only makes the EXISTING number honest about its own limits rather than attempting to compute
a bigger one.

### Fix rationale

Disclosure via a `+` suffix (the same convention #7576 used for the Discord EOD recap headlines)
rather than chasing a true unbounded total: unlike #7575's own-database case, there is no cheap
`COUNT(*)` available against an external, rate-limited UW endpoint, and paginating through it on
every call would multiply outbound UW requests for a field most tickers on most days never actually
hit the cap. The pure helpers are extracted and exported specifically so the invariant is testable
without a live network/Redis round trip — `fetchUwDarkPool` itself stays wrapped in `uwCacheGet` and
is not directly unit-testable, the same constraint the file's neighboring null-vs-empty test already
works around with a source-text guard.
