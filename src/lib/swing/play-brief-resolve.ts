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
  resolveBriefIvRank,
  type ParsedSwingPlayId,
} from "./play-brief-resolve-pure";
import { occSymbolFromSwingRow } from "./occ-from-row";

export { parseSwingPlayId, pickLanePlayForBrief, resolveBriefIvRank, type ParsedSwingPlayId };

const WORKING = new Set(["OPEN", "HOLD", "TRIM"]);

export type SwingBriefResolveHints = {
  playId: string;
  ticker?: string | null;
  positionId?: number | null;
  status?: string | null;
  strike?: number | null;
  right?: string | null;
};

export function horizonRowToDeckSource(
  p: HorizonPlay,
  positionId?: number | null,
  cortex?: unknown,
  occ?: string | null,
): HorizonDeckSource {
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
    entryTriggerUnderlyingPx: p.entryTriggerUnderlyingPx ?? null,
    entryPremium: p.entryPremium ?? null,
    livePnlPct: p.livePnlPct ?? null,
    peakPremium: p.peakPremium ?? null,
    troughPremium: p.troughPremium ?? null,
    markAsOf: p.markAsOf ?? null,
    manageAction: p.manageAction ?? null,
    manageReason: p.manageReason ?? null,
    thesisBreak:
      p.thesisLevel != null ? { level: p.thesisLevel, note: p.thesisNote ?? undefined } : undefined,
    sectorLeadershipFacts: p.sectorLeadershipFacts ?? null,
    // C4 IDENTITY (LARGO-PRODUCT-CONTRACT.md): committed positions have a real OCC symbol,
    // stamped at commit by `commit.ts` via `occFromChainContract` and stored as `contract_occ` —
    // the caller passes it through for a live ledger row. A WATCH/lane-only candidate has no
    // ledger row yet, so this stays null there (honest absence, never reconstructed — see
    // occ-from-row.ts's fail-closed doc comment: a guessed OCC can mismark the wrong contract).
    occ: occ ?? null,
    positionId: positionId ?? null,
    // Cortex is only pinned on a COMMITTED ledger row (swing commit.ts) — the caller passes
    // row.entry_context?.cortex for an open position; a WATCH/lane-only candidate has no row
    // yet, so this stays undefined there (honest absence, never fabricated).
    cortex,
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

/**
 * BUG FOUND 2026-09-11 (Ask Largo standing mandate — roll-narrative end-to-end trace, the natural
 * follow-up to #4794's OCC-identity fix which explicitly flagged rolls as the one case reconstruction
 * and ledger values could diverge). Every id-matching test in this file (`loadOpenTerminalPlay`'s
 * `r.id === hints.positionId || r.root_position_id === hints.positionId`, and `loadClosedPlay`'s
 * identical shape) assumes a referenced `positionId` is EITHER the live/terminal leg itself OR the
 * chain's ROOT id. That holds for a chain rolled exactly once (roll_seq 0→1): the child's
 * `root_position_id` sticks to the very first leg's own id (roll.ts's header: "the chain root is
 * sticky" — `root_position_id = parent.root_position_id ?? parent.id`), so the root id a caller
 * bookmarked before the roll still resolves the live child via `root_position_id === positionId`.
 *
 * It does NOT hold once a chain rolls a SECOND time. Consider root(id=1)→rolled child(id=2,
 * root_position_id=1)→currently-open grandchild(id=3, root_position_id=1 — sticky, not 2). A caller
 * who has id=2 cached (e.g. from a brief shown between the two rolls, or a client that stored the
 * position id at the time it first became OPEN) gets NO match anywhere: `loadOpenTerminalPlay`'s
 * openRows (status OPEN/HOLD/TRIM only) contain row 3, whose root_position_id is 1, not 2 — so
 * `r.root_position_id === 2` never matches; `loadClosedPlay`'s graded rows contain row 2 itself
 * (`r.id === 2` matches, but its own status is ROLLED so `closedDeckSourceFromRow` correctly refuses
 * it — CLOSED-only, see closed-plays.ts). The request then silently falls through to the ticker-only
 * lane/WATCH fallback (`pickLanePlayForBrief`) or a `closedFallback` for an UNRELATED chain on the
 * same ticker — the exact "silently returns the wrong play" failure mode PR-era comment above already
 * fixed for the single-roll case, reopened one roll deeper. Confirmed by tracing `root_position_id`'s
 * assignment in roll.ts (line ~10-13) against every id-matching test in this file — no code path
 * resolves an INTERMEDIATE leg's id to its chain's current state.
 *
 * FIX: resolve the referenced id's own chain root ONCE (a single extra range fetch, since
 * `fetchSwingPositionsRange` already returns every status including the intermediate ROLLED leg)
 * and retry both the open and closed lookups against that root — additively, ONLY when the direct
 * matches already in `resolveSwingPlayForBrief` come back empty, so a single-roll-or-fewer chain
 * (the overwhelming common case) pays zero extra cost and behaves byte-identically to before.
 */
async function resolveChainRootId(ticker: string, positionId: number): Promise<number> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await fetchSwingPositionsRange(since, 500).catch(() => []);
  const row = rows.find((r) => r.id === positionId && r.ticker.toUpperCase() === ticker.toUpperCase());
  if (!row) return positionId;
  return row.root_position_id ?? row.id;
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

export async function loadOpenTerminalPlay(
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

  const play = terminalPlayFromHorizon(
    horizonRowToDeckSource(
      lanePlay,
      row.id,
      row.entry_context?.cortex ?? null,
      occSymbolFromSwingRow(row),
    ),
  );
  const ivRank = resolveBriefIvRank({ dossierIvRank: dossier?.ivRank, featureVector: row.feature_vector });
  return ivRank != null ? { ...play, ivRank } : play;
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
  // Blank ticker from the route must not block playId-derived resolution (Largo tool omits ?ticker=).
  const ticker = (input.ticker?.trim() || parsed.ticker).toUpperCase();
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

  // NOTE: this checks `positionId` (the fully-resolved caller ID — a `?positionId=` query
  // param OR the playId-embedded one), never `parsed.positionId` alone. A caller supplying
  // positionId as a separate param (the route's own documented shape: `?playId=SWING:NRG&
  // ticker=NRG&positionId=34`, and Largo's tool-call convention) must resolve a CLOSED/ROLLED
  // position exactly as reliably as one embedding it in the playId string — otherwise a
  // ticker with both a historical closed position AND a current live WATCH/lane candidate
  // would silently return the WRONG, unrelated play (live repro: SWING:INTC — see FINDINGS).
  if (positionId != null) {
    const closed = await loadClosedPlay(ticker, positionId);
    if (closed) return { play: closed, scanAsOf, scanSessionDay, laneRows: rows };
  }

  if (openPlay && (!status || WORKING.has(status.toUpperCase()))) {
    return { play: openPlay, scanAsOf, scanSessionDay, laneRows: rows };
  }

  // MULTI-ROLL CHAIN FALLBACK (see resolveChainRootId's doc comment) — only reached when the direct
  // id matches above (open ledger + closed-by-id) both came back empty, so this never runs for a
  // chain rolled once or not at all; it only pays its extra lookup for the genuinely rare deeper case.
  if (positionId != null) {
    const chainRootId = await resolveChainRootId(ticker, positionId);
    if (chainRootId !== positionId) {
      const chainOpenPlay = await loadOpenTerminalPlay(ticker, { positionId: chainRootId, strike, right, status });
      if (chainOpenPlay && (!status || WORKING.has(status.toUpperCase()))) {
        return { play: chainOpenPlay, scanAsOf, scanSessionDay, laneRows: rows };
      }
      const chainClosed = await loadClosedPlay(ticker, chainRootId);
      if (chainClosed) return { play: chainClosed, scanAsOf, scanSessionDay, laneRows: rows };
    }
  }

  const lanePlay = pickLanePlayForBrief(rows, ticker, { status, strike, right });
  if (lanePlay) {
    const discovery = await discoverSwingFromPersisted().catch(() => null);
    const dossier = discovery?.dossiers?.find((d) => d.ticker.toUpperCase() === ticker);
    const reads = discovery?.readsByTicker?.get(ticker);
    const enriched = attachThesisExplanation(lanePlay, dossier, reads);
    const play = terminalPlayFromHorizon(horizonRowToDeckSource(enriched));
    const ivRank = resolveBriefIvRank({ dossierIvRank: dossier?.ivRank });
    return {
      play: ivRank != null ? { ...play, ivRank } : play,
      scanAsOf,
      scanSessionDay,
      laneRows: rows,
    };
  }

  if (positionId != null || input.playId.includes("CLOSED")) {
    const closed = await loadClosedPlay(ticker, positionId);
    if (closed) return { play: closed, scanAsOf, scanSessionDay, laneRows: rows };
  }

  const closedFallback = await loadClosedPlay(ticker, null);
  if (closedFallback) return { play: closedFallback, scanAsOf, scanSessionDay, laneRows: rows };

  return null;
}
