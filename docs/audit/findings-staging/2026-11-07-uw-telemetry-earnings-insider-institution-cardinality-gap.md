> **kind:** FINDING

## `endpointTemplate()`'s UW per-ticker fix (#7500) missed `/api/earnings`, `/api/insider`, `/api/institution` — same unbounded `endpointStats` leak, three more real call sites — FIXED

| | |
|---|---|
| **Status** | Fixed |
| **Severity** | P3 (telemetry-only; in-memory `endpointStats` Map bloat + noisy admin dashboard rows, not a member-facing data-correctness bug) |
| **Files** | `src/lib/api-telemetry.ts`, `src/lib/api-telemetry.test.ts` |

### Symptom

`endpointTemplate()` (`src/lib/api-telemetry.ts`) collapses per-symbol Unusual Whales paths into
one bounded `endpointStats` key so the in-memory Map does not grow one permanent row per ticker
(audit §3.1, fixed for `stock|darkpool|shorts|etfs|lit-flow|seasonality|companies` in #7500). Three
more real UW per-entity path shapes, read straight off `src/lib/providers/unusual-whales.ts`'s own
`uwGetSafe` call sites, were never covered by that fix and leaked exactly the same way:

- `/api/earnings/{ticker}` — `fetchUwTickerEarningsHistory` (line 2610) and
  `fetchUwTickerNextEarnings` (line 2648)
- `/api/insider/{ticker}` — `fetchUwInsiderTicker` (line 2683)
- `/api/institution/{name}/activity|holdings|ownership` — `fetchUwInstitutionActivity` (2723),
  `fetchUwInstitutionHoldings` (2730), `fetchUwInstitutionOwnership` (2742)

None of the existing regex rules in `endpointTemplate()` matched any of these three prefixes
(verified by reading the function's full rule list before writing the fix — `/ticker/`,
`/tickers/`, `/indicators/.../` are all Polygon-shaped and never touch `/api/...`), so every
distinct ticker fetched through `fetchUwTickerEarningsHistory`/`fetchUwTickerNextEarnings`/
`fetchUwInsiderTicker`, and every distinct institution name fetched through
`fetchUwInstitutionActivity`/`Holdings`/`Ownership`, leaked its own permanent `endpointStats` row
— the exact cardinality leak #7500's own header says the function exists to prevent, for a
provider (`unusual_whales`) whose path shape #7500 only partially covered. Institution names are
free-text (not a bounded ticker universe), so this path carries materially higher cardinality risk
than the ticker-keyed ones.

### Root cause

`endpointTemplate()`'s UW block (added in #7500) is a positive allowlist of specific path prefixes
(`/^\/api\/(stock|darkpool|shorts|etfs|lit-flow|seasonality|companies)\/.../`) rather than a
general `/api/{anything}/{entity}` rule — a deliberate, conservative design (it avoids
accidentally templating a genuinely fixed path like `/api/market/market-tide`), but it means every
new UW per-entity path shape has to be added explicitly. #7500 enumerated seven; three more exist
in the same source file and were missed.

### Evidence

Confirmed against the real source before writing anything (not taking the round-386 claim on
faith):

```
$ grep -n "api/earnings\|api/insider\|api/institution" src/lib/providers/unusual-whales.ts
2610:  const data = await uwGetSafe<unknown>(`/api/earnings/${safeTicker(ticker)}`, { limit });
2648:  const data = await uwGetSafe<unknown>(`/api/earnings/${safeTicker(ticker)}`, {});
2683:  const data = await uwGetSafe<unknown>(`/api/insider/${sym(ticker)}`, { limit: ... });
2723:  const data = await uwGetSafe<unknown>(`/api/institution/${encodeURIComponent(name)}/activity`, ...);
2730:  const data = await uwGetSafe<unknown>(`/api/institution/${encodeURIComponent(name)}/holdings`, ...);
2742:  const data = await uwGetSafe<unknown>(`/api/institution/${sym(ticker)}/ownership`, ...);
```

Also confirmed the fixed, non-symbol siblings that must NOT be templated away (they are
meaningful, low-cardinality endpoints in their own right, not per-entity leaks):
`/api/earnings/premarket` (`fetchUwEarningsPremarket`), `/api/earnings/afterhours`
(`fetchUwEarningsAfterhours`), `/api/insider/transactions` (`fetchUwInsiderTransactions`, which
despite its name takes NO ticker path segment — see its own 2026-09-12 comment on the `ticker`
query param being silently ignored), and the unrelated plural `/api/institutions/latest_filings`
(`fetchUwInstitutionsLatestFilings`).

Checked `encodeURIComponent`'s output shape before reusing the existing `[^/?]+` single-segment
regex pattern for institution names, per the round's own caution that free-text names might encode
differently than tickers:

```
$ node -e 'console.log(encodeURIComponent("BlackRock/Fund A?"))'
BlackRock%2FFund%20A%3F
```

`encodeURIComponent` itself percent-encodes `/` and `?` (to `%2F`/`%3F`), so an encoded institution
name segment can never contain a literal `/` or `?` — the `[^/?]+` pattern already used throughout
this function is safe to reuse here unchanged; no new character-class concern.

RED→GREEN, stashing only the `api-telemetry.ts` fix (keeping the new tests) and re-running
`npx tsx --experimental-test-module-mocks --test src/lib/api-telemetry.test.ts`:
- **Pre-fix:** 3 failures — the new `endpointTemplate` assertions fail, and the new
  bounded-cardinality test fails with `'expected the one templated earnings key'` (every one of
  the 300 synthetic per-ticker earnings calls got its own distinct key instead of one templated
  key). The fix's own test addition also incidentally exposed the EXISTING 600-distinct-ticker
  stock test failing in the same run (shared module-level `endpointStats` Map across tests in one
  file — a pre-existing test-ordering/shared-state property of this file, not something this fix
  introduced; confirmed it passes cleanly on its own and in the full suite).
- **Post-fix:** all 8 tests in the file pass, including the two new ones.

### Blast radius

Single file, single function. No other call site reads `endpointTemplate()`'s output format in a
way that depends on omitting these three prefixes — `buildEventDetail()` and
`getApiTelemetrySnapshot()` both just key off whatever `endpointTemplate()` returns, so collapsing
more paths only shrinks `endpointStats` cardinality further, the same shape of change #7500 already
made for the other seven prefixes. The admin dashboard that reads `endpointStats` (de-cardinalized
per the function's own header) benefits the same way: fewer, more meaningful rows instead of one
per distinct ticker/institution-name ever fetched.

### Fix rationale

Added three new `.replace()` rules to `endpointTemplate()`, following the exact pattern and
in-code comment style already established by #7500's block and the `/api/market/{sym}/sector-
tide|etf-tide` two-segment rule immediately below it:

1. `/api/earnings/{ticker}` → `/api/earnings/:sym`, with a negative lookahead excluding the fixed
   `premarket`/`afterhours` siblings (bounded with `(?:\/|$)` rather than a bare `$` anchor, in
   case either ever grows a trailing sub-path).
2. `/api/insider/{ticker}` → `/api/insider/:sym`, same negative-lookahead shape excluding
   `transactions`.
3. `/api/institution/{name}/activity|holdings|ownership` → `/api/institution/:sym/$1`, a
   two-segment capture mirroring the existing `/api/market/{sym}/sector-tide|etf-tide` rule
   immediately below it. Deliberately does not touch the plural `/api/institutions/...` prefix
   (a different literal string, already excluded by construction — no extra guard needed).

Deliberately left unchanged: `fetchUwInstitutionOwnership`'s own pre-existing naming
inconsistency (it takes a ticker via `sym()` despite its JSDoc/call shape implying an institution
name) — out of scope for a telemetry-key fix, noted inline instead.

### Test

`src/lib/api-telemetry.test.ts` — added `endpointTemplate: collapses UW per-ticker earnings/
insider/institution paths without swallowing their fixed siblings` and `endpointStats stays bounded
for UW earnings/insider/institution paths — distinct-entity calls collapse to ONE templated key
each`. `npx tsc --noEmit` clean; full `npm test` run in background, confirmed green before push.
