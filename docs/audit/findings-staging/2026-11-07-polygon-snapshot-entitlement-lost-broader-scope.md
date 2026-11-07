> **kind:** FINDING

## 2026-11-07 — Polygon/Massive real-time `/v3/snapshot` + `/v2/snapshot/.../gainers|losers` ALSO entitlement-lost — scope of the 2026-11-07 billing event is broader than first documented — NOT fixable from code — NEEDS OPERATOR ACTION (ACCOUNT/BILLING)

| **Status** | NOT A CODE BUG — no PR fixes this; corrects the scope of the earlier same-day Benzinga finding, documented for the record |
| --- | --- |

### Area

`src/lib/providers/options-snapshot.ts`'s `fetchOptionsUnifiedSnapshot` — the shared real-time
options/stock snapshot fetcher behind **every** live-mark consumer platform-wide: Night Hawk
Legacy (`legacy-marks`), Night Hawk 0DTE, Vector, Swing, Banger, and the GEX heatmap
(`gex-heatmap`). Also affects `fetchMarketMovers`'s `/v2/snapshot/locale/us/markets/stocks/{gainers,losers}`
calls used by Legacy's next-day discovery pass.

### Root cause

Earlier today, `docs/audit/findings-staging/2026-11-07-benzinga-entitlement-lost.md` (merged in
PR #7541) documented that `GET {POLYGON_API_BASE}/benzinga/v2/news` started 403ing with
`{"status":"NOT_AUTHORIZED","message":"You are not entitled to this data. Please upgrade your
plan at https://massive.com/pricing"}`, and that finding's own isolation check confirmed
grouped-daily and `/v3/reference/*` endpoints were unaffected on the same key — correctly scoping
that finding to Benzinga news specifically.

A later same-day live correctness sweep (the standing 5-engine monitor's Night Hawk Legacy check)
found that **every currently-OPEN Legacy position shows zero live marks**, and root-caused it past
the app code into the same provider-entitlement failure mode, but on a different, higher-blast-
radius endpoint family: `GET /v3/snapshot` (the real-time unified options/stock snapshot endpoint)
now **also** returns the identical 403 `NOT_AUTHORIZED` body. Independently re-verified in this
session directly against `api.massive.com` with the real `POLYGON_API_KEY`:

```
GET /v3/snapshot?ticker.any_of=O:DASH261113C00205000&apiKey=KEY        -> 403 NOT_AUTHORIZED
GET /v2/snapshot/locale/us/markets/stocks/gainers?apiKey=KEY           -> 403 NOT_AUTHORIZED
GET /v3/reference/options/contracts?ticker=DASH&limit=1&apiKey=KEY     -> 200 OK   (same key)
GET /v2/aggs/grouped/locale/us/market/stocks/2026-11-06?apiKey=KEY     -> 200 OK   (same key)
```

This is the **same class of account/billing entitlement loss** as the Benzinga finding — not a
dead key (reference/grouped-daily endpoints on the same key are healthy) and not an app code bug
(every consumer already degrades honestly) — but it is a **materially larger surface** than the
earlier finding recorded: it covers the real-time snapshot tier used by essentially every live
mark across the platform, not just Benzinga news/catalysts.

### Evidence

1. **Night Hawk Legacy, live reproduction.** 8 independently-confirmed-OPEN Legacy positions
   (MGNI 11/06, DASH 11/05, TLN 11/04, CVNA/ABT/SYK/AMD/INTU 11/03 — each confirmed OPEN via
   `GET /api/nighthawk/play-status` `status=CONFIRMED`) all show `GET
   /api/market/nighthawk/legacy-marks` returning `{"available":true,"marks":[]}` — zero rows, for
   every OCC, across 4 separate editions. A direct in-process call to the real production
   `fetchOptionsUnifiedSnapshot` (imported live via `tsx`) with the real key logged `[polygon-
   snapshot] fetch 403 Forbidden from api.massive.com /v3/snapshot` and returned an empty `Map`.
2. **Independent corroboration from an unrelated endpoint.** `GET /api/market/gex-heatmap?ticker=SPY`
   (live, authenticated) currently returns `available:false`, `spot:0`,
   `"No options-chain data for this ticker — dealer gamma profile unavailable."` — the same
   real-time-snapshot dependency, confirming this is platform-wide, not Legacy-specific code.
3. **Direct re-verification against `api.massive.com`** (this session, same key): see the four
   requests above — `/v3/snapshot` and `/v2/snapshot/.../gainers` both 403 `NOT_AUTHORIZED`;
   `/v3/reference/options/contracts` and `/v2/aggs/grouped/...` both clean `200` on the identical
   key in the same check, isolating the loss to the real-time snapshot tier specifically.
4. **Plausible knock-on effect, not separately confirmed:** the current published Legacy edition
   (`edition_for=2026-11-09`) is `recap_only=true` with `recap_only_reason: "No candidates from
   any source (flows 0, OI 0, unusual 0, movers 0)."` — the `movers 0` leg is consistent with
   `fetchMarketMovers` hitting the same 403'ing `/v2/snapshot/.../gainers|losers` family, though
   `flows`/`OI`/`unusual` being 0 is UW-sourced (a different provider) and not explained by this.

### Fix

**No code fix exists for an external billing/entitlement loss**, same as the Benzinga finding.
Every consumer of `fetchOptionsUnifiedSnapshot` already degrades honestly (`available:false` /
empty marks / explicit "unavailable" reason) rather than crashing or fabricating data — this is
exactly what the Largo product contract's "absence" principle requires, and it is working as
designed. No runtime behavior was changed by this entry; it only documents the broader scope for
the record and for the next session's Monday pre-open check.

### Blast radius

Every live option/stock mark consumer platform-wide: Night Hawk Legacy (`legacy-marks`, and next-
day discovery via `fetchMarketMovers`), Night Hawk 0DTE, Vector, Swing, Banger, and the GEX
heatmap. All already fail-open — confirmed no crashes or fabricated data anywhere in this sweep —
so this is a data-completeness regression across a wide surface, not a stability incident. Worth a
Monday pre-open re-check per `docs/audit/MARKET-OPEN-VALIDATION.md` once intraday data would
otherwise be flowing, to see whether the entitlement has been restored and whether any 60-minute-
TTL cache fallback (e.g. Legacy's `LEGACY_OPTION_MARK_CACHE_TTL_SEC`) masks or fails to mask the
gap depending on timing.

### Operator action needed

Check/renew the real-time market-data entitlement on the Massive.com account
(https://massive.com/pricing per the error's own remedy) — likely the same billing event that
dropped the Benzinga news add-on earlier today, worth checking together rather than as two
separate renewals. This cannot be fixed from this sandbox or by any code change — flagged directly
per standing policy for exactly this reason.

### Evidence files

- None — this entry documents the finding only; no code changed. See
  `docs/audit/findings-staging/2026-11-07-benzinga-entitlement-lost.md` for the sibling,
  narrower-scope finding from earlier the same day.

Found during the standing 5-ENGINE LIVE MONITOR cycle's Night Hawk Legacy correctness check
(2026-11-07, ~23:00 UTC), independently re-verified against `api.massive.com` directly in this
session before staging.
