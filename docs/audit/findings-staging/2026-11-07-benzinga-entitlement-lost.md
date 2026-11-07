> **kind:** FINDING

## 2026-11-07 — Benzinga news/catalysts entitlement lost on the Massive.com plan — platform-wide, NOT fixable from code — NEEDS OPERATOR ACTION (ACCOUNT/BILLING)

| **Status** | NOT A CODE BUG — no PR fixes this; documented for the record + corrected two stale "verified working" code comments that would otherwise mislead a future reader |
| --- | --- |

### Area

`src/lib/providers/polygon-news.ts` (`fetchTickerNews`, `fetchMarketCatalysts`) and
`src/lib/providers/polygon.ts`'s Benzinga catalysts/price-target readers — the shared Benzinga
news/catalyst feed every desk reads through the Polygon/Massive key. 20 files across the platform
call these readers directly or transitively: Swing (`swing-ingest.ts`, `swing-discovery` cron),
Night Hawk Cortex (`cortex/fetch.ts`), Meridian (`meridian-fda-history.ts`,
`meridian-catalyst-enrich.ts`, `meridian-earnings-enrich.ts`), Largo tool-use (`largo/run-tool.ts`),
BIE (`bie/ecosystem-context.ts`), Vector (`vector-pick-enrichment.ts`), SPX (`spx-signal-log.ts`,
`spx-signals-shadow-catalysts.ts`), Night Hawk scoring/dossier (`scorer.ts`, `dossier.ts`).

### Root cause

`GET {POLYGON_API_BASE}/benzinga/v2/news` — the single endpoint every one of the above readers
calls — now returns `403` with `{"status":"ERROR","error":"You are not entitled to this data.
Please upgrade your plan at https://massive.com/pricing"}` on **every** query variant re-tested,
including the exact two combos `src/lib/providers/polygon-news.ts`'s own header comment used to
cite as "re-verified live" on 2026-07-13 (`channels=fda|guidance|m&a` and
`ticker=NVDA&channels=earnings`). This is an **account/billing entitlement loss on the Massive.com
plan**, not a code defect — the readers themselves are already correctly fail-open (every one
returns `{ items: [], unavailable: <reason> }` rather than throwing or fabricating data), so there
is no logic to fix. The only available action is for the operator to check/renew the Benzinga
add-on on the Massive.com account.

### Evidence

Two independent, same-day confirmations:

1. **Production's own live response.** A real `GET /api/market/swing/play-brief` call (via a temp
   Clerk premium session, `playId=SWING:MSTR:72`, a real CLOSED position) returned an honest
   `unavailableSources` entry: `{"source":"news","reason":"ticker news MSTR unavailable: Polygon
   /benzinga/v2/news → 403","retryable":true}`. This is production's own deployed key failing the
   call for a real request — not a sandbox artifact.
2. **Direct sandbox-key probe**, four variants, all `403` with the identical "not entitled" body:
   ```
   tickers.any_of=MSTR (bare)                           -> 403 not entitled
   tickers.any_of=MSTR&channels.any_of=earnings          -> 403 not entitled
   channels.any_of=fda,guidance,m&a (market-wide)        -> 403 not entitled
   tickers.any_of=NVDA&channels.any_of=earnings          -> 403 not entitled
   ```
   The last two are the EXACT combos the stale comment claimed were verified 200 on 2026-07-13.

**Isolation check** — confirms this is Benzinga-specific, not a dead key or a transient blip:
`GET /v2/aggs/grouped/locale/us/market/stocks/{date}` and `GET /v3/reference/tickers/AAPL` both
returned clean `200`s on the exact same key in the same check. The key is healthy; only the
Benzinga news entitlement on it is gone.

### Fix

**No code fix exists for an external billing/entitlement loss.** What this PR does instead:

- Corrected the now-actively-misleading "re-verified live... returns 200" header comment in
  `src/lib/providers/polygon-news.ts` (lines 1-25) with today's evidence, so a future reader
  doesn't re-trust a claim that is no longer true.
- Corrected the matching "confirmed-working channels" / "entitled on the current plan" comments in
  `src/lib/providers/polygon.ts` (the catalysts reader header and the price-target reader header —
  the latter's own "ONLY working source" is now also down).
- Corrected the equivalent "Benzinga rides the Polygon key... re-verified live 2026-07-13"
  environment note in `CLAUDE.md`'s "Environment realities" section, so the standing operating
  memory doesn't keep telling future sessions this path is healthy.
- No runtime behavior changed — every consumer already degrades honestly (this is exactly what
  the Largo product contract's "absence" principle requires, and it is working as designed: the
  `swing/play-brief` repro above surfaced the gap with full `source`/`reason`/`what_is_missing`/
  `retryable` detail rather than silently omitting the catalysts section).

### Blast radius

Every desk/feature that reads Benzinga news or catalysts currently degrades to an honest
"unavailable" for that one evidence leg: Swing play-brief catalysts section, SPX shadow catalyst
factors, Meridian FDA history / catalyst enrichment / earnings enrichment, Night Hawk Cortex
(`gex-walls`/`wall-trend`/etc. are unaffected — this is specifically the catalyst-news leg), Largo
tool-use answers that cite recent news, BIE ecosystem context, Vector pick enrichment. None of
these crash or fabricate data — confirmed fail-open across the board — but every one of them is
currently missing a real evidence source it used to have.

### Operator action needed

Check the Benzinga news add-on entitlement on the Massive.com account
(https://massive.com/pricing per the error's own remedy) and renew/upgrade if it has lapsed. This
cannot be fixed from this sandbox or by any code change — flagging directly per standing policy
for exactly this reason.

### Evidence files

- `src/lib/providers/polygon-news.ts` — corrected header comment.
- `src/lib/providers/polygon.ts` — corrected catalysts + price-target header comments.
- `CLAUDE.md` — corrected "Environment realities" Benzinga note.

Found during the standing Ask Largo deep-dive mandate (2026-11-07 cycle) while checking a live
`swing/play-brief` envelope against the Largo product contract's ten points — the catalysts
section's honest `unavailable` entry was the thread that led here.
