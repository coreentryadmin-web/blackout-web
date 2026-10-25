## 2026-10-25 — [FINDING, P2 Night Hawk Swings / Ask Largo] `software` sector-theme bucket missing FTNT/OKTA/S/RBRK — Book context undercounted real portfolio concentration — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Area** | Night Hawk Swings "Ask Largo" play-brief Book context section (`src/lib/portfolio/sector-map.ts`, `src/lib/swing/theme-cluster.ts`, `src/lib/swing/portfolio.ts`'s `checkPortfolioOverlap`) |
| **Found by** | 5-ENGINE LIVE MONITOR CYCLE standing Ask Largo deep-dive mandate, fresh-angle sweep on 2026-10-25 |
| **Status** | FIXED |

### Symptom

Live production: `GET /api/market/swing/play-brief?playId=SWING:PANW:67`'s "Book context" section
read:

> "already holding 5 same-direction positions in theme 'software': ZS LONG (separate position
> #2106), ZS LONG (separate position #2028), SNOW LONG, NET LONG, CRWD LONG."

At the same moment, the live committed swing book (`GET /api/market/nighthawk/horizons?view=swings`)
actually held, concurrently LONG: FTNT (positions #2110, #2029), OKTA (#2109, #2026), S (#2114),
and RBRK (#2112) — four more cybersecurity/software names, 6 more positions — on top of the 5
already disclosed. The real concentration in the book was **9 same-direction positions across 8
names** (ZS×2, SNOW, NET, CRWD, FTNT×2, OKTA×2, S, RBRK), not the 5 the trader-facing coaching text
reported — understating the true single-thesis concentration risk by roughly half.

### Root cause

`src/lib/portfolio/sector-map.ts`'s `software` bucket listed `PLTR, PLTU, CRM, NOW, SNOW, ADBE,
ORCL, CRWD, NET, DDOG, PANW, MDB, ZS, SHOP` but omitted FTNT (Fortinet), OKTA (Okta), S
(SentinelOne) and RBRK (Rubrik) — all liquid, options-active cybersecurity/software names that
trade on the same correlated thesis as the already-listed CRWD/ZS/PANW/NET. Verified via Polygon
reference (`/v3/reference/tickers/<T>`, not guessed from the symbol): OKTA, S, and RBRK share SIC
7372 "SERVICES-PREPACKAGED SOFTWARE" with no distinction from the sector's existing members; FTNT
(SIC 3577) is the cybersecurity-hardware/firewall peer the software cluster already represents the
software side of.

`theme-cluster.ts`'s `resolveTheme()` falls through to `sectorFor()` for any ticker without an
`ETF_PROXY_THEMES` override, and an unmapped ticker resolves to its own isolated `NAME:<ticker>`
cluster (deliberately — see the file's own doc comment — so an unmapped name is never falsely
merged). Because FTNT/OKTA/S/RBRK had no entry anywhere in `sector-map.ts`, each resolved to its
own isolated cluster: `sameThesis("FTNT", "PANW")`, `sameThesis("OKTA", "CRWD")`,
`sameThesis("S", "ZS")`, and `sameThesis("RBRK", "NET")` all returned `false` live, even though all
four names are real, liquid cybersecurity peers of the names already clustered.

This is the identical gap shape this file has fixed repeatedly for other sectors — ALAB/CRDO/KLAC
(semis, 2026-09-25), CRWV/NBIS (semis, 2026-10-16), the quantum-computing cluster (2026-09-25), the
crypto-equity extensions (2026-09-20, 2026-10-07), and the TSLA/TSLL leveraged-wrapper fix
(2026-10-20): a real, live, concurrently-committed name sharing an obvious thesis with an existing
bucket had simply never been added to the curated static map, so `checkPortfolioOverlap`
(`portfolio.ts`) silently underreported the true concentration to every affected play-brief —
PANW's own brief undercounted by exactly the 4 missing names, and FTNT/OKTA/S/RBRK's own
play-briefs (had they been requested) would have shown an even weaker flag, missing the
CRWD/ZS/SNOW/NET/PANW side of the same concentration entirely.

### Blast radius

Every call site that resolves theme via `resolveTheme()`/`sameThesis()` is affected identically —
there is exactly one resolver (`theme-cluster.ts`'s own header: "the ONE theme/correlation resolver
for the SWING engine ... both import `resolveTheme`/`sameThesis` from here; neither re-derives
it"). `checkPortfolioOverlap` (`portfolio.ts`) is the only consumer in the swing play-brief path,
feeding `bookContextSection` (`play-brief-intel.ts`). No other file duplicates this classification
logic for these four tickers.

A second, independent consumer of the same underlying `sectorFor()` map (not `resolveTheme`
directly) is `src/lib/swing/industry-group-rs.ts`'s `resolveGroupBenchmark`, which picks each
name's relative-strength benchmark. Before this fix, FTNT/OKTA/S/RBRK had no `sectorFor()` entry at
all, so each fell through to a generic SIC-range benchmark fallback (the same "mechanical SIC match
can mislabel a name whose real driver is a clean sector label" case this file's own header already
documents for other previously-unmapped tickers like ASST/HUT). This fix additionally gives all
four names the correct "software" sector-ETF benchmark for RS comparison — a second, net-positive
side effect of the same one-line root cause, not a separate change. `software` is not in
`NO_SECTOR_BENCHMARK_THEMES`, so this path is live, not short-circuited. Confirmed no existing
`industry-group-rs.test.ts` fixture references these four tickers (so no test assumed the old,
wrong fallback behavior).

### Fix rationale

Added FTNT, OKTA, S, RBRK to the existing `software` bucket in `sector-map.ts` — the minimal,
precedent-following fix (join the existing bucket, do not invent a new "cybersecurity" sub-bucket)
matching every prior fix of this shape in the same file. Deliberately did NOT widen the bucket to
any other adjacent name not currently live in a real committed position — this file's own
precedent (crypto-equity's "deliberately conservative... rather than over-reaching this pass") is
to add only what's verified via Polygon reference and, where possible, corroborated by a real live
repro, not to speculatively pad a sector bucket.

### Evidence / tests

RED (before fix): `resolveTheme("FTNT")`, `resolveTheme("OKTA")`, `resolveTheme("S")`,
`resolveTheme("RBRK")` each returned their own isolated `NAME:<ticker>` cluster;
`sameThesis("FTNT","PANW")`, `sameThesis("OKTA","CRWD")`, `sameThesis("S","ZS")`,
`sameThesis("RBRK","NET")` all returned `false`. GREEN (after fix): all four resolve to
`"software"`; all four `sameThesis` pairs return `true`; unrelated pairs (`sameThesis("FTNT",
"NVDA")`, `sameThesis("S", "AAPL")`) still correctly return `false`. New regression test added to
`src/lib/swing/theme-cluster.test.ts` (full file: 29/29 pass). Scoped blast-radius check:
`src/lib/swing/portfolio.test.ts` + `src/lib/swing/swing-portfolio-budget.test.ts` +
`src/lib/swing/play-brief-intel.test.ts` (358/358 pass, no regressions). `tsc --noEmit` clean.
Full suite run on Node 20 (`npm test`) green.
