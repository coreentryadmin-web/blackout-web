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
import { fetchBangerOpenBookRowsSettled, fetchOpenBangerPositions } from "@/lib/banger/positions-db";
import { isBangerEngineEnabled } from "@/lib/banger/flag";
import { readBangerWatchSnapshot } from "@/lib/banger/watch-cache";
import { horizonPlayFromBangerPosition } from "./banger-lane-merge";
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
  pickOpenBangerPositionForBrief,
  resolveBriefIvRank,
  rightFromContractType,
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
  budgetVerdict?: unknown,
): HorizonDeckSource {
  return {
    ticker: p.ticker,
    direction: p.direction,
    horizon: "SWING",
    score: p.score,
    scoreWithheld: p.scoreWithheld,
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
    entryPresentPillars: p.entryPresentPillars ?? null,
    archetypeNearTie: p.archetypeNearTie ?? null,
    topFlowProvenance: p.topFlowProvenance ?? null,
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
    invalidationUnderlyingPx: p.invalidationUnderlyingPx ?? null,
    liveSpot: p.liveSpot ?? null,
    entryPremium: p.entryPremium ?? null,
    livePnlPct: p.livePnlPct ?? null,
    peakPremium: p.peakPremium ?? null,
    troughPremium: p.troughPremium ?? null,
    markAsOf: p.markAsOf ?? null,
    manageAction: p.manageAction ?? null,
    manageReason: p.manageReason ?? null,
    manageReasonDetail: p.manageReasonDetail ?? null,
    manageEnforced: p.manageEnforced ?? null,
    rollCandidate: p.rollCandidate ?? null,
    underlyingExcursion: p.underlyingExcursion ?? null,
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
    // Same shape as cortex above — the budget gate only runs at commit, so this stays undefined
    // for a WATCH/lane-only candidate (Ask Largo standing mandate, 2026-10-26, #4076 comment
    // 6410025245).
    budgetVerdict,
  };
}

function normalizeRight(right: string | null | undefined): "C" | "P" | null {
  if (!right) return null;
  const r = right.trim().toUpperCase();
  if (r === "C" || r === "CALL") return "C";
  if (r === "P" || r === "PUT") return "P";
  return null;
}

// BUG FIX (2026-10-20, Ask Largo standing mandate — same defect class as this function's sibling
// `contractMatches` in play-brief-resolve-pure.ts, found the same cycle). The old
// `if (strike == null) return true;` short-circuit ran BEFORE `right` was ever examined, so a
// caller supplying only `right` (no `strike`) matched EVERY row regardless of call/put. `strike`
// and `right` are independent, optional disambiguation hints (per the Largo tool's own documented
// call shape — any subset of positionId/strike/right/status may be supplied); each is now checked
// on its own, so a right-only request can no longer fall through to a true-by-default return.
function rowContractMatches(row: SwingPositionRow, strike: number | null, right: "C" | "P" | null): boolean {
  if (strike != null && row.contract_strike !== strike) return false;
  if (right != null) {
    // BUG FIX (2026-09-22, Ask Largo standing mandate — Largo C3 absence, same shape as #5401's
    // roll-history fix and this cycle's closed-plays.ts/live-plays.ts sibling fixes). `contract_type`
    // is a genuinely nullable DB column; the old `row.contract_type === "put" ? "P" : "C"` ternary
    // fabricated "C" for a row whose real contract type was never recorded — which meant a hint
    // asking for a specific "C" leg could FALSELY MATCH a row of unknown type (an identity bug, not
    // just a display one: this function exists specifically to fix ticker-collision misidentification,
    // per the file header). An unrecorded right can't confidently be declared EITHER "C" or "P", so
    // it now stays `null` and fails the match rather than guessing — fail-closed, consistent with
    // `normalizeRight` just above already returning `null` for anything it can't parse.
    const rowRight = rightFromContractType(row.contract_type);
    if (rowRight !== right) return false;
  }
  return true;
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
 *
 * CORRECTED 2026-11-02 (Ask Largo standing mandate): the claim above that `closedDeckSourceFromRow`
 * "correctly refuses" a ROLLED row was itself wrong — that gate was the confirmed bug this file's
 * `resolveSwingPlayForBrief` now works around explicitly (see the LIVE-CHAIN-CONTINUATION CHECK
 * comment there). `closedDeckSourceFromRow` now resolves a ROLLED row's own data same as CLOSED;
 * this chain-root lookup is still needed, but its job changed from "the ONLY way row 2 ever
 * resolves to anything" to "make sure a LIVE continuation (row 3) wins over row 2's own now-
 * resolvable, but superseded, snapshot" — reached unconditionally now, not only on a double-empty
 * direct match (see that call site).
 */
async function resolveChainRootId(ticker: string, positionId: number): Promise<number> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await fetchSwingPositionsRange(since, 500).catch(() => []);
  const row = rows.find((r) => r.id === positionId && r.ticker.toUpperCase() === ticker.toUpperCase());
  if (!row) return positionId;
  return row.root_position_id ?? row.id;
}

// BUG FIX (2026-11-01, Ask Largo standing mandate, live-reproduced on 3/3 real rolled chains
// today — AMZN root 44 vs terminal 48, AAPL root 37 vs terminal 40, INTC root 30 vs terminal 35).
// `graded` comes from `fetchSwingPositionsRange` (db.ts: `ORDER BY session_date DESC, id DESC`),
// so a rolled chain's later/CHILD leg sorts BEFORE the earlier leg it rolled from. The old
// `graded.find((r) => r.id === positionId || r.root_position_id === positionId)` predicate had no
// precedence between its two disjuncts — `Array.prototype.find` returns on the FIRST row matching
// EITHER clause, scanning in array order. So a caller asking for a specific leg's own id (e.g. the
// chain's root, 37) could have that exact match sitting LATER in `graded` than a different leg
// whose `root_position_id` happens to equal 37 — and `find` returns that wrong, later leg's entire
// outcome (P&L, closedReason, contract, dates) instead of ever reaching the exact id match.
// Live-confirmed: `?playId=SWING:AAPL:37&positionId=37` returned leg 40's "+47.4% / target" instead
// of leg 37's own "-22.3% / stopped" — the OPPOSITE outcome, not just the wrong date/contract.
// Fix: check the EXACT id match across the WHOLE array first; only fall back to the
// root_position_id match (the chain-root bookmark case — see `resolveChainRootId`'s own doc
// comment above for why that fallback exists at all) when no exact match exists anywhere.
async function loadClosedPlay(ticker: string, positionId: number | null): Promise<TerminalPlay | null> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await fetchSwingPositionsRange(since, 500).catch(() => []);
  const graded = rows.filter((r) => r.graded_at && r.ticker.toUpperCase() === ticker);
  if (graded.length === 0) return null;
  const target =
    positionId != null
      ? graded.find((r) => r.id === positionId) ?? graded.find((r) => r.root_position_id === positionId)
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
  fetchFailed: boolean;
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
      ? () => fetchBangerOpenBookRowsSettled().catch(() => [])
      : undefined,
    vectorLeaders,
    bangerWatchPlays: bangerWatchSnap?.plays ?? [],
    spotsByTicker: snap?.spotsByTicker,
  }).catch(() => null);
  // `null` here means the Promise rejected and the `.catch` above swallowed it — a real fetch
  // failure, distinct from `getSwingServingLane` resolving with a genuinely cold/empty lane.
  const fetchFailed = lane == null;

  if (!lane?.sections) {
    return {
      rows: [],
      scanAsOf: lane?.scanAsOf ?? null,
      scanSessionDay: lane?.scanSessionDay ?? null,
      fetchFailed,
    };
  }
  return {
    rows: rowsForSwingSection(lane.sections, "ALL"),
    scanAsOf: lane.scanAsOf ?? null,
    scanSessionDay: lane.scanSessionDay ?? null,
    fetchFailed,
  };
}

// BUG FIX (2026-10-26, Ask Largo standing mandate, live repro PANW positionId=2103). The
// 2026-10-24 fix just above (the "lone candidate" guard) correctly stopped this function from
// substituting an UNRELATED row when a caller's requested `positionId` failed to match — but it
// left the resulting "no match" case returning bare absence even when the requested id genuinely
// IS a live, open position, just one that lives in `banger_positions`, not `swing_positions`.
// `getSwingServingLane` (serving-lane.ts, fed via this file's own `loadLaneRows`) merges BOTH
// origins per ticker but keeps only one row when a native-engine row and a banger-origin row
// share the same ticker — so once a banger-origin position's OWN lane/discovery candidate entry
// ages out of that merge, its ONLY surviving path to a brief was this function, which never
// queried `banger_positions` at all. Live-confirmed: PANW carries a native swing_positions COMMIT
// row (id 67) AND a separate, fully live banger_positions OPEN row (id 2103, confirmed via
// `GET /api/market/banger/board`) — `?playId=SWING:PANW&ticker=PANW&positionId=2103` resolved to
// a flat 404 "play not found" for a position a member is actually holding right now. Fixed by
// falling through to a banger-origin lookup whenever the native lookup (above) found nothing —
// additive, so a ticker that only ever lives in `swing_positions` behaves byte-identically to
// before.
async function loadOpenBangerTerminalPlay(
  ticker: string,
  hints: { positionId?: number | null },
): Promise<TerminalPlay | null> {
  const bangerRows = await fetchOpenBangerPositions().catch(() => []);
  const row = pickOpenBangerPositionForBrief(bangerRows, ticker, hints.positionId ?? null);
  if (!row) return null;

  const horizonPlay = horizonPlayFromBangerPosition(row);
  if (!horizonPlay) return null;
  return terminalPlayFromHorizon(
    horizonRowToDeckSource(
      horizonPlay,
      row.id,
      row.entry_context?.cortex ?? null,
      row.contract_occ,
      row.entry_context?.budget_verdict ?? null,
    ),
  );
}

export async function loadOpenTerminalPlay(
  ticker: string,
  hints: { positionId?: number | null; strike?: number | null; right?: "C" | "P" | null; status?: string | null },
): Promise<TerminalPlay | null> {
  const openRows = await fetchOpenSwingPositions().catch(() => []);
  const matches = openRows.filter((r) => r.ticker.toUpperCase() === ticker.toUpperCase());
  if (!matches.length) {
    return isBangerEngineEnabled() ? loadOpenBangerTerminalPlay(ticker, hints) : null;
  }

  let row: SwingPositionRow | undefined;
  if (hints.positionId != null) {
    // BUG FIX (2026-11-01, Ask Largo standing mandate) — same unsafe `find()` shape as
    // `loadClosedPlay`'s fix above (see its doc comment for the live-reproduced root cause):
    // an OR predicate with no precedence between an exact id match and a root_position_id
    // fallback match. `matches` is the OPEN-only population here (not `graded`), so the
    // live-reproduced collision is rarer in practice (a rolled-forward parent leg is normally
    // CLOSED/ROLLED, not OPEN/HOLD/TRIM) — but the same exact-match-first precedence is the
    // only version of this check that is correct regardless of array order, so it is fixed
    // identically rather than left relying on that lower-probability absence of collision.
    row = matches.find((r) => r.id === hints.positionId) ?? matches.find((r) => r.root_position_id === hints.positionId);
  }
  if (!row && (hints.strike != null || hints.right != null)) {
    const byContract = matches.filter((r) => rowContractMatches(r, hints.strike ?? null, hints.right ?? null));
    if (byContract.length === 1) row = byContract[0];
    else if (byContract.length > 1) row = byContract[0];
  }
  // BUG FIX (2026-10-24, Ask Largo standing mandate, live repro PANW: `?playId=SWING:PANW:2103`
  // resolved to the ledger's own PANW:67 row via THIS shortcut). `hints.positionId` already failed
  // to match any row above (line ~280) — if the caller named a specific position and this ticker's
  // one remaining open ledger row isn't it, that row is not an honest match, it's the only other
  // ledger candidate on the same name. Taking it anyway served an unrelated position's entry/mark/
  // P&L under the requested positionId with the response's own `playId` silently reporting back a
  // DIFFERENT id than what was asked for. Only take this "lone candidate" guess when no positionId
  // was requested at all — the exact same fail-closed rule this file's own 2026-10-20
  // `closedFallback` fix already states: "an explicit, unresolvable positionId must surface as
  // absence, never as an unrelated substitute."
  if (!row && matches.length === 1 && hints.positionId == null) row = matches[0];
  // BUG FIX (2026-10-31, Ask Largo standing mandate, live repro MRNA — three concurrent open swing
  // positions on one ticker: a native swing_positions row (#68, 195C) plus two banger-origin
  // positions (#2240 225C, #2167 217.5C) that never appear in `matches` at all, since `matches` is
  // built solely from `fetchOpenSwingPositions()` (the native table, line ~318 above). The
  // positionId check (line ~326) and the strike/right check (line ~328-332) both correctly FAILED
  // to match row #68 against a requested banger positionId/strike — but this status-only fallback
  // used to run unconditionally whenever `row` was still unset, with no check on WHY it was unset.
  // Since row #68 happened to be the ticker's one WORKING-status native row, `working[0]` below
  // took it directly WITHOUT ever re-validating it against the positionId/strike/right hint that had
  // already, explicitly, failed to match it moments earlier — silently substituting an unrelated
  // position instead of falling through to `loadOpenBangerTerminalPlay` (reached a few lines down,
  // the existing banger-lookup fallback already shipped for the analogous PANW incident above).
  //
  // Live repro: `GET /api/market/swing/play-brief?playId=SWING:MRNA:2240&ticker=MRNA&
  // positionId=2240&status=HOLD&strike=225&right=C` — the EXACT shape `useSwingPlayBrief`'s
  // `briefUrl()` builds (playId + ticker + positionId + status + strike + right) — resolved to
  // `SWING:MRNA:68` (the wrong, unrelated 195C position, "TRIM 100%") instead of `SWING:MRNA:2240`
  // (225C). The identical shape for positionId=2167/strike=217.5 ALSO wrongly resolved to #68.
  // Removing ONLY `status` from the same request (keeping positionId/strike/right) correctly
  // resolved #2240/#2167 respectively — isolating `status` as the trigger.
  //
  // Fix: only take the status-only guess when the caller supplied NO specific identifying hint at
  // all (no positionId, no strike, no right) — the legitimate case this block exists for: a plain
  // "ticker + status" query against an otherwise-ambiguous ticker with no contract-level hint to
  // disambiguate by. A positionId/strike/right hint that was supplied and already failed to match
  // any row in `matches` now falls straight through to the final `if (!row)` banger-lookup fallback
  // below instead, exactly as it already does when `matches` itself is empty — never silently
  // overridden by a same-ticker row's status alone.
  const hasSpecificContractHint = hints.positionId != null || hints.strike != null || hints.right != null;
  if (!row && !hasSpecificContractHint && hints.status && WORKING.has(hints.status.toUpperCase())) {
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
  if (!row) {
    return isBangerEngineEnabled() ? loadOpenBangerTerminalPlay(ticker, hints) : null;
  }

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
      row.entry_context?.budget_verdict ?? null,
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
  laneRowsFetchFailed: boolean;
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

  const [{ rows, scanAsOf, scanSessionDay, fetchFailed: laneRowsFetchFailed }, openPlay] = await Promise.all([
    loadLaneRows(ticker),
    loadOpenTerminalPlay(ticker, {
      positionId,
      strike,
      right,
      status,
    }),
  ]);

  // LIVE-CHAIN-CONTINUATION CHECK (2026-11-02, Ask Largo standing mandate — necessary companion to
  // the `closedDeckSourceFromRow` fix below this same mandate shipped the same day). That fix made
  // `loadClosedPlay` correctly resolve a ROLLED row's OWN data (closed-plays.ts's gate used to
  // refuse it outright) — the right call for the common case this file's #7316 fix exists for (a
  // root/intermediate leg whose chain has FINISHED: its terminal leg is itself CLOSED, nothing live
  // remains). But it reopens exactly the failure the MULTI-ROLL CHAIN FALLBACK below was built for
  // on 2026-09-11: a chain rolled a SECOND time, where the caller names an intermediate leg's own
  // id (e.g. a client that cached it while that leg was still OPEN) and the chain's REAL current
  // state is a DIFFERENT, still-live leg further down the same chain. Once the ROLLED gate accepted
  // that intermediate leg's own row, the direct `loadClosedPlay` check a few lines below would
  // short-circuit on that leg's stale snapshot before the multi-roll fallback ever got a chance to
  // walk forward to the live leg — silently serving a finished, superseded leg's numbers for a
  // request whose real intent (per that 2026-09-11 fix's own test) is "where does this chain stand
  // now". Resolving the chain's root ONCE here and checking for a currently-live (OPEN/HOLD/TRIM)
  // leg BEFORE trusting any closed/rolled match preserves both intents correctly: a chain with NO
  // live leg left (every real repro this task fixes — AMZN/AAPL/INTC, all single-roll, terminal leg
  // CLOSED) finds nothing here (`chainRootId === positionId` when the requested id IS the chain
  // root, or the chain-root open lookup comes back empty) and falls straight through, unaffected,
  // to the direct closed check below; a chain that HAS since rolled further prefers that live leg,
  // exactly as before. `chainRootId` is computed once and reused by the CLOSED half of the
  // multi-roll fallback further down, rather than re-fetching the same 90-day range twice.
  let chainRootId: number | null = null;
  if (positionId != null) {
    chainRootId = await resolveChainRootId(ticker, positionId);
    if (chainRootId !== positionId) {
      const chainOpenPlay = await loadOpenTerminalPlay(ticker, { positionId: chainRootId, strike, right, status });
      if (chainOpenPlay && (!status || WORKING.has(status.toUpperCase()))) {
        return { play: chainOpenPlay, scanAsOf, scanSessionDay, laneRows: rows, laneRowsFetchFailed };
      }
    }
  }

  // NOTE: this checks `positionId` (the fully-resolved caller ID — a `?positionId=` query
  // param OR the playId-embedded one), never `parsed.positionId` alone. A caller supplying
  // positionId as a separate param (the route's own documented shape: `?playId=SWING:NRG&
  // ticker=NRG&positionId=34`, and Largo's tool-call convention) must resolve a CLOSED/ROLLED
  // position exactly as reliably as one embedding it in the playId string — otherwise a
  // ticker with both a historical closed position AND a current live WATCH/lane candidate
  // would silently return the WRONG, unrelated play (live repro: SWING:INTC — see FINDINGS).
  if (positionId != null) {
    const closed = await loadClosedPlay(ticker, positionId);
    if (closed) return { play: closed, scanAsOf, scanSessionDay, laneRows: rows, laneRowsFetchFailed };
  }

  if (openPlay && (!status || WORKING.has(status.toUpperCase()))) {
    return { play: openPlay, scanAsOf, scanSessionDay, laneRows: rows, laneRowsFetchFailed };
  }

  // MULTI-ROLL CHAIN FALLBACK, CLOSED half (see resolveChainRootId's doc comment) — the OPEN half
  // now runs earlier above (so a live continuation wins before a closed/rolled match can
  // short-circuit); this half is only reached when direct open/closed AND the live-continuation
  // check above all came back empty, so it never runs for a chain rolled once or not at all.
  if (positionId != null && chainRootId != null && chainRootId !== positionId) {
    const chainClosed = await loadClosedPlay(ticker, chainRootId);
    if (chainClosed) return { play: chainClosed, scanAsOf, scanSessionDay, laneRows: rows, laneRowsFetchFailed };
  }

  // Lane rows (`rows`, from `loadLaneRows`) are WATCH/COMMIT/live-candidate reads — the serving
  // lane never carries a CLOSED status (confirmed: `serving-lane.ts` has no CLOSED status path).
  // `pickLanePlayForBrief` also never consults `hints.status` — it matches on ticker (+ optional
  // positionId/strike/right) alone. So a caller explicitly asking for the CLOSED play via
  // `status=CLOSED` with no `positionId` (Largo's own tool-call shape when it only has a ticker)
  // used to fall into this branch and silently get whichever ACTIVE lane play shares the ticker
  // instead — a different contract, a different outcome, presented as if it were the requested
  // closed play. Live repro 2026-09-27: `?playId=SWING:HUT&ticker=HUT&status=CLOSED` (no
  // positionId) returned the live TRIM 100C play instead of the closed STOPPED 106C play; the
  // identical request WITH `positionId` correctly resolved the closed play (confidence: high).
  // Same ticker-collision failure class the positionId-based fixes above and in
  // `loadOpenTerminalPlay`/`resolveChainRootId` already guard against — this was the one path
  // that never checked `status` at all. Skip the lane fallback outright for an explicit CLOSED
  // request so it falls through to the closed-lookup fallbacks below instead.
  const wantsClosed = status != null && status.toUpperCase() === "CLOSED";
  const lanePlay = wantsClosed ? null : pickLanePlayForBrief(rows, ticker, { status, strike, right, positionId });
  if (lanePlay) {
    const discovery = await discoverSwingFromPersisted().catch(() => null);
    const dossier = discovery?.dossiers?.find((d) => d.ticker.toUpperCase() === ticker);
    const reads = discovery?.readsByTicker?.get(ticker);
    const enriched = attachThesisExplanation(lanePlay, dossier, reads);
    // BUG FIX (Ask Largo standing mandate, 2026-10-07, live repro SG 9C/9.5C — two concurrent
    // banger-origin positions). This call used to be `horizonRowToDeckSource(enriched)` — no
    // second argument — and that function's own body does `positionId: positionId ?? null`,
    // reading ONLY the (omitted) parameter, NEVER `p.positionId`. `enriched.positionId` already
    // carries the real, correctly-resolved id here (banger_positions.id for a banger-origin leg,
    // or the swing_positions id — `pickLanePlayForBrief`, proven by the 2026-09-21 ABTC test
    // above, already resolves the SPECIFIC leg when a positionId/strike/right hint disambiguates
    // one), but it was silently dropped on the floor, so the resulting `TerminalPlay.id` never
    // carried a positionId suffix for ANY lane-resolved play. `bookContextSection`
    // (play-brief-intel.ts) parses that id back out via `parseSwingPlayId` to get
    // `excludePositionId` for `checkPortfolioOverlap`'s identity-based self-exclusion — with it
    // always null, self-exclusion silently fell back to `excludeSelfMatch: true`'s FIRST-
    // ticker+direction-match-in-array heuristic (portfolio.ts), which is DB-query-order-dependent,
    // not identity-based. Live-confirmed: reviewing SG's 9C leg (entry $0.33) and reviewing SG's
    // 9.5C leg (entry $0.23) BOTH rendered "Book context" citing the SAME banger id (#1396) as "a
    // separate position" — impossible unless one of the two reviews was citing ITSELF.
    // `loadOpenTerminalPlay` (a few lines up in this same file) already passes `row.id` through
    // correctly for its own swing-ledger path — this mirrors that.
    const play = terminalPlayFromHorizon(horizonRowToDeckSource(enriched, enriched.positionId ?? null));
    const ivRank = resolveBriefIvRank({ dossierIvRank: dossier?.ivRank });
    return {
      play: ivRank != null ? { ...play, ivRank } : play,
      scanAsOf,
      scanSessionDay,
      laneRows: rows,
      laneRowsFetchFailed,
    };
  }

  if (positionId != null || input.playId.includes("CLOSED")) {
    const closed = await loadClosedPlay(ticker, positionId);
    if (closed) return { play: closed, scanAsOf, scanSessionDay, laneRows: rows, laneRowsFetchFailed };
  }

  // BUG FIX (2026-10-20, Ask Largo standing mandate, adversarially verified). This fallback used to
  // run UNCONDITIONALLY — reached whenever every earlier, positionId-targeted lookup above (the
  // open ledger, both positionId-based closed checks, the chain-root retry) came back empty, with
  // no check on whether the caller had actually supplied a specific positionId that simply failed
  // to resolve (e.g. one outside loadClosedPlay/fetchSwingPositionsRange's own 90-day fetch window).
  // `loadClosedPlay(ticker, null)` ignores positionId entirely and returns whichever graded row for
  // the ticker has the most recent `graded_at` — a completely different trade than the one asked
  // about. That is exactly the "silently returns the wrong play" failure mode this file's own
  // `resolveChainRootId` doc comment above already names, just via a different trigger (a stale
  // positionId rather than a multi-roll chain) — and `loadSwingPlayBriefContext` (play-brief-
  // context.ts) already treats a `null` return here as the correct, honestly-handled "not found"
  // signal, so there is a working absence path this fallback was bypassing. Only take the
  // ticker-wide "whichever is most recent" guess when the caller never asked about a specific
  // position in the first place — an explicit, unresolvable positionId must surface as absence,
  // never as an unrelated substitute.
  // BUG FIX (2026-10-26, Ask Largo standing mandate, live repro MSTR — same failure CLASS as the
  // 2026-10-20 fix just above, caught by a different trigger). That fix stopped this fallback from
  // substituting an unrelated trade when a caller named a specific POSITION that failed to resolve.
  // It left untouched the mirror case: a caller that names a specific LIVE-LANE STATE instead (the
  // route's own documented `status=WATCH|COMMIT|OPEN|...` hint, used with NO positionId because a
  // WATCH/lane-only candidate has no ledger row to embed one — see `horizonRowToDeckSource`'s own
  // comment above). `wantsClosed` (used for the lane-lookup skip a few lines up) already encodes
  // exactly this distinction; this fallback just never consulted it.
  //
  // Live-confirmed 2026-10-26: `GET /api/market/swing/play-brief?playId=SWING:MSTR&ticker=MSTR&
  // status=WATCH` — the EXACT request shape `useSwingPlayBrief`'s `briefUrl()` builds for a WATCH-
  // bucket TerminalPlay (no embedded positionId; `status` set from `play.status`) and the EXACT
  // shape Largo's own `get_swing_play_brief` tool sends when it passes a `status` hint read off an
  // earlier `get_swing_horizon` call — returned `available:true` with a `STOPPED — MSTR 160C
  // 4DTE` CLOSED brief (-62.31% realized) while MSTR was a live, currently-listed WATCH candidate
  // on the SAME session's board (`/horizons?view=swings`). Root cause: the live WATCH lane had
  // (very briefly, confirmed via two `/horizons` reads minutes apart) no MSTR row at the instant
  // this route ran, so `pickLanePlayForBrief` legitimately found nothing — but with `positionId`
  // always null for a lane-only candidate, this fallback ran anyway and silently handed back MSTR's
  // unrelated, weeks-old, heavily-losing closed trade AS IF it answered the WATCH request, with no
  // absence/retryable signal of any kind. `useSwingPlayBrief` polls every 8-20s during RTH
  // (`briefRefreshMs`), so a member with this exact panel open could have it silently swap from a
  // live WATCH view to a -62% STOPPED headline on an ordinary auto-refresh — and Largo could narrate
  // the same substitution as fact in a chat answer. Only take the ticker-wide "whichever is most
  // recent" guess when the caller either never named a status at all (the ambiguous ticker-only
  // query both the route and Largo's tool doc describe as the common case) or explicitly asked for
  // CLOSED — never when they named a specific live-lane state that this lookup failed to honor.
  const explicitlyWantsLiveState = status != null && !wantsClosed;
  if (positionId == null && !explicitlyWantsLiveState) {
    const closedFallback = await loadClosedPlay(ticker, null);
    if (closedFallback) return { play: closedFallback, scanAsOf, scanSessionDay, laneRows: rows, laneRowsFetchFailed };
  }

  return null;
}
