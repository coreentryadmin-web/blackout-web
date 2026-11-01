> **kind:** FINDING

## Ask Largo — swing "Peers" line surfaces an issuer's own corporate bonds as competing companies — FIXED

| | |
|---|---|
| **Area** | Polygon related-companies reader (`src/lib/providers/polygon-related.ts`), consumed by swing play-briefs and `ecosystem-context.ts`'s general ticker-ecosystem reads |
| **Severity** | P2 — Largo Contract **C4 (identity)** violation, member-facing |
| **Status** | Fixed |
| **Found by** | Live audit (five-engine-largo-cycle-58, "largo-deep-dive" agent, fresh-ticker TMUS check), 2026-11-01 |

### Root cause

`parseRelatedCompanies()` filters `/v1/related-companies/{ticker}` candidates only by symbol shape
(`SYMBOL_RE`, 1–6 `A–Z/.` chars) and self-exclusion (`raw === self`). It has no check for "is this
actually the same issuer under a different ticker" — so an issuer's own exchange-traded debt
(baby bonds / senior notes), which Polygon lists under the issuer's ticker **root plus a single
trailing letter**, passes straight through as if it were an independent peer company. Polygon also
mislabels these securities' `type` as `"CS"` (common stock), identical to a real equity, so a type
filter could not have caught this either.

### Evidence (live reproduction)

`GET /api/market/swing/play-brief?playId=SWING:TMUS&positionId=2314&status=COMMIT` rendered:

```
Peers: VZ, T, TMUSZ, TMUSI, TMUSL, ANET
```

in both the "Catalysts & news" section and a typed `evidence[]` entry (`source: "Polygon (related
companies)"`). Verified directly against Polygon reference data:

- `GET /v3/reference/tickers/TMUSZ` → "T-Mobile US, Inc. 5.500% Senior Notes due March 2070"
- `GET /v3/reference/tickers/TMUSI` → "...5.500% Senior Notes due June 2070"
- `GET /v3/reference/tickers/TMUSL` → "...6.250% Senior Notes due 2069"

All three are TMUS's own debt, not peer/competitor companies — 3 of the 6 "Peers" are the subject
company itself under a different ticker, with nothing in the response disclosing that. A trader
reading "Peers: VZ, T, TMUSZ, TMUSI, TMUSL, ANET" has no way to know this without an independent
Polygon reference-data lookup.

Checked 7 other tickers' own related-companies responses (VZ, HPQ, CF, T, GE, F, BA) — none
returned self-referencing bond tickers, so this specific instance may be particular to issuers with
listed baby bonds/senior notes under a ticker-prefix convention (TMUS has several; most names in
the swing universe don't). The code had zero defense against it regardless, so it's a real, live
defect, not a one-off data blip that already resolved itself.

### Blast radius

`fetchRelatedCompanies`/`arsenal.related` feeds:
- `src/lib/swing/play-brief-intel.ts` (the "Peers:" catalysts line) and `play-brief.ts`'s
  `evidenceFromContext()` (the `"Polygon (related companies)"` evidence push, PR #6480 — that PR
  fixed evidence[]-completeness, never peer-identity validity, so this is a distinct bug).
- `src/lib/bie/ecosystem-context.ts` → `src/lib/largo/run-tool.ts`/`tool-defs.ts` — i.e. this can
  also surface in Largo's general ticker-ecosystem/compare tools for any ticker, not just swing
  play-briefs.

### Fix

`isLikelySelfIssuedSecurity(self, raw)` in `polygon-related.ts`: drop any candidate whose ticker is
exactly the queried ticker's root plus one trailing uppercase letter (`raw.length === self.length +
1`, `raw.startsWith(self)`, suffix matches `/^[A-Z]$/`), matching the exact TMUSZ/TMUSI/TMUSL
shape. Two guards keep this from creating new false negatives:
- **`self.length < 3` is excluded** — a short root (`T`, `F`, `GE`) makes "root + 1 letter" collide
  with real, unrelated short tickers far too often to use as a signal.
- **Dotted tickers are excluded** (`raw.includes(".")`) — `BRK.A`/`BRK.B` are real share classes of
  the same real peer company, not self-issued debt, and must keep passing through.

### Tests

`src/lib/providers/polygon-related.test.ts` — 3 new cases: the live TMUS repro shape (drops
TMUSZ/TMUSI/TMUSL, keeps VZ/T/ANET), a short-root no-regression case (`GE` + `GEX` stays — the
length guard must not fire), and a dotted-ticker no-regression case (`BRK.A` + `BRK.B` stays).

RED→GREEN verified: reverted `polygon-related.ts` to pre-fix `origin/main` content, ran the new
tests — 1 failed exactly as predicted (TMUSZ/TMUSI/TMUSL present in output), 2 passed (both
no-regression guards already held). Restored the fix — 6/6 pass. Downstream consumer suites
unaffected: `ecosystem-context.test.ts` (44/44), `play-brief.test.ts` (187/187). `tsc --noEmit`
clean.
