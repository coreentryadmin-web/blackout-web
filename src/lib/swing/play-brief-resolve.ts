/**
 * Swing play brief — authoritative play resolution.
 * Fixes ticker-collision bugs (e.g. NRG OPEN 110C vs WATCH 115C) by preferring
 * open ledger rows and contract/status hints over naive ticker-only lane lookup.
 */
import {
  fetchOpenSwingPositions,
  fetchLatestSwingSnapshotEvents,
  fetchSwingPositionsRange,
  type SwingPositionRow,
} from "@/lib/db";
import {
  attachThesisExplanation,
  getSwingServingLane,
  discoverSwingFromPersisted,
  readSwingServingSnapshot,
} from "@/lib/swing/serving-lane";
import { fetchBangerOpenBookRows } from "@/lib/banger/positions-db";
import { isBangerEngineEnabled } from "@/lib/banger/flag";
import { readBangerWatchSnapshot } from "@/lib/banger/watch-cache";
import { fetchVectorPickLeaderRows } from "@/lib/vector/vector-pick-leaders-db";
import { isSwingEngineV2Enabled } from "@/lib/swing/v2/config";
import { todayEt } from "@/lib/et-date";
import type { HorizonPlay } from "@/lib/horizon-plays";
import {
  terminalPlayFromHorizon,
  terminalPlayFromClosedSwing,
  type HorizonDeckSource,
} from "@/features/nighthawk/command-deck/adapters";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { closedDeckSourceFromRow } from "@/lib/swing/closed-plays";
import { rowsForSwingSection } from "@/features/nighthawk/command-deck/swing-section-filter";
import { livePlayFromSwingPosition } from "@/lib/swing/live-plays";
import {
  parseSwingPlayId,
  pickLanePlayForBrief,
  type ParsedSwingPlayId,
} from "./play-brief-resolve-pure";

export { parseSwingPlayId, pickLanePlayForBrief, type ParsedSwingPlayId };

const WORKING = new Set(["OPEN", "HOLD", "TRIM"]);

export type SwingBriefResolveHints = {
  playId: string;
  ticker?: string | null;
  positionId?: number | null;
  status?: string | null;
  strike?: number | null;
  right?: string | null;
};

export function horizonRowToDeckSource(p: HorizonPlay, positionId?: number | null): HorizonDeckSource {
  return {
    ticker: p.ticker,
    direction: p.direction,
    horizon: "SWING",
    score: p.score,
    status: p.status,
    reason: p.reason,
    contract: {
      strike: p.contract.strike,
      right: p.contract.right,
      expiry: p.contract.expiry,
      dte: p.contract.dte,
      mid: p.contract.mid,
      bid: p.contract.bid ?? null,
      ask: p.contract.ask ?? null,
      delta: p.contract.delta,
      gamma: p.contract.gamma,
      theta: p.contract.theta,
      vega: p.contract.vega,
      iv: p.contract.iv,
    },
    factors: p.factors,
    regime: p.regime ?? null,
    setupState: p.setupState ?? null,
    entryStatus: p.entryStatus ?? null,
    archetype: p.archetype ?? null,
    subLane: p.subLane ?? null,
    servingSection: p.serving ?? null,
    persistenceObserved: p.persistenceObserved ?? null,
    persistenceGapReason: p.persistenceGapReason ?? null,
    firstSeenAt: p.firstSeenAt ?? null,
    committedAt: p.committedAt ?? null,
    signalKinds: p.signalKinds ?? null,
    commitGateBlockedBy: p.commitGateBlockedBy ?? null,
    liveStatus: p.liveStatus ?? null,
    flagUnderlyingPx: p.flagUnderlyingPx ?? null,
    entryPremium: p.entryPremium ?? null,
    livePnlPct: p.livePnlPct ?? null,
    peakPremium: p.peakPremium ?? null,
    troughPremium: p.troughPremium ?? null,
    markAsOf: p.markAsOf ?? null,
    manageAction: p.manageAction ?? null,
    thesisBreak:
      p.thesisLevel != null ? { level: p.thesisLevel, note: p.thesisNote ?? undefined } : undefined,
    occ: null,
    positionId: positionId ?? null,
  };
}

function normalizeRight(right: string | null | undefined): "C" | "P" | null {
  if (!right) return null;
  const r = right.trim().toUpperCase();
  if (r === "C" || r === "CALL") return "C";
  if (r === "P" || r === "PUT") return "P";
  return null;
}

function rowContractMatches(row: SwingPositionRow, strike: number | null, right: "C" | "P" | null): boolean {
  if (strike == null) return true;
  if (row.contract_strike !== strike) return false;
  if (right == null) return true;
  const rowRight = row.contract_type === "put" ? "P" : "C";
  return rowRight === right;
}

async function loadClosedPlay(ticker: string, positionId: number | null): Promise<TerminalPlay | null> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await fetchSwingPositionsRange(since, 500).catch(() => []);
  const graded = rows.filter((r) => r.graded_at && r.ticker.toUpperCase() === ticker);
  if (graded.length === 0) return null;
  const target =
    positionId != null
      ? graded.find((r) => r.id === positionId || r.root_position_id === positionId)
      : graded.sort((a, b) => String(b.graded_at).localeCompare(String(a.graded_at)))[0];
  if (!target) return null;
  // Per-leg brief: use this position's own exit P&L — closedDeckSourcesFromChains applies chain-composite
  // override for the CLOSED deck list view (Q26), which would mis-attribute another leg's outcome here.
  const src = closedDeckSourceFromRow(target);
  return src ? terminalPlayFromClosedSwing(src) : null;
}

async function loadLaneRows(ticker: string): Promise<{
  rows: HorizonPlay[];
  scanAsOf: string | null;
  scanSessionDay: string | null;
}> {
  const snap = await readSwingServingSnapshot().catch(() => null);
  const engineV2 = isSwingEngineV2Enabled();
  const vectorRows = engineV2 ? [] : await fetchVectorPickLeaderRows({ limit: 120 }).catch(() => []);
  const vectorLeaders = vectorRows.map((r) => ({
    ticker: r.ticker,
    leaderKey: r.leader_key,
    peakPremiumPct: r.peak_premium_pct,
  }));
  const bangerWatchSnap =
    !engineV2 && isBangerEngineEnabled()
      ? await readBangerWatchSnapshot(todayEt()).catch(() => null)
      : null;
  const lane = await getSwingServingLane({
    discover: discoverSwingFromPersisted,
    fetchOpenPositions: () => fetchOpenSwingPositions().catch(() => []),
    fetchLatestManageEvents: (ids) => fetchLatestSwingSnapshotEvents(ids).catch(() => new Map()),
    fetchBangerPositions: isBangerEngineEnabled()
      ? () => fetchBangerOpenBookRows(80).catch(() => [])
      : undefined,
    vectorLeaders,
    bangerWatchPlays: bangerWatchSnap?.plays ?? [],
    spotsByTicker: snap?.spotsByTicker,
  }).catch(() => null);

  if (!lane?.sections) {
    return { rows: [], scanAsOf: lane?.scanAsOf ?? null, scanSessionDay: lane?.scanSessionDay ?? null };
  }
  return {
    rows: rowsForSwingSection(lane.sections, "ALL"),
    scanAsOf: lane.scanAsOf ?? null,
    scanSessionDay: lane.scanSessionDay ?? null,
  };
}

async function loadOpenTerminalPlay(
  ticker: string,
  hints: { positionId?: number | null; strike?: number | null; right?: "C" | "P" | null; status?: string | null },
): Promise<TerminalPlay | null> {
  const openRows = await fetchOpenSwingPositions().catch(() => []);
  const matches = openRows.filter((r) => r.ticker.toUpperCase() === ticker.toUpperCase());
  if (!matches.length) return null;

  let row: SwingPositionRow | undefined;
  if (hints.positionId != null) {
    row = matches.find((r) => r.id === hints.positionId || r.root_position_id === hints.positionId);
  }
  if (!row && (hints.strike != null || hints.right != null)) {
    const byContract = matches.filter((r) => rowContractMatches(r, hints.strike ?? null, hints.right ?? null));
    if (byContract.length === 1) row = byContract[0];
    else if (byContract.length > 1) row = byContract[0];
  }
  if (!row && matches.length === 1) row = matches[0];
  if (!row && hints.status && WORKING.has(hints.status.toUpperCase())) {
    const working = matches.filter((r) => WORKING.has(String(r.status ?? "").toUpperCase()));
    if (working.length === 1) row = working[0];
    else if (working.length > 1 && (hints.strike != null || hints.right != null)) {
      row = working.find((r) => rowContractMatches(r, hints.strike ?? null, hints.right ?? null));
    }
    if (!row && working.length > 0) {
      row = working.sort((a, b) => (b.last_mark ?? 0) - (a.last_mark ?? 0))[0];
    }
    if (!row) row = matches[0];
  }
  if (!row) return null;

  const snap = await readSwingServingSnapshot().catch(() => null);
  const spot = snap?.spotsByTicker?.[ticker.toUpperCase()] ?? null;
  const manageEvents = await fetchLatestSwingSnapshotEvents([row.id]).catch(() => new Map());
  let lanePlay = livePlayFromSwingPosition(row, spot, manageEvents.get(row.id) ?? null);
  if (!lanePlay) return null;

  const discovery = await discoverSwingFromPersisted().catch(() => null);
  const dossiers = discovery?.dossiers ?? [];
  const dossier = dossiers.find((d) => d.ticker.toUpperCase() === ticker.toUpperCase());
  const reads = discovery?.readsByTicker?.get(ticker.toUpperCase());
  lanePlay = attachThesisExplanation(lanePlay, dossier, reads);

  return terminalPlayFromHorizon(horizonRowToDeckSource(lanePlay, row.id));
}

/**
 * Resolve the exact TerminalPlay the member selected — open ledger beats lane,
 * contract hints beat ticker-only collision.
 */
export async function resolveSwingPlayForBrief(
  input: SwingBriefResolveHints,
): Promise<{
  play: TerminalPlay;
  scanAsOf: string | null;
  scanSessionDay: string | null;
  laneRows: HorizonPlay[];
} | null> {
  const parsed = parseSwingPlayId(input.playId);
  const ticker = (input.ticker ?? parsed.ticker).toUpperCase();
  if (!ticker) return null;

  const positionId =
    input.positionId != null && Number.isFinite(input.positionId)
      ? input.positionId
      : parsed.positionId;
  const right = normalizeRight(input.right);
  const strike = input.strike != null && Number.isFinite(input.strike) ? input.strike : null;
  const status = input.status ?? null;

  const [{ rows, scanAsOf, scanSessionDay }, openPlay] = await Promise.all([
    loadLaneRows(ticker),
    loadOpenTerminalPlay(ticker, {
      positionId,
      strike,
      right,
      status,
    }),
  ]);

  if (parsed.positionId != null) {
    const closed = await loadClosedPlay(ticker, parsed.positionId);
    if (closed) return { play: closed, scanAsOf, scanSessionDay, laneRows: rows };
  }

  if (openPlay && (!status || WORKING.has(status.toUpperCase()))) {
    return { play: openPlay, scanAsOf, scanSessionDay, laneRows: rows };
  }

  const lanePlay = pickLanePlayForBrief(rows, ticker, { status, strike, right });
  if (lanePlay) {
    return {
      play: terminalPlayFromHorizon(horizonRowToDeckSource(lanePlay)),
      scanAsOf,
      scanSessionDay,
      laneRows: rows,
    };
  }

  if (parsed.positionId != null || input.playId.includes("CLOSED")) {
    const closed = await loadClosedPlay(ticker, parsed.positionId);
    if (closed) return { play: closed, scanAsOf, scanSessionDay, laneRows: rows };
  }

  const closedFallback = await loadClosedPlay(ticker, null);
  if (closedFallback) return { play: closedFallback, scanAsOf, scanSessionDay, laneRows: rows };

  return null;
}
