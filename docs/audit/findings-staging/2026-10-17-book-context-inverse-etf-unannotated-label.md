> **kind:** FINDING

## Book Context's "Internal conflict" line showed an inverse-leverage ETF as a bare "LONG", reading as self-contradictory against the same brief's "Concentration" line — FIXED

| **Status** | Fixed (`formatOverlapPosition()`, `src/lib/swing/play-brief-intel.ts`) |
|---|---|

**Found via:** this session's standing Ask Largo deep-dive (5-engine monitor cycle, 2026-10-17 ~22:33 UTC).

**Live repro.** `GET /api/market/swing/play-brief?playId=SWING:ALAB:1810&ticker=ALAB&positionId=1810&expandIntel=1` (production, 2026-10-17), "Book context" section:

> **Concentration** — already holding 2 same-direction positions in theme "semis": NVDA LONG, CRWV LONG. ALAB stacks the same wager rather than diversifying risk.
>
> **Internal conflict** — theme "semis" already has an OPPOSED position: SQQQ LONG, SOXS LONG. One leg is structurally betting against the other; this is not a hedge unless intentional.

Four tickers, all labeled "LONG", split across two sentences with opposite conclusions and zero explanation why.

**Root cause.** `checkPortfolioOverlap()` (`src/lib/swing/portfolio.ts`) already classifies correctly: it compares positions by `effectiveDirection()` (`src/lib/swing/theme-cluster.ts`), which flips LONG↔SHORT for known inverse-leverage ETFs (`INVERSE_LEVERAGE_ETFS = {SOXS, SQQQ}` — a LONG SOXS/SQQQ position is economically a SHORT bet on "semis"). The classification math is right. But `formatOverlapPosition()` (`play-brief-intel.ts`), the only renderer `bookContextSection` uses for both the same-direction and opposed buckets, built the display string as `` `${p.ticker} ${p.direction}` `` — the raw, nominal ledger direction — never consulting `isInverseLeverageEtf`. The member-facing sentence never surfaced *why* the classification put a nominal "LONG" in the OPPOSED bucket.

**Blast radius.** Every committed brief whose book holds SOXS or SQQQ alongside any other same-theme name hits this. Confirmed previously-unflagged on a second ticker too: PR #4076 comment 6104013319 (2026-10-11) independently quoted the identical unexplained pattern on MRVL ("SOXS LONG (#1648), SOXS LONG (#1572)") without flagging the missing annotation at the time.

**Fix.** `formatOverlapPosition()` now annotates the label when `isInverseLeverageEtf(p.ticker)` is true: `"SQQQ LONG (inverse ETF — economically SHORT)"` instead of a bare `"SQQQ LONG"`. Reused the existing `effectiveDirection`/`isInverseLeverageEtf` helpers from `theme-cluster.ts` (already the source of truth the classification itself uses) rather than inventing a second notion of "inverse."

**Deliberately not expanded in this PR.** A related, lower-confidence observation surfaced while investigating: `theme-cluster.ts`'s `INVERSE_LEVERAGE_ETFS`/`ETF_PROXY_THEMES` only cover the semis/Nasdaq complex (SOXS/SQQQ/SOXL/TQQQ) — `LABD` (3x inverse biotech, a real live swing-book ETF per the sibling #6153/#6154 fixes) isn't clustered into any theme at all (`sectorFor`'s "biotech" list is named clinical-stage tickers only, no ETF proxy), so a LONG LABD position currently gets NO concentration/conflict flag against a LONG biotech name — not mislabeled, simply never compared. This needs the same dedicated research the SQQQ addition got (2026-10-11, confirming the real risk driver before adding a theme mapping), not a quick patch alongside an unrelated label fix — raised on PR #4076 rather than silently expanded here.

**Tests.** Added a regression test asserting the annotated label renders for a LONG SQQQ landing in the OPPOSED bucket against a LONG NVDA. RED→GREEN proven via `git stash` (1 failure without the fix, 0 with it restored). Broader regression: `src/lib/swing/*.test.ts` + `src/lib/largo/**/*.test.ts` + `src/features/nighthawk/**/*.test.ts` — 4265/4265 pass. `tsc --noEmit`: clean.
