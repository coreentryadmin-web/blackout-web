// Register OPEN swing (+ banger) ledger OCCs on the shared ~1s live-marks lane (B-9 extension).
//
// Swing Command reuses the 0DTE marks poller/store/SSE — same pinned-entry P&L math, same WS+REST
// guarantee — rather than building a second quote path members would have to reconcile.

import { fetchOpenSwingPositions, type SwingPositionRow } from "@/lib/db";
import { fetchBangerOpenBookRows, type BangerPositionRow } from "@/lib/banger/positions-db";
import { isBangerEngineEnabled } from "@/lib/banger/flag";
import { occExpiryYmd, type ActiveZeroDtePlay } from "@/lib/zerodte/live-marks";
import { ZERODTE_LIVE_CONTRACT_CAP } from "@/lib/zerodte/marks-math";
import { todayEt } from "@/features/nighthawk/lib/session";
import { occSymbolFromSwingRow } from "./occ-from-row";

const LIVE_SWING = new Set(["OPEN", "HOLD", "TRIM"]);
const LIVE_BANGER = new Set(["OPEN", "PARTIAL"]);

/**
 * True when `occ`'s own embedded expiry is a calendar day strictly BEFORE `today` —
 * i.e. the contract has already expired and can never quote again.
 *
 * WHY THIS EXISTS AS ITS OWN CHECK, SEPARATE FROM zerodte/live-marks.ts's toActivePlay
 * GUARD (2026-09-11 finding, a correction to #4790): that guard excludes a 0DTE ledger
 * row when the OCC expiry != the row's own session_date — correct for 0DTE, where
 * session_date IS the (same-day) expiry by construction. Swing/banger rows are NOT
 * same-day: `row.session_date` here is the position's ENTRY/tracked date, which is
 * legitimately weeks before a real, still-live multi-week swing contract's expiry —
 * comparing session_date to occ expiry would falsely exclude every healthy open swing
 * position, not just zombies. The only invariant that holds for a still-trackable
 * swing/banger position is "the contract has not yet expired", so this compares the
 * OCC's expiry against TODAY instead of against the row's own tracked date.
 *
 * Live evidence this gap was real (npm run healthcheck:0dte / GET /marks, 2026-09-11,
 * AFTER #4790 deployed — confirmed via `git merge-base --is-ancestor` against the
 * production ECR-push workflow run that shipped it): 14 rows with expired OCCs
 * (OKTA/BLSH/ASST/MSTX/ETH/GBTC/ETHU/BITX/FBTC/BITO/ETHA/CRM/MSTR/IBIT/CRCG, expiries
 * 2026-08-21..09-04) still returning mark:null/source:"none"/stale:true from THIS
 * lane's own `swingRowToActivePlay`/`bangerRowToActivePlay` — #4790 only ever touched
 * `toActivePlay()` in zerodte/live-marks.ts, which this file's two row-builders below
 * never call (they build `ActiveZeroDtePlay` directly and merge in via
 * `mergeSwingActivePlays`), so the guard never covered this lane at all.
 */
function occAlreadyExpired(occ: string, today: string): boolean {
  const expiry = occExpiryYmd(occ);
  return expiry != null && expiry < today;
}

/** Exported for tests: the pure row→play conversion including the expiry-zombie guard. */
export function swingRowToActivePlay(row: SwingPositionRow, today: string): ActiveZeroDtePlay | null {
  if (!LIVE_SWING.has(row.status)) return null;
  const occ = occSymbolFromSwingRow(row);
  if (!occ) return null;
  if (occAlreadyExpired(occ, today)) return null;
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

/** Exported for tests: the pure row→play conversion including the expiry-zombie guard. */
export function bangerRowToActivePlay(row: BangerPositionRow, today: string): ActiveZeroDtePlay | null {
  if (!LIVE_BANGER.has(row.status)) return null;
  const occ = occSymbolFromSwingRow({
    contract_occ: row.contract_occ,
    ticker: row.ticker,
    contract_expiry: row.contract_expiry,
    contract_strike: row.contract_strike,
    contract_type: "call",
  });
  if (!occ) return null;
  if (occAlreadyExpired(occ, today)) return null;
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
  const today = todayEt();
  const out: ActiveZeroDtePlay[] = [];
  try {
    const rows = await fetchOpenSwingPositions();
    for (const row of rows) {
      const p = swingRowToActivePlay(row, today);
      if (p) out.push(p);
    }
  } catch {
    /* fail-soft — 0DTE lane still runs */
  }
  if (isBangerEngineEnabled()) {
    try {
      const bangers = await fetchBangerOpenBookRows(80);
      for (const row of bangers) {
        const p = bangerRowToActivePlay(row, today);
        if (p) out.push(p);
      }
    } catch {
      /* fail-soft */
    }
  }
  return out;
}
