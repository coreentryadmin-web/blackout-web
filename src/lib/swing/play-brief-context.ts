/**
 * Server-side context loader for the Swing Play Intelligence Engine.
 * Reads the same caches / DB rows Largo tools use — no provider fan-out, no LLM.
 */
import {
  fetchOpenSwingPositions,
  fetchLatestSwingSnapshotEvents,
  fetchSwingPositionsRange,
  fetchSwingPositionChain,
} from "@/lib/db";
import { getSwingServingLane, discoverSwingFromPersisted, readSwingServingSnapshot } from "@/lib/swing/serving-lane";
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
import { closedDeckSourcesFromChains } from "@/lib/swing/closed-plays";
import { rowsForSwingSection } from "@/features/nighthawk/command-deck/swing-section-filter";
import { fetchEcosystemContext } from "@/lib/bie/ecosystem-context";
import { fetchVectorFullState } from "@/lib/bie/vector-full-state";
import { etStamp } from "@/lib/largo/temporal/bar-session-date";
import { normalizeDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import type { SwingPlayBriefContext } from "./play-brief-types";
import { etSessionDate, etStamp } from "@/lib/largo/temporal/bar-session-date";

function horizonRowToDeckSource(p: HorizonPlay): HorizonDeckSource {
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
  };
}

function parseSwingPlayId(playId: string): { ticker: string; positionId: number | null } {
  const parts = playId.split(":").filter(Boolean);
  const ticker = (parts[1] ?? parts[0] ?? "").toUpperCase();
  const pos = parts[2] != null ? Number(parts[2]) : null;
  return { ticker, positionId: pos != null && Number.isFinite(pos) ? pos : null };
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
  const chain = await fetchSwingPositionChain(target.root_position_id ?? target.id).catch(() => []);
  const closed = closedDeckSourcesFromChains([chain]);
  const src = closed.find((c) => c.ticker.toUpperCase() === ticker);
  return src ? terminalPlayFromClosedSwing(src) : null;
}

async function loadLanePlay(ticker: string): Promise<{ play: HorizonPlay | null; scanAsOf: string | null; scanSessionDay: string | null }> {
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

  if (!lane?.sections) return { play: null, scanAsOf: lane?.scanAsOf ?? null, scanSessionDay: lane?.scanSessionDay ?? null };
  const rows = rowsForSwingSection(lane.sections, "ALL");
  const play = rows.find((p) => p.ticker.toUpperCase() === ticker.toUpperCase()) ?? null;
  return { play, scanAsOf: lane.scanAsOf ?? null, scanSessionDay: lane.scanSessionDay ?? null };
}

/**
 * Resolve a swing play for brief composition. Prefers the live lane; falls back to closed ledger.
 */
export async function loadSwingPlayBriefContext(input: {
  playId: string;
  ticker?: string | null;
}): Promise<SwingPlayBriefContext | null> {
  const parsed = parseSwingPlayId(input.playId);
  const ticker = (input.ticker ?? parsed.ticker).toUpperCase();
  if (!ticker) return null;

  const [{ play: lanePlay, scanAsOf, scanSessionDay }, ecosystem, vector] = await Promise.all([
    loadLanePlay(ticker),
    fetchEcosystemContext(ticker).catch(() => null),
    fetchVectorFullState(ticker, normalizeDteHorizon("all")).catch(() => null),
  ]);

  let terminal: TerminalPlay | null = null;
  if (lanePlay) {
    terminal = terminalPlayFromHorizon(horizonRowToDeckSource(lanePlay));
  } else if (parsed.positionId != null || input.playId.includes("CLOSED")) {
    terminal = await loadClosedPlay(ticker, parsed.positionId);
  } else {
    terminal = await loadClosedPlay(ticker, null);
  }

  if (!terminal) return null;

  const nowMs = Date.now();
  const asOf = etStamp(nowMs) ?? new Date(nowMs).toISOString();
  return {
    play: terminal,
    asOf,
    sessionDate: etSessionDate(nowMs),
    scanAsOf,
    scanSessionDay,
    ecosystem,
    vector,
  };
}
