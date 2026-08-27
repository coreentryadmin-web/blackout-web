> **kind:** FINDING

## 2026-08-27 — [FINDING, P3 audit tooling] `meridian-data-audit.mjs` reported all 6 Polygon/Benzinga probes RED — two config/symbol bugs in the script, not a real upstream outage — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 — audit-tooling only; the RED/AMBER readings were both false, but a coordinator reading this report cold would reasonably have escalated a "Polygon+Benzinga fully down" P0 |

**Symptom.** `npm run validate:meridian` reported:

```
Polygon SPX daily bars            RED  http=0
Polygon SPX minute bars           RED  http=0
Benzinga economics headlines      RED  http=0
Benzinga analyst ratings NVDA     RED  http=0
Benzinga FDA catalysts            RED  http=0
Benzinga structured earnings NVDA RED  http=0
```
while all 6 sibling UW probes in the SAME run were GREEN — an "everything Polygon-adjacent is
down, everything UW is fine" split is a config-layer symptom, not a real simultaneous outage of
two unrelated vendors.

**Root cause #1 — `POLYGON_API_BASE` literal placeholder.** This sandbox ships
`POLYGON_API_BASE` as the literal, unresolved string `"POLYGON_API_BASE"` (an unexpanded
`${{shared.*}}` ref — documented in `CLAUDE.md`'s "Environment realities"). The script's base
resolution was a plain `||` fallback (`process.env.POLYGON_API_BASE || "https://api.polygon.io"`),
which does not catch this: the env var IS set (to a broken non-URL string), so the fallback never
fires and every fetch (`${POLY_BASE}/...`) tries to hit a URL starting with the literal text
`POLYGON_API_BASE`, throwing before any HTTP response — the `http: 0` is the tell. Benzinga rides
the same `POLY_BASE` (per `CLAUDE.md`), so it broke identically. Several OTHER scripts in this repo
already carry the fix for exactly this (`helix-score-signal.mjs`'s "SELF-DEFAULT THE PROVIDER BASE"
comment) — this script simply predated that pattern and was never updated.

**Root cause #2 (independent, found after fixing #1) — plain "SPX" is not a Polygon ticker.** With
the base URL fixed, the two SPX bar probes still came back AMBER: HTTP 200, 0 rows. Confirmed live:
`/v2/aggs/ticker/SPX/range/...` returns `resultsCount: 0` every time; `/v2/aggs/ticker/I:SPX/...`
over the identical window returns 5. This is not a config typo — it's the same index-symbol
distinction already discovered and documented in
`src/lib/providers/flow-price-symbol.ts` (`INDEX_PRICE_SYMBOL`, `SPX -> "I:SPX"`) and
`src/lib/zerodte/board.ts` (`POLYGON_INDEX_SPOT`). This audit script simply never picked up that
mapping.

**Evidence.** Live re-runs, same session: pre-fix `{"green":6,"amber":0,"red":6}`; after fixing
root cause #1 alone, `{"green":10,"amber":2,"red":0}` (Benzinga all GREEN with real rows; SPX bars
still AMBER at 0 rows); after fixing root cause #2, `{"green":12,"amber":0,"red":0}`.

**Blast radius.** Both fixes are confined to `scripts/audit/meridian-data-audit.mjs`. Checked
whether the plain-"SPX" bug reaches any member-facing code path: it does not —
`flow-price-symbol.ts`'s header comment documents this exact Polygon behavior (verified live
2026-08-19, independently of this finding) and already routes SPX/SPXW/NDX/etc through their `I:`
prefix; this audit script was simply not using that existing helper.

**Fix.** (1) Adopted the same `/^https?:\/\//`-guarded self-default pattern already used elsewhere
in this repo for `POLYGON_API_BASE`. (2) Changed both SPX bar probe URLs from `ticker/SPX/...` to
`ticker/I:SPX/...`.

**Fix rationale.** Did not refactor this script to import `INDEX_PRICE_SYMBOL` from
`flow-price-symbol.ts` — the script only ever probes SPX (never a general ticker), so a shared
mapping import would be over-engineering for a two-line literal fix; if this script grows to probe
other index roots, revisit.

**Regression guard.** No unit test added — this file has no companion `.test.mjs` (a live-network
audit instrument, consistent with `scripts/audit/`'s established convention). Verified by the live
re-runs above.
