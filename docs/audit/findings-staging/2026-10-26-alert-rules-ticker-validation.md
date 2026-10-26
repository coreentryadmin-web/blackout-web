> **kind:** FINDING

## Vector/HELIX alert-rules routes accepted an unbounded, unvalidated ticker string — FIXED

| | |
|---|---|
| **Status** | FIXED — PR (this branch) |
| **Severity** | P3 — input-validation gap, authenticated/premium-gated, not a security exploit |

### Root cause

`src/app/api/vector/alerts/rules/route.ts` and its sibling `src/app/api/helix/alerts/rules/route.ts`
each rolled their own local `normalizeTicker()`:

```ts
function normalizeTicker(raw: string | null | undefined): string {
  return String(raw ?? "").trim().toUpperCase();
}
```

This only trims and uppercases — it never checks length or character set. Every other route in
the Vector family (19 of them: `walls`, `flow`, `gex-heatmap`, `max-pain`, `bars`, `daily-bars`,
`4h-bars`, `daily-regime`, `prior-day`, `expected-move`, `pin-forecast`, `wall-history`,
`play-bie`, `contract-picks`, `contract-picks/live`, `rail-bootstrap`, `stream`, `gex-ladder`,
`gex-positioning`) gates a caller-supplied ticker through `isVectorTickerAllowed()`
(`features/vector/lib/vector-ticker.ts`, regex `^[A-Z0-9.\-]{1,8}$`) before it reaches a provider
call or a DB query — exactly the guard this pair of routes was missing. The Helix route's own
header comment says its "auth/shape mirrors `/api/vector/alerts/rules/route.ts`", so it inherited
the identical gap by direct copy.

### Evidence

- `vector_alert_rules.ticker` and `helix_alert_rules.ticker` are both `TEXT NOT NULL` with no
  length constraint at the schema level (`ensureVectorAlertRulesTable` /
  `ensureHelixAlertRulesTable`). `ticker` is part of the Helix table's primary key
  (`PRIMARY KEY (user_id, ticker)`).
- A premium-authenticated caller could `PUT /api/vector/alerts/rules` or
  `PUT /api/helix/alerts/rules` with `{ "ticker": "A".repeat(100000), ... }` and it would persist
  unmodified — confirmed by reading the un-patched code path (no guard between `body.ticker` and
  the `INSERT`/`UPSERT`).
- Grep confirms every other Vector route under `src/app/api/market/vector/**` imports and calls
  `isVectorTickerAllowed` from the shared module; these two alert-rules routes were the only two
  reachable, non-cron, ticker-keyed routes in the family that didn't.

### Blast radius

- **Functional, not just storage bloat**: `/api/cron/vector-alerts` evaluates every persisted
  Vector rule by ticker against live wall/flip data; a garbage ticker stored via this gap would
  make that member's rule permanently un-evaluable (never matches a real market symbol), silently,
  every cron tick, with no error surfaced anywhere.
- Same failure shape for Helix's inline evaluation hook (`notifyHelixAlertSubscribers`, called
  from `flow-persist.ts` on every newly-persisted print) — a garbage-ticker rule can never match a
  real print's `ticker`.
- Two call sites, same root cause, same fix pattern — both covered in this PR.

### Fix

- `src/app/api/vector/alerts/rules/route.ts`: replaced the local `normalizeTicker` with the
  existing `isVectorTickerAllowed` / `normalizeVectorTicker` pair already used everywhere else in
  the Vector family. Applied to GET (optional ticker filter — validated only when present, same
  as `walls`/`flow`/etc.), PUT, and DELETE; invalid ticker now returns `400` instead of silently
  persisting.
- `src/features/helix/lib/helix-alert-rules-core.ts`: added a local `isHelixTickerAllowed` guard
  (same regex as Vector's, kept as a local copy rather than a cross-feature import so this module
  stays the plain, dependency-free one its own header documents) and re-exported it from
  `helix-alert-rules-db.ts`. Wired into `src/app/api/helix/alerts/rules/route.ts`'s GET/PUT/DELETE.
- Existing stored rows with an already-malformed ticker (if any) are unaffected — this only gates
  new writes and ticker-scoped reads, matching every sibling Vector route's existing behavior.

### Tests

- `src/features/helix/lib/helix-alert-rules-core.test.ts`: new cases for `isHelixTickerAllowed`
  (accepts well-formed symbols, rejects over-length strings including the exact `"A".repeat(9)`/
  `"A".repeat(10000)` regression case, rejects empty/whitespace/injection-shaped strings).
- `src/app/api/vector/alerts/rules/route.test.ts`: new source-level assertion that all three
  handlers call `isVectorTickerAllowed` (same grep-based style the file's existing tests use).
- `npx tsx --experimental-test-module-mocks --test` on the four affected test files: 34/34 pass.
- `npx eslint` on all changed files: clean. `npx tsc --noEmit`: clean.
