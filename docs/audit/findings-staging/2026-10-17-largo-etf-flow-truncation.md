> **kind:** FINDING

## Largo `get_etf_flow` live-truncated at ~14x the transport cap — two unbounded UW time series merged with zero fitting — FIXED

| **Status** | Fixed (`fitEtfSeriesForModel` in `src/lib/largo/market-data-fits.ts`, wired into `src/lib/largo/run-tool.ts`) |
|---|---|

**Found via:** this session's standing Ask Largo deep-dive. The same live CloudWatch sweep of
`/ecs/blackout-production` (10:45-11:40 UTC 2026-10-17) that found `get_earnings` (#6130),
`get_platform_snapshot` (#6132) and `get_wall_dynamics` (#6133) truncated also flagged:
```
get_etf_flow TRUNCATED 224052/16000
```
— ~14x the 16k transport cap, named at the time as "not yet fixed... natural next step for a
future cycle" in the `get_wall_dynamics` finding.

**Root cause.** `run-tool.ts`'s `get_etf_flow` case merged three fetches with zero fitting of any
kind:
```ts
const [quote, inOut, tide] = await Promise.all([
  fetchStockSnapshot(etf), fetchUwEtfInOutflow(etf), fetchUwEtfTide(etf),
]);
return { etf, quote, in_outflow: inOut, etf_tide: tide };
```
Both `fetchUwEtfInOutflow` and `fetchUwEtfTide` (`src/lib/providers/unusual-whales.ts`) pass the
raw UW response straight through via `uwGetSafe<unknown>(...)` with **no row limit of any kind** —
unlike most sibling UW fetchers, neither caps rows at the fetch layer. Measured live 2026-10-17
against the real endpoints (`inspect-etf-shapes.mjs`, IWM):
- `GET /api/etfs/{etf}/in-outflow` → `{ data: [...], years: [...] }`, **721 daily rows**, ~144
  bytes/row (years of history).
- `GET /api/market/{etf}/etf-tide` → `{ data: [...], date }`, **390 intraday rows**, ~151
  bytes/row (one session's worth of 1-minute ticks).

A trader asking about ETF flow needs a recent window of either series, not the full history — same
bug shape as `get_earnings`/`get_platform_snapshot`/`get_wall_dynamics`: an unbounded sub-field
with no row cap, serialized straight through to the model.

**The two series sort in OPPOSITE directions — verified live, not assumed** (`check-etf-ordering.mjs`):
```
in-outflow first 3 dates: [2026-10-16, 2026-10-15, 2026-10-14]   (newest-first)
etf-tide first 3 timestamps: [...T09:30, ...T09:31, ...T09:32]   (oldest-first, market open -> now)
```
`in-outflow` is a daily history (today, yesterday, ...); `etf-tide` is today's own intraday walk
(market open forward). Naively keeping "the first N" of both would silently serve the model the
**stalest** slice of whichever series sorts oldest-first — `etf-tide`'s first 30 rows are the
market's first half-hour, not the latest tide reading, which is exactly the reading a trader asking
"what's ETF flow doing right now" wants.

**Fix.** New `fitEtfSeriesForModel(raw, base, {maxShown, newestFirst})` in
`src/lib/largo/market-data-fits.ts` — a general UW-time-series fitter: reverses an oldest-first
series before fitting so "most recent" always means the same thing to the caller regardless of
which way UW sorted it, then fits via the existing `fitRowsToBudget` threaded against a growing
`base` (the same sequential base-threading pattern used in the three prior fixes from this sweep):
```ts
const base = { etf, quote };
const fittedInOut = fitEtfSeriesForModel(inOutRaw, base, { maxShown: 30, newestFirst: true });
const baseWithInOut = { ...base, in_outflow: fittedInOut };
const fittedTide = fitEtfSeriesForModel(tideRaw, baseWithInOut, { maxShown: 30, newestFirst: false });
return { ...baseWithInOut, etf_tide: fittedTide };
```
Non-row metadata on each response (`years` on in-outflow, `date` on etf-tide) is preserved
alongside the fitted rows rather than dropped. Each field reports `_shown`/`_total`/`_truncated` so
the model can tell a 30-row window from a 721-row universe, per this module's existing convention.

**Why fit `in_outflow` before `etf_tide`, not the reverse:** arbitrary — both are independently
capped at `maxShown: 30`, and threading `in_outflow`'s fitted result into `etf_tide`'s base (rather
than fitting both against the bare `{etf, quote}` base in isolation) is what guarantees the combined
envelope can never exceed budget regardless of which field happens to be larger for a given ETF.

**Tests.** New tests in `src/lib/largo/market-data-fits.test.ts` (8 new, 32 total in the file):
a pre-fix sanity reproduction using the measured real live row counts/sizes (721 @ 144B, 390 @
151B) confirming the old unconditional-merge shape exceeds the cap; `newestFirst=true` keeps
`in_outflow`'s own order untouched; `newestFirst=false` reverses `etf_tide` so the kept window is
provably the END of the raw oldest-first array (not the start); a full sequential base-threading
test at measured real-world size staying under the transport cap; under-cap passthrough; empty-data
handling; non-object-raw passthrough. RED→GREEN proven via `git stash` of `market-data-fits.ts`
alone: 6 of the 7 new tests fail without the fix (the 7th, a pre-fix cap-overflow sanity check,
needs no new code and passes either way), all 7 pass once the fix is restored. Full `src/lib/largo`
suite: 1361/1361 pass. `tsc --noEmit`: clean.

**Blast radius:** `get_etf_flow` is the only caller of `fetchUwEtfInOutflow`/`fetchUwEtfTide` in the
Largo tool surface (verified via grep) — no other consumer touched. This closes out all four known
live Largo truncation instances from this session's CloudWatch sweep (`get_earnings` #6130,
`get_platform_snapshot` #6132, `get_wall_dynamics` #6133, `get_etf_flow` this fix); `get_options_flow`'s
instances from the same sweep were determined stale, already fixed independently by #6111.
