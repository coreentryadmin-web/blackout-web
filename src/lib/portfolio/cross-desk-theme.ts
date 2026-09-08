// src/lib/portfolio/cross-desk-theme.ts — canonical cross-desk thesis clustering (deep-dive Q25).
//
// WHY: 0DTE's `CORRELATION_GROUPS` (governor.ts) and swing's `resolveTheme` (theme-cluster.ts) intentionally
// partition the same ticker differently — governor groups AAPL with AVGO/CRM/ADBE for intraday co-movement;
// swing's sector map clusters AAPL with MSFT/GOOGL/AMZN/META under "megatech" for multi-day thesis risk.
// SEV-9 unifies overlap WITHIN swing only; nothing today reads both desks for a combined exposure view.
//
// AUTHORITY (Q25 answer): for any FUTURE cross-desk concentration / combined-exposure feature, THIS module is
// the single canonical partition — `sectorFor` theme-grained sectors from portfolio/sector-map.ts. Per-desk
// gates keep using their own partitions (0DTE governor groups, swing theme-cluster) unchanged.
//
// PURE & deterministic — no IO.

import { sectorFor } from "./sector-map";

const OWN_CLUSTER_PREFIX = "NAME:";

function normalize(ticker: string | null | undefined): string {
  return (ticker ?? "").trim().toUpperCase();
}

/**
 * Cross-desk theme cluster for a ticker. Uses `sectorFor` (megatech, semis, …) when mapped; otherwise the
 * name is its own cluster so unmapped tickers are never falsely merged across desks.
 */
export function crossDeskTheme(ticker: string | null | undefined): string {
  const up = normalize(ticker);
  if (!up) return `${OWN_CLUSTER_PREFIX}`;
  const sector = sectorFor(up);
  if (sector != null) return sector;
  return `${OWN_CLUSTER_PREFIX}${up}`;
}

/** Do two names share a cross-desk thesis cluster? Direction is the caller's concern. */
export function crossDeskSameThesis(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  return crossDeskTheme(na) === crossDeskTheme(nb);
}
