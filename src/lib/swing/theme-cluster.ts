// src/lib/swing/theme-cluster.ts — THE one theme / correlation resolver for the SWING engine (PR-5, SEV-9).
//
// Concentration risk is about THESIS, not about the ticker symbol. NVDA, AMD, SMH and QQQ are four different
// symbols but ONE bet — "semis / mega-cap tech keeps working" — so a book long all four is a single 4× wager,
// not four independent edges. Before PR-5 the swing gate and the (future PR-6) allocation import each had their
// own ad-hoc idea of "same thesis"; SEV-9 collapses them into this ONE resolver so the overlap the gate flags
// and the cluster the allocator caps are provably the SAME partition. Both import `resolveTheme`/`sameThesis`
// from here; neither re-derives it.
//
// SEEDED from the two existing sources of truth (never a third hand-copied list):
//   • `governor.CORRELATION_GROUPS` — the 0DTE risk layer's broad index/ETF complex (SPY/QQQ/IWM/…). Reused
//     via the now-exported `correlationGroupOf`, so the index complex has ONE definition across surfaces.
//   • `sectorFor` (portfolio/sector-map) — the theme-grained ticker→sector map ("semis", "crypto-equity",
//     "china-adr", …) that already clusters the way a trader's risk does. `null` there ⇒ its own cluster.
// On top of those, `ETF_PROXY_THEMES` reassigns the handful of ETFs whose REAL risk driver is not their index
// label: QQQ / NDX / SMH / SOXX are dominated by semis + mega-cap tech, so for swing concentration they cluster
// with NVDA, not with IWM. That override is what makes `sameThesis("QQQ","NVDA") === true` (the SEV-9 invariant).
//
// PURE & deterministic — no IO. Evidence-only: this partition FEEDS the gate's overlap flag and the allocator's
// cap; it sizes nothing on its own.

import { CORRELATION_GROUPS, correlationGroupOf } from "../zerodte/governor";
import { sectorFor } from "../portfolio/sector-map";

/** Canonical label for the broad index/ETF complex (the governor's one correlation group). */
export const BROAD_MARKET_THEME = "broad-market";

/** Prefix for a name that maps to no shared theme — it becomes its OWN cluster (never a false merge). */
const OWN_CLUSTER_PREFIX = "NAME:";

/**
 * The named theme clusters, seeded from the ONE governor correlation-group source. Today that's the single
 * broad-market index/ETF complex; the sector-grained themes live in `sectorFor` and are resolved on demand
 * (kept there so the swing engine and the allocation engine share the same curated map). Exposed so tooling /
 * tests can enumerate the seeded clusters.
 */
export const CORRELATION_THEMES: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  [BROAD_MARKET_THEME]: new Set<string>(CORRELATION_GROUPS.flatMap((g) => Array.from(g))),
});

/**
 * ETFs whose concentration makes them a PROXY for a driver theme rather than their nominal index bucket.
 * These override sectorFor/governor so the ETF clusters with the names that actually move it. WHY each:
 *  - QQQ / QQQM / NDX: the Nasdaq-100 is ~50% mega-cap tech + semis; it lives and dies with NVDA/AAPL/MSFT.
 *  - SMH / SOXX / SOXL / SOXS: pure semiconductor ETFs — literally the NVDA/AMD/AVGO basket.
 *  - XLK: tech-select sector SPDR, mega-cap-tech-dominated.
 * This is the override that makes `sameThesis("QQQ","NVDA") === true` (SEV-9 invariant).
 */
export const ETF_PROXY_THEMES: Readonly<Record<string, string>> = Object.freeze({
  QQQ: "semis",
  QQQM: "semis",
  NDX: "semis",
  SMH: "semis",
  SOXX: "semis",
  SOXL: "semis",
  SOXS: "semis",
  XLK: "semis",
});

function normalize(ticker: string | null | undefined): string {
  return (ticker ?? "").trim().toUpperCase();
}

/**
 * Resolve a ticker to its ONE theme cluster key. Resolution order (most-specific first):
 *   1. ETF proxy override — the ETF's real risk driver wins over its index label (QQQ → semis).
 *   2. Governor broad-market complex — the index/ETF names cluster as one (SPY/IWM/DIA/… → broad-market).
 *   3. `sectorFor` theme-grained sector ("semis", "crypto-equity", …); its "index-etf" is unified to
 *      broad-market so the sector map and the governor complex agree on one label.
 *   4. Own cluster (`NAME:<sym>`) — an unmapped name is NEVER falsely merged into a shared thesis.
 */
export function resolveTheme(ticker: string | null | undefined): string {
  const up = normalize(ticker);
  if (!up) return `${OWN_CLUSTER_PREFIX}`; // empty → degenerate own cluster (won't match a real name)

  const proxy = ETF_PROXY_THEMES[up];
  if (proxy) return proxy;

  // Governor's index/ETF complex is one thesis (seeded, not re-listed).
  if (correlationGroupOf(up)) return BROAD_MARKET_THEME;

  const sector = sectorFor(up);
  if (sector === "index-etf") return BROAD_MARKET_THEME; // unify the sector map's index label
  if (sector != null) return sector;

  return `${OWN_CLUSTER_PREFIX}${up}`;
}

/**
 * Do two names express the SAME thesis (same theme cluster)? Theme-only — direction is the caller's concern
 * (portfolio.ts folds direction on top). Two DIFFERENT unmapped names resolve to distinct own-clusters, so
 * they are never falsely called the same thesis. `sameThesis("QQQ","NVDA") === true` (SEV-9 invariant).
 */
export function sameThesis(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false; // an unknown side is not a match
  return resolveTheme(na) === resolveTheme(nb);
}
