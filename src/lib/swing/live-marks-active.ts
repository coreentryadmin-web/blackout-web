// Register OPEN swing (+ banger) ledger OCCs on the shared ~1s live-marks lane (B-9 extension).
//
// Swing Command reuses the 0DTE marks poller/store/SSE — same pinned-entry P&L math, same WS+REST
// guarantee — rather than building a second quote path members would have to reconcile.

import { fetchOpenSwingPositions, type SwingPositionRow } from "@/lib/db";
import { fetchBangerOpenBookRows, type BangerPositionRow } from "@/lib/banger/positions-db";
import { isBangerEngineEnabled } from "@/lib/banger/flag";
import type { ActiveZeroDtePlay } from "@/lib/zerodte/live-marks";
import { ZERODTE_LIVE_CONTRACT_CAP } from "@/lib/zerodte/marks-math";
import { occSymbolFromSwingRow } from "./occ-from-row";

const LIVE_SWING = new Set(["OPEN", "HOLD", "TRIM"]);
const LIVE_BANGER = new Set(["OPEN", "PARTIAL"]);

function swingRowToActivePlay(row: SwingPositionRow): ActiveZeroDtePlay | null {
  if (!LIVE_SWING.has(row.status)) return null;
  const occ = occSymbolFromSwingRow(row);
  if (!occ) return null;
  return {
    session_date: String(row.session_date).slice(0, 10),
    ticker: row.ticker.toUpperCase(),
    direction: row.direction === "short" ? "short" : "long",
    strike: row.contract_strike,
    occ,
    entry_premium: row.entry_premium,
    status: row.status,
    peak_premium: row.peak_premium,
    trough_premium: row.trough_premium,
  };
}

function bangerRowToActivePlay(row: BangerPositionRow): ActiveZeroDtePlay | null {
  if (!LIVE_BANGER.has(row.status)) return null;
  const occ = occSymbolFromSwingRow({
    contract_occ: row.contract_occ,
    ticker: row.ticker,
    contract_expiry: row.contract_expiry,
    contract_strike: row.contract_strike,
    contract_type: "call",
  });
  if (!occ) return null;
  return {
    session_date: row.session_date,
    ticker: row.ticker.toUpperCase(),
    direction: "long",
    strike: row.contract_strike,
    occ,
    entry_premium: row.entry_premium,
    status: row.status === "PARTIAL" ? "TRIM" : "OPEN",
    peak_premium: row.peak_premium,
    trough_premium: null,
  };
}

/** Merge 0DTE entered plays with swing/banger open-book rows under the shared live cap. */
export function mergeSwingActivePlays(
  zeroDteEntered: readonly ActiveZeroDtePlay[],
  swingRows: readonly ActiveZeroDtePlay[],
  cap = ZERODTE_LIVE_CONTRACT_CAP,
): ActiveZeroDtePlay[] {
  const seen = new Set<string>();
  const out: ActiveZeroDtePlay[] = [];
  for (const p of zeroDteEntered) {
    if (!p.occ || seen.has(p.occ)) continue;
    seen.add(p.occ);
    out.push(p);
    if (out.length >= cap) return out;
  }
  for (const p of swingRows) {
    if (!p.occ || seen.has(p.occ)) continue;
    seen.add(p.occ);
    out.push(p);
    if (out.length >= cap) return out;
  }
  return out;
}

/** OPEN swing_positions (+ optional banger ledger) for the shared live-marks lane. */
export async function fetchActiveSwingPlaysForMarks(): Promise<ActiveZeroDtePlay[]> {
  const out: ActiveZeroDtePlay[] = [];
  try {
    const rows = await fetchOpenSwingPositions();
    for (const row of rows) {
      const p = swingRowToActivePlay(row);
      if (p) out.push(p);
    }
  } catch {
    /* fail-soft — 0DTE lane still runs */
  }
  if (isBangerEngineEnabled()) {
    try {
      const bangers = await fetchBangerOpenBookRows(80);
      for (const row of bangers) {
        const p = bangerRowToActivePlay(row);
        if (p) out.push(p);
      }
    } catch {
      /* fail-soft */
    }
  }
  return out;
}
