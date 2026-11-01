> **kind:** FINDING

## Vector `fetchVectorEmbedFastSeed` skipped the oracle rail-bootstrap for a non-canonical ticker — FIXED

| | |
|---|---|
| **Area** | Vector — `src/features/vector/lib/vector-client-seed.ts` |
| **Status** | FIXED (PR `fix/vector-embed-fast-seed-oracle-ticker-case`) |
| **Severity** | P3 — latent, no live-traffic path currently exercises it |

### Root cause

`fetchVectorEmbedFastSeed(ticker)` decided whether to fetch the oracle-only
`/api/market/vector/rail-bootstrap` route with:

```ts
VECTOR_ORACLE_TICKERS.has(ticker)
```

`VECTOR_ORACLE_TICKERS` is `new Set(["SPX", "SPY", "QQQ"])` — canonical
uppercase. Every sibling call site that consults this same Set normalizes the
ticker FIRST via `normalizeVectorTicker()`:

- `vector-cadence.ts:96`
- `vector-snapshot.ts:185`
- `vector-wall-sample.ts:83`
- `vector-wall-sample-server.ts:72`
- `vector-rail-bootstrap.ts:34`

`fetchVectorEmbedFastSeed` was the one call site that compared the raw,
caller-supplied `ticker` string directly. `normalizeVectorTicker` exists
specifically to uppercase the ticker and strip a Polygon-style `"I:"` index
prefix (`"I:SPX"` → `"SPX"`) — exactly the two input shapes that would make a
genuinely-oracle ticker fail a raw `Set.has()` check. A lowercase `"spy"` or a
deep-linked `"I:SPX"` would silently skip the rail-bootstrap fetch, degrading
the "fast first paint" bead rail to empty on exactly the tickers this fast
path exists for (SPX/SPY/QQQ).

This is the same bug shape the repo already fixed once for
`normalizeDteHorizon` (see that function's own doc comment: the old
exact-match check silently re-scoped `"0DTE"` to the default because callers
naturally pass uppercase UI labels) — now found repeated at a sibling call
site in the same file family.

### Evidence (RED → GREEN)

Added `src/features/vector/lib/vector-client-seed.test.ts`, mocking
`globalThis.fetch` and recording every URL `fetchVectorEmbedFastSeed` hits:

- **Pre-fix (RED):** `fetchVectorEmbedFastSeed("spy")` and
  `fetchVectorEmbedFastSeed("I:SPX")` both failed to ever request
  `/rail-bootstrap` (2 failing assertions).
- **Post-fix (GREEN):** both correctly hit `/rail-bootstrap`; a genuine
  non-oracle ticker (`"nvda"`) still correctly skips it (3/3 passing).

Also verified: `npx tsc --noEmit` clean; full
`src/features/vector/lib/*.test.ts` suite 1326/1326 passing (no regression).

### Blast radius

`fetchVectorEmbedFastSeed` has exactly two call sites today:

- `SpxVectorEmbed.tsx` — hardcodes `"SPX"` (always canonical).
- `VectorPageClient.tsx` — receives `bootstrapTicker`, which is already
  `normalizeVectorTicker(rawTicker)`-normalized server-side by
  `src/app/(site)/vector/page.tsx` before it ever reaches the client
  component.

So today's production traffic never actually reaches the broken branch — this
closes a latent landmine (a differently-cased prop, or a raw `"I:"`-prefixed
deep-link ticker passed straight through by a future caller) before it causes
a live incident, rather than waiting to rediscover it the way
`normalizeDteHorizon`'s bug was first found.

### Fix

Normalize once into a `normalizedTicker` local and use it only for the Set
membership check, mirroring the existing pattern elsewhere in this file
family. The URL-building `t = encodeURIComponent(ticker)` is left alone — the
API routes already normalize the ticker server-side from the raw query
string, so touching that path would be unnecessary scope creep.
