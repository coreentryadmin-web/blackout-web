/**
 * Server-side context loader for the Swing Play Intelligence Engine.
 * Reads the same caches / DB rows Largo tools use — no provider fan-out, no LLM.
 */
import { fetchEcosystemContext } from "@/lib/bie/ecosystem-context";
import { fetchVectorFullState } from "@/lib/bie/vector-full-state";
import { fetchOpenSwingPositions, fetchSwingPositionById, fetchSwingPositionChain } from "@/lib/db";
import { buildSwingRecord } from "./record";
import { fetchBangerOpenBookRows } from "@/lib/banger/positions-db";
import { isBangerEngineEnabled } from "@/lib/banger/flag";
import { etSessionDate, etStamp } from "@/lib/largo/temporal/bar-session-date";
import { normalizeDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import type { SwingPlayBriefContext, SwingRollHistory } from "./play-brief-types";
import { resolveSwingPlayForBrief, type SwingBriefResolveHints } from "./play-brief-resolve";
import { reconcileLivePnlPctWithDisplayMark } from "./play-brief-resolve-pure";
import { fetchMeridianForTicker } from "./play-brief-meridian";
import { fetchMeridianPeerForBrief } from "./play-brief-meridian-peer";
import type { PortfolioPosition } from "./portfolio";
import { readSwingArchetypeTrackRecord } from "./calibration-cache";
import { withBriefSourceTimeout } from "./brief-source-timeout";
import { swingRollHistoryLegFromRow } from "./play-brief-roll-history";
import { loadTickerTrackRecord } from "./play-brief-ticker-history";

/**
 * The network-bound reads below (Meridian timeline/peer-cohort, ecosystem context, Vector
 * full-state) carry no timeout of their own, so an upstream stall used to propagate all the way
 * to Cloudflare's edge (~100s) before the member ever saw an error — a raw 504 instead of this
 * route's own graceful `degraded` response. Measured live 2026-09-09: a `play-brief` request
 * hung past a 120s client-side timeout while ALB TargetResponseTime for the same window showed
 * repeated p99 spikes to 90-104s. `withBriefSourceTimeout` (brief-source-timeout.ts) races each
 * call against an 8s budget so a single slow source degrades to "unavailable" for THIS section
 * instead of hanging the whole brief. This helper REJECTS on timeout (rather than degrading to
 * null itself) so callers that need to distinguish "genuinely no data" from "upstream stalled"
 * (the ecosystem/vector `*FetchFailed` flags below) still can — the archetype-track-record read
 * has no such distinction to make, so it wraps its own call in `.catch(() => null)`.
 */

/**
 * The member's full open book as `PortfolioPosition[]` for the "Book context" theme-overlap
 * section. `direction` on the ledger row is lowercase ("long"/"short"); the overlap checker
 * (and the swing entry gate it shares code with) works in uppercase `PlayDirection`. The play
 * under review is NOT filtered out here — `bookContextSection` passes the reviewed play's ledger
 * id into `checkPortfolioOverlap` so the correct row is excluded even when multiple independent
 * positions share ticker+direction.
 *
 * FIX (Ask Largo standing mandate, 2026-09-12): this used to return ONLY `swing_positions` rows.
 * Engine B (Banger) open positions live in the entirely separate `banger_positions` table and are
 * merged into the Swing lane's DISPLAY by banger-lane-merge.ts, but nothing merged them into THIS
 * book — so `bookContextSection`'s theme/direction overlap check was blind to them. Confirmed live
 * 2026-09-12 (GET /api/market/nighthawk/horizons?view=swings): of 85 open SWING-lane positions, 80
 * (94%) are banger-origin — and since the 5 remaining swing-ledger-native positions independently
 * share no theme/direction with each other right now, "Book context" was not merely under-firing,
 * it never fired for ANY reviewed play at all (verified across every open position sampled: AAPL,
 * NRG, NN, CG, CRWD, plus several banger-origin tickers). This is the same fail-soft,
 * flag-gated (`isBangerEngineEnabled`) merge pattern `fetchActiveSwingPlaysForMarks`
 * (live-marks-active.ts) already uses for the live-marks lane — mirrored here rather than
 * reinvented, so a disabled Engine B (`BANGER_ENGINE_ENABLED=0`) correctly leaves this book
 * swing-only, same as it already leaves the marks lane and the horizons board swing-only.
 */
async function loadOpenBook(): Promise<PortfolioPosition[] | null> {
  try {
    const rows = await fetchOpenSwingPositions();
    const swingPositions: PortfolioPosition[] = rows.map((r) => ({
      ticker: r.ticker,
      direction: r.direction === "short" ? ("SHORT" as const) : ("LONG" as const),
      positionId: r.id,
    }));

    let bangerPositions: PortfolioPosition[] = [];
    if (isBangerEngineEnabled()) {
      try {
        const bangerRows = await fetchBangerOpenBookRows();
        // `positionId` is deliberately left UNSET here (never `bangerRow.id`) — banger_positions
        // and swing_positions are separate DB sequences that CAN collide on numeric id, and
        // `checkPortfolioOverlap`'s `excludePositionId` trusts that id as an exact identity match;
        // stamping a banger row's id as a swing positionId risks excluding (or wrongly matching)
        // an unrelated row on a coincidental collision — the same risk play-brief.ts's
        // `siblingPositionsNote` (2026-09-11) already documented for this exact pair of tables.
        // Leaving it unset falls back to `checkPortfolioOverlap`'s ticker+direction self-exclusion,
        // which is exact here: every banger position is a long call (banger-lane-merge.ts hardcodes
        // `direction: "LONG"` — `banger_positions` has no `direction` column at all), so there is no
        // per-row direction to get wrong.
        //
        // `bangerId` (distinct from `positionId` above, never read by the exclude/match logic) DOES
        // carry the real banger_positions row id — display-only, so two genuinely separate Banger
        // positions on the same ticker (a real, live case: two independently-committed CRWD LONGs)
        // can be told apart in the rendered concentration list instead of both showing the identical
        // bare "CRWD LONG (separate, cross-engine position)" text. See `PortfolioPosition.bangerId`'s
        // own doc comment (portfolio.ts) for why this is a new field, not a reuse of `positionId`.
        bangerPositions = bangerRows.map((r) => ({ ticker: r.ticker, direction: "LONG" as const, bangerId: r.id }));
      } catch {
        /* fail-soft — the swing-ledger book still renders without the banger merge */
      }
    }

    return [...swingPositions, ...bangerPositions];
  } catch {
    return null;
  }
}

/**
 * Roll history disclosure (Ask Largo ownership mandate, 2026-09-11): `record.ts`'s chain
 * composite has always had the full `roll_seq` thread available, but the narrative never
 * mentioned it — a member reading "Trade manager read" on a twice-rolled position had no way to
 * know from the brief alone that it wasn't the original entry. Never rolled → `null` (Largo C6
 * omission, not a fabricated "no rolls" line); ledger read failure → `null` (best-effort, same
 * discipline as `archetypeTrackRecord` above — a brief must compose the same whether this landed).
 * `positionId` is the resolved LEG's own id (may be a child, not the chain root — WATCH candidates
 * have no `positionId` at all), so this looks up the row first to get its sticky `root_position_id`
 * before walking the chain (`fetchSwingPositionChain` only matches by root, per its own doc comment).
 */
/**
 * `TerminalPlay` has no discrete `positionId` field — `terminalPlayFromHorizon` (adapters.ts)
 * bakes it into the `id` string as `${horizon}:${ticker}:${positionId}` (a WATCH/lane-only
 * candidate's `id` carries no trailing id at all, e.g. `SWING:NRG`, and correctly parses to
 * `null` here — no ledger row means no chain to walk).
 */
function positionIdFromPlayId(id: string): number | null {
  const m = /:(\d+)$/.exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// BUG FOUND (Ask Largo standing mandate, 2026-10-08): `positionIdFromPlayId` above extracts the
// trailing numeric id from `resolved.play.id` regardless of WHICH table that id actually belongs
// to. For a banger-origin SWING-lane row, `terminalPlayFromHorizon`/`banger-lane-merge.ts` bakes
// the row's `banger_positions.id` into that exact same `${horizon}:${ticker}:${positionId}` shape
// (banger-lane-merge.ts line ~115: `positionId: row.id`) — `play-brief-context.test.ts`'s own
// `loadOpenBook()` regression already documents this precisely ("a banger row's own id must NOT
// be stamped as positionId — banger_positions and swing_positions are separate id sequences that
// CAN collide") and fixed it for the book-context overlap check, but `loadRollHistory` and
// `resolveRootPositionId` below were never given the same guard: both call
// `fetchSwingPositionById(positionId)`, which is a flat `SELECT * FROM swing_positions WHERE id =
// $1` — for a banger-origin play that id has NOTHING to do with `swing_positions`, so any row it
// happens to match there (by sheer numeric coincidence, once that table's own sequence grows far
// enough) belongs to a COMPLETELY UNRELATED position, possibly a different ticker/direction/
// strike entirely. `resolveRootPositionId`'s mis-resolution is low-blast-radius (its only use is a
// ticker-scoped self-exclusion, so a wrong, unrelated-ticker root id just fails to match anything
// and is a harmless no-op) — but `loadRollHistory`'s is NOT: its output renders verbatim as
// "Trade manager read"'s roll-history disclosure (`rollHistoryLine`, play-brief-narrative.ts) with
// zero downstream ticker cross-check, so a collision would show the member someone else's real
// strike/expiry/P&L as if it were THIS play's own prior leg — a direct Largo product-contract
// IDENTITY violation (LARGO-PRODUCT-CONTRACT.md), not merely cosmetic. Not currently live-
// triggered (verified 2026-10-08: `swing_positions`'s own native sequence sits in the low tens —
// GET /api/market/swing/record's closedDeck/records top out at positionId 50 — while
// `banger_positions` is already past 1550, so the ranges don't overlap TODAY), but it is a live
// landmine with no guard against ever firing, and exactly the same identity-collision class this
// file already treats as a real bug everywhere else it's found (see `loadOpenBook`'s own comment
// just above, and `rowContractMatches`/`normalizeRight`'s fail-closed discipline in
// play-brief-resolve.ts). Fix: require the ticker on the row that `fetchSwingPositionById`
// returns to match the reviewed play's own ticker before trusting it — the EXACT same fail-closed
// identity check this codebase already applies to strike/right matches, just extended to this one
// remaining id-based lookup. A mismatch (or a genuinely nonexistent row) returns the same honest
// `null` either function already returns for "no ledger row" — never fabricated, per this file's
// standing Largo C6 omission discipline.
async function loadRollHistory(
  positionId: number | null | undefined,
  ticker: string,
): Promise<SwingRollHistory | null> {
  if (positionId == null) return null;
  try {
    const row = await fetchSwingPositionById(positionId);
    if (!row || row.ticker.toUpperCase() !== ticker.toUpperCase()) return null;
    const rootId = row.root_position_id ?? row.id;
    const chain = await fetchSwingPositionChain(rootId);
    if (chain.length < 2) return null; // never rolled — nothing to disclose
    // Same function record.ts's own route (/api/market/swing/record) and the Closed-tab list view
    // (closedDeckSourcesFromChains) use — never recomputed here, so this can't drift from either.
    // Only cite the composite once the chain has actually closed; a still-rolling chain's "worst
    // leg so far" isn't the chain's real result yet.
    const { composite } = buildSwingRecord(chain);
    return {
      rollCount: chain.length - 1,
      legs: chain.map((r) => swingRollHistoryLegFromRow(r)),
      chainComposite: composite.chainResolved ? composite : null,
    };
  } catch {
    return null;
  }
}

/**
 * Root position id for the chain backing `positionId`, when it has a ledger row — used to
 * self-exclude the reviewed play's own chain from its ticker-scoped "prior trades" citation
 * (play-brief-ticker-history.ts). A WATCH/lane-only candidate has no `positionId` at all (nothing
 * to exclude — every closed chain on the ticker is genuinely "prior"). Best-effort like every
 * other context read here: a DB hiccup returns `null` (no exclusion applied) rather than failing.
 * Same banger/swing id-collision guard as `loadRollHistory` just above — see its comment for the
 * full story; here a mismatch is lower-stakes (a wrongly-resolved root id just fails to match
 * anything in the ticker-scoped history it's meant to exclude from), but there's no reason to
 * leave this call site exposed to the same bug class once it's fixed next door.
 */
async function resolveRootPositionId(positionId: number | null, ticker: string): Promise<number | null> {
  if (positionId == null) return null;
  try {
    const row = await fetchSwingPositionById(positionId);
    if (!row || row.ticker.toUpperCase() !== ticker.toUpperCase()) return null;
    return row.root_position_id ?? row.id;
  } catch {
    return null;
  }
}

export type LoadSwingPlayBriefInput = SwingBriefResolveHints;

/**
 * Resolve a swing play for brief composition — open ledger + contract hints beat
 * naive ticker-only lane lookup.
 */
export async function loadSwingPlayBriefContext(
  input: LoadSwingPlayBriefInput,
): Promise<SwingPlayBriefContext | null> {
  const resolved = await resolveSwingPlayForBrief(input);
  if (!resolved) return null;

  // BUG FIX (2026-10-09, Ask Largo standing mandate — live CTVA repro, positionId 1483): every
  // section downstream (`composeSwingPlayBrief` and the ~6 call sites across
  // play-brief-narrative.ts/-coaching.ts/-intel.ts that read `play.pnlPct` for "current P&L"
  // framing) must see the SAME reconciled number `positionSection`'s own `pnlForDisplay` already
  // shows — reconciled here, once, at the single point every live brief passes through, rather
  // than left for each section to (not) redo. See `reconcileLivePnlPctWithDisplayMark`'s own doc
  // comment (play-brief-resolve-pure.ts) for the full live repro and why this is the safe choke
  // point (every existing section-level unit test builds its own fixture and calls
  // `composeSwingPlayBrief` directly, bypassing this loader entirely, so none of them are
  // affected by this change).
  const play = {
    ...resolved.play,
    pnlPct: reconcileLivePnlPctWithDisplayMark({
      entry: resolved.play.entry,
      mark: resolved.play.mark,
      pnlPct: resolved.play.pnlPct,
    }),
  };

  const ticker = play.ticker.toUpperCase();

  // PERFORMANCE FIX (standing latency mandate, 2026-09-22): `meridian` and `meridianPeer` used to
  // be `await`ed one after another BEFORE the `Promise.all` below ever started — meridianPeer
  // genuinely depends on meridian's own result (it reads `meridian.items` to find an earnings
  // catalyst to fetch peers for), but nothing about the OTHER six sources depends on either of
  // them. Sequencing them ahead of the fan-out serialized up to 3 full `withBriefSourceTimeout`
  // budgets (meridian 8s + meridianPeer 8s + the Promise.all's own up-to-8s) into a ~24s worst
  // case, on the exact request this file's own header comment already documents as having hung
  // past a 120s client timeout under real upstream stalls (2026-09-09). Chaining meridianPeer off
  // meridian with `.then()` and folding both into the SAME `Promise.all` as the other six reads
  // keeps the real dependency (meridianPeer still only starts once meridian resolves) while
  // letting every independent source race concurrently — worst case drops to ~16s (the
  // meridian→meridianPeer chain, still the tallest single path) instead of ~24s.
  const meridianPromise = withBriefSourceTimeout(fetchMeridianForTicker(ticker)).catch(() => null);
  const meridianPeerPromise = meridianPromise.then((meridian) =>
    withBriefSourceTimeout(fetchMeridianPeerForBrief(meridian, ticker)).catch(() => null),
  );

  // Distinguish a genuine "no data" null from a thrown fetch — FINDINGS 2026-09-06 (#11): an
  // ecosystem/vector fetch that THROWS must not read the same as one that legitimately returned
  // nothing, or a total upstream failure can still leave confidence.level at "high". A timeout
  // rejection is just another throw here, so it flows through the same failed-flag path.
  let ecosystemFetchFailed = false;
  let vectorFetchFailed = false;
  const positionId = positionIdFromPlayId(play.id);
  const [
    meridian,
    meridianPeer,
    ecosystem,
    vector,
    openBook,
    archetypeTrackRecord,
    rollHistory,
    tickerTrackRecord,
  ] = await Promise.all([
    meridianPromise,
    meridianPeerPromise,
    withBriefSourceTimeout(fetchEcosystemContext(ticker)).catch((err) => {
      // BUG FIX (2026-09-28, Ask Largo standing mandate, live repro AMZN play-brief): this catch
      // swallowed the actual error with no log line at all — the member-facing envelope correctly
      // surfaces "ecosystem context ... fetch failed" via unavailableSources, but nobody could ever
      // tell WHY from CloudWatch (timeout vs a real provider error vs which upstream). Identical bug
      // shape to swing-discovery.ts's Tier-0 origin fetch, already fixed there (its own comment:
      // "invisible in CloudWatch... distinguishable... only by reading a field nobody was tailing").
      console.warn(`[swing-play-brief] ecosystem context fetch failed for ${ticker}:`, err);
      ecosystemFetchFailed = true;
      return null;
    }),
    withBriefSourceTimeout(fetchVectorFullState(ticker, normalizeDteHorizon("all"))).catch((err) => {
      console.warn(`[swing-play-brief] Vector full-state fetch failed for ${ticker}:`, err);
      vectorFetchFailed = true;
      return null;
    }),
    loadOpenBook(),
    // Ask Largo C10 (historical context) — a plain, best-effort shared-cache read the cron writes
    // (calibration-cache.ts). Bounded so a wedged Redis hop degrades to "no citation" rather than
    // blocking the whole brief; unlike ecosystem/vector above this has no dedicated *FetchFailed
    // flag because a miss here is never surfaced as an absence/error to the member — an ungraduated
    // or unavailable track record simply omits the "Track record" section (Largo C6: omission, not
    // fabrication), the same as a play with no track record to cite at all. `withBriefSourceTimeout`
    // now REJECTS on timeout (see the import-site comment above), so this read keeps its own
    // `.catch(() => null)` to preserve that "never surfaces as a failure" contract.
    withBriefSourceTimeout(readSwingArchetypeTrackRecord()).catch(() => null),
    // Best-effort like the read above — a DB hiccup degrades to "no roll history cited" rather
    // than failing the whole brief; loadRollHistory already wraps its own try/catch.
    withBriefSourceTimeout(loadRollHistory(positionId, ticker)).catch(() => null),
    // Ask Largo C10 (historical context, TICKER-scoped) — see play-brief-ticker-history.ts's
    // header for why this is a plain, best-effort live read rather than a cron-distilled cache
    // like archetypeTrackRecord above. Self-excludes the reviewed play's own chain (resolved via
    // resolveRootPositionId, a second small best-effort DB read) so a CLOSED/OPEN position never
    // cites itself as "prior" evidence. Also passes the reviewed play's own resolution instant
    // (`exitAt`, null for a still-open play) so a chain that resolved AT OR AFTER this play can
    // never be cited as "traded before this play" — see play-brief-ticker-history.ts's TEMPORAL
    // ORDERING note for the live future-leak this closes.
    withBriefSourceTimeout(
      resolveRootPositionId(positionId, ticker).then((rootId) =>
        loadTickerTrackRecord(
          play.ticker,
          rootId,
          play.exitAt ? (Date.parse(play.exitAt) || null) : null,
        ),
      ),
    ).catch(() => null),
  ]);

  const nowMs = Date.now();
  // Largo C1: brief read time on the market clock — same convention as Vector/BIE tools.
  const asOf = etStamp(nowMs) ?? new Date(nowMs).toISOString();
  return {
    play,
    asOf,
    sessionDate: etSessionDate(nowMs),
    scanAsOf: resolved.scanAsOf,
    scanSessionDay: resolved.scanSessionDay,
    ecosystem,
    vector,
    laneRows: resolved.laneRows,
    meridian,
    meridianPeer,
    openBook,
    ecosystemFetchFailed,
    vectorFetchFailed,
    archetypeTrackRecord,
    rollHistory,
    tickerTrackRecord,
  };
}
