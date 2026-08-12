// src/lib/swing/serving-lane.ts — the `getSwingServingLane` service (PR-12). The thin IO seam.
//
// WHY (docs/audit/SWING-ENGINE.md §4 PR-12): the horizons route needs ONE call that hands back the fully
// assembled SWING serving lane so `?view=swings` serves the real sectioned board. This service is that call.
// It composes the two pure halves — `swingServingMetaFromDossier` (serving-ingest: the per-ticker reads) and
// `assembleSwingServingLane` (serving-board: the seven-section lane) — around an INJECTED discovery source.
//
// INJECTED DISCOVERY (why a seam, not a hard-wired scan): the whole-market swing discovery (PR-11) runs
// against the DB flow window + live chains + the accumulation store — none of which is reachable to unit
// tests (or the sandbox: Postgres/WS are blocked). So `discover` is injected: the route wires the real
// runner (PR-13, once the IO harness + per-push validation are in place); tests inject a fixture. When no
// discover is supplied — or it returns null / throws — the service degrades to an EMPTY but fully-structured
// lane (all seven sections present, provisional floor, null calibrated surfaces). MEMBER-SAFE: a discovery
// hiccup must NEVER surface as a thrown route error or a fabricated play — it surfaces as an honest empty lane.
//
// EVIDENCE-ONLY: nothing here commits or sizes risk; it shapes the WATCH/RESEARCH rail the desk renders.

import type { SwingDossier } from "./dossier";
import type { HorizonPlay } from "../horizon-plays";
import type { SwingWatchCandidate } from "./accumulation-store";
import { swingThesisKey, persistenceGapReason } from "./accumulation-store";
import { sharedCacheGet, sharedCacheSet } from "../shared-cache";
import {
  assembleSwingServingLane,
  emptySwingServingLane,
  type SwingServingLane,
} from "./serving-board";
import {
  buildSwingReadsByTicker,
  swingServingMetaFromDossier,
  type SwingServingReads,
} from "./serving-ingest";
import type { ChainContract } from "../horizon-fanout";
import { livePlaysFromOpenPositions } from "./live-plays";
import type { SwingPositionRow } from "../db";

/** What an injected discovery run must hand back: the scored dossiers + the SWING plays produced from them.
 *  (Matches the relevant slice of PR-11's `SwingDiscoveryResult` — `dossiers` + `playSet.SWING`.)
 *  Optional `readsByTicker` lets the persisted discover source ground setup maturity without a second
 *  provider fan-out on the member request path. */
export interface SwingDiscoveryLike {
  dossiers: SwingDossier[];
  plays: HorizonPlay[];
  readsByTicker?: Map<string, SwingServingReads>;
}

export interface SwingServingLaneDeps {
  /** Injected discovery source. Absent / null / throwing ⇒ an honest empty lane (see header). */
  discover?: () => Promise<SwingDiscoveryLike | null>;
  /** Optional grounded price-vs-level reads per ticker (uppercased) — ground the setup/entry observables so
   *  a name can route beyond RESEARCH. Absent for a name ⇒ it degrades honestly (no fabricated maturity). */
  readsByTicker?: Map<string, SwingServingReads>;
  /** Injected open-book loader for live sections (MANAGING/SCALING_OUT/EXITING). Absent ⇒ live sections stay
   *  empty (pre-entry only). Cache-reader: the route should pass a DB/Redis reader, never a provider fan-out. */
  fetchOpenPositions?: () => Promise<SwingPositionRow[]>;
  /** Optional spots for structural-break detection on live plays (uppercased). Prefer serving-snapshot spots. */
  spotsByTicker?: Record<string, number>;
  /** Latest manage snapshot event_json per position id — authoritative EXITING/MANAGING state (#38). */
  fetchLatestManageEvents?: (positionIds: number[]) => Promise<Map<number, Record<string, unknown>>>;
}

/** Index the scored dossiers by ticker (uppercased) so each play can find the thesis it was produced from. */
function dossiersByTicker(dossiers: SwingDossier[]): Map<string, SwingDossier> {
  const idx = new Map<string, SwingDossier>();
  for (const d of dossiers) idx.set(d.ticker.toUpperCase(), d);
  return idx;
}

/**
 * Stamp a produced play with the OBSERVABLE swing state its dossier + grounded reads imply, so the serving
 * router (buildSwingSections) can place it in the right section. Only the observable fields the router keys
 * on (setupState / entryStatus) and the calibration-partition labels (archetype / subLane) are set — the
 * factors/regime/thesis reads ride the meta the command-deck adapter consumes, not the pure play.
 */
function enrichPlay(play: HorizonPlay, dossier: SwingDossier | undefined, reads?: SwingServingReads): HorizonPlay {
  if (!dossier) return play; // no thesis found for this ticker → leave it as-is (routes to RESEARCH honestly)
  const meta = swingServingMetaFromDossier(dossier, reads);
  // WATCH track anchor: pinned first-flag price only — never the live scan spot (reads.setup.price).
  const flagPx =
    play.flagUnderlyingPx ??
    dossier.plan?.entryUnderlyingPx ??
    null;
  return {
    ...play,
    setupState: meta.setupState ?? play.setupState,
    entryStatus: meta.entryStatus ?? play.entryStatus,
    archetype: meta.archetype ?? play.archetype,
    subLane: meta.subLane ?? play.subLane,
    factors: meta.factors,
    regime: meta.regime,
    thesisLevel: meta.thesisLevel,
    thesisNote: meta.thesisNote,
    flagUnderlyingPx:
      typeof flagPx === "number" && Number.isFinite(flagPx) && flagPx > 0 ? flagPx : play.flagUnderlyingPx,
  };
}

/**
 * Attach the thesis EXPLANATION (factors + regime) to a LIVE, committed row — and nothing else.
 *
 * THE BUG. `enrichPlay` runs over discovery plays only. A live row is built by
 * `livePlaysFromOpenPositions` from the ledger, and then deliberately EVICTS its pre-entry twin
 * ("live capital wins the section") — which is precisely the row that was carrying the factors. So
 * the moment a swing play is committed it loses its explanation, and the card falls back to
 * "Component breakdown not served for this lane yet". Measured live on prod 2026-08-12: 15 of 21
 * swing rows carried factors, and the 6 without were exactly the committed ones (RVMD/KRE/FHN in
 * MANAGING, IBIT/KKR/MSFT in SCALING OUT) — i.e. the desk explains the plays you are only watching
 * and goes quiet on the ones holding your money.
 *
 * WHY NOT JUST CALL `enrichPlay`. Because it also sets `setupState` / `entryStatus` / `subLane` /
 * `archetype`, and on a live row those are computed from REAL capital state (open, trimming,
 * exiting). `enrichPlay` lets the dossier's PRE-ENTRY read win (`meta.setupState ?? play.setupState`),
 * which would move a managed position back into a pre-entry section — a far worse bug than the one
 * being fixed. Lifecycle stays live; only the explanation is borrowed.
 *
 * `thesisLevel`/`thesisNote` are deliberately NOT copied either: a live row derives its thesis health
 * from ongoing management, and a pre-entry read would overwrite a real "thesis broken" with a stale
 * "intact".
 *
 * FAIL-CLOSED: no dossier for the ticker (the name is no longer in today's discovery) leaves the row
 * untouched and the honest placeholder stands — a committed play never gets an invented explanation.
 */
function attachThesisExplanation(
  play: HorizonPlay,
  dossier: SwingDossier | undefined,
  reads?: SwingServingReads,
): HorizonPlay {
  if (!dossier) return play;
  const meta = swingServingMetaFromDossier(dossier, reads);
  const hasFactors = Array.isArray(meta.factors) && meta.factors.length > 0;
  if (!hasFactors && meta.regime == null) return play;
  return {
    ...play,
    factors: hasFactors ? meta.factors : play.factors,
    regime: meta.regime ?? play.regime,
  };
}

/**
 * Assemble the SWING serving lane for the route. Runs the injected discovery, enriches each produced play
 * with its observable serving state, and hands the enriched plays to the sectioned-lane assembler. Any
 * failure (no discover, null result, thrown error) degrades to an empty structured lane — never a throw.
 */
export async function getSwingServingLane(deps: SwingServingLaneDeps = {}): Promise<SwingServingLane> {
  if (!deps.discover && !deps.fetchOpenPositions) return emptySwingServingLane();
  try {
    const result = deps.discover ? await deps.discover() : null;
    const discoveryPlays = result && Array.isArray(result.plays) ? result.plays : [];
    const dossiers = result?.dossiers ?? [];
    const idx = dossiersByTicker(dossiers);
    // Prefer an explicit inject; else use reads the discover source already built (persisted spots).
    const reads = deps.readsByTicker ?? result?.readsByTicker;
    const enrichedDiscovery = discoveryPlays.map((p) =>
      enrichPlay(p, idx.get(p.ticker.toUpperCase()), reads?.get(p.ticker.toUpperCase())),
    );

    // Live sections: merge OPEN ledger rows (injected) so MANAGING/SCALING_OUT/EXITING populate.
    let livePlays: HorizonPlay[] = [];
    if (deps.fetchOpenPositions) {
      const openRows = await deps.fetchOpenPositions().catch(() => []);
      const spots: Record<string, number> = { ...(deps.spotsByTicker ?? {}) };
      // Prefer discover reads' setup prices as spot fallback for structural-break detection.
      for (const [ticker, r] of reads ?? []) {
        if (spots[ticker] == null && r.setup?.price != null) spots[ticker] = r.setup.price;
      }
      const manageEvents = deps.fetchLatestManageEvents
        ? await deps.fetchLatestManageEvents(openRows.map((r) => r.id)).catch(() => new Map())
        : new Map<number, Record<string, unknown>>();
      // Explanation-only enrichment: a committed row keeps its LIVE lifecycle state but regains the
      // dossier's factors/regime, which the pre-entry twin it evicts was the only carrier of.
      livePlays = livePlaysFromOpenPositions(openRows, spots, manageEvents).map((p) =>
        attachThesisExplanation(p, idx.get(p.ticker.toUpperCase()), reads?.get(p.ticker.toUpperCase())),
      );
      // Live capital wins the section — drop the pre-entry twin for the same thesis (name+side+archetype).
      const liveKeys = new Set(
        livePlays.map((p) => swingThesisKey(p.ticker, p.direction, p.archetype ?? null)),
      );
      const preEntryOnly = enrichedDiscovery.filter(
        (p) => !liveKeys.has(swingThesisKey(p.ticker, p.direction, p.archetype ?? null)),
      );
      const merged = [...livePlays, ...preEntryOnly];
      if (merged.length === 0) return emptySwingServingLane();
      return assembleSwingServingLane(merged);
    }

    if (enrichedDiscovery.length === 0) return emptySwingServingLane();
    return assembleSwingServingLane(enrichedDiscovery);
  } catch {
    // MEMBER-SAFE: a discovery/DB hiccup must not throw the route or fabricate plays — serve an empty lane.
    return emptySwingServingLane();
  }
}

// ─── Persisted discovery snapshot (the write→read seam between the cron and the member route) ────────────
//
// WHY (the dead-end this closes): the whole-market swing discovery runs in a CRON, but the member horizons
// route runs per-request and cannot reach the DB flow window / live chains / accumulation store the scan
// needs. So the scan writes its scored output HERE (a small shared-cache blob), and the member route reads
// it back through `discoverSwingFromPersisted` — a pure cache read, no provider IO on the request path.
// Before this, the route called getSwingServingLane() with NO discover, so the SWING board was structurally
// always empty; and the cron persisted only the accumulation memory, never the scored dossiers/plays.
//
// PERSISTENCE-GATED (the swing engine's core discipline): `discoverSwingFromPersisted` surfaces ONLY plays
// whose thesis (ticker, direction, archetype) has cleared the cross-session persistence bar — i.e. appears
// in the persisted `watch` list. A first-sighting name that produced a play never reaches the member board
// on a single sighting, exactly as the accumulation gate requires. Empty watch / empty plays ⇒ an honest
// empty lane.

/** The scored output one discovery scan hands to the serving route, persisted between the two runtimes. */
export interface SwingServingSnapshot {
  /** ISO timestamp the scan was taken (for freshness/debug). */
  asOf: string;
  /** ET session day the scan is anchored to. */
  sessionDay: string;
  /** The scored dossiers (enrich each play's serving meta). */
  dossiers: SwingDossier[];
  /** The produced SWING plays (concrete WATCH contracts) — empty until discovery attaches chains. */
  plays: HorizonPlay[];
  /** The persistence-cleared WATCH candidates — the gate for which plays may surface to members. */
  watch: SwingWatchCandidate[];
  /** Accumulating theses seen this scan but below the persistence bar — RESEARCH rail. */
  observed?: SwingWatchCandidate[];
  /**
   * Grounded underlying spots (uppercased ticker → price) at scan time — last trade when available,
   * else the dossier plan's entry price (last close). Member route builds setup/entry reads from these
   * WITHOUT a per-request provider fan-out (cache-reader rule).
   */
  spotsByTicker?: Record<string, number>;
  /** First-flag underlying anchor per thesis key — WATCH track must not drift with scan spot. */
  flagAnchorsByThesisKey?: Record<string, number>;
}

/** Shared-cache key + TTL. TTL outlives a full session day so the latest scan serves until the next scan
 *  refreshes it (discovery fires per phase per day; a stale-but-present blob still degrades to gated plays). */
export const SWING_SERVING_CACHE_KEY = "swing:serving:latest:v1";
export const SWING_SERVING_TTL_SEC = 26 * 60 * 60;

/** Persist one scan's scored output for the member route to read. Returns true on success so the cron can
 *  refuse to upgrade the phase claim to DONE when the member-facing snapshot never landed. */
export async function persistSwingServingSnapshot(snapshot: SwingServingSnapshot): Promise<boolean> {
  try {
    await sharedCacheSet(SWING_SERVING_CACHE_KEY, snapshot, SWING_SERVING_TTL_SEC);
    return true;
  } catch {
    // non-fatal for the scan itself — the read side degrades to an empty lane — but the cron MUST know.
    return false;
  }
}

/** Read the latest persisted scan (null when absent / cache unavailable). Pure cache read — no provider IO. */
export async function readSwingServingSnapshot(): Promise<SwingServingSnapshot | null> {
  try {
    return await sharedCacheGet<SwingServingSnapshot>(SWING_SERVING_CACHE_KEY);
  } catch {
    return null;
  }
}

/**
 * The `discover` source the horizons route injects: read the latest persisted scan and hand back the
 * serving-lane deps shape ({ dossiers, plays }), GATED so only persistence-cleared names surface. Returns
 * null (⇒ empty lane) when nothing is persisted. Never throws — member-safe by construction.
 */
export async function discoverSwingFromPersisted(): Promise<SwingDiscoveryLike | null> {
  const snap = await readSwingServingSnapshot();
  if (!snap) return null;
  const dossiers = snap.dossiers ?? [];
  // Thesis key on watch rows (always carry archetype). Plays from produceHorizonPlays may omit archetype —
  // fall back to the matching dossier's classified archetype so the gate stays thesis-keyed without
  // falsely dropping a persistence-cleared name.
  const dossierArchByTd = new Map<string, string>();
  for (const d of dossiers) {
    if (!d.direction || !d.archetype?.archetype) continue;
    dossierArchByTd.set(`${d.ticker.toUpperCase()}|${d.direction}`, d.archetype.archetype);
  }
  const cleared = new Set(
    (snap.watch ?? []).map((c) => swingThesisKey(c.ticker, c.direction, c.archetype)),
  );
  const observedByKey = new Map(
    (snap.observed ?? []).map((c) => [swingThesisKey(c.ticker, c.direction, c.archetype), c]),
  );
  const playThesisKey = (p: HorizonPlay): string => {
    const arch =
      p.archetype ??
      dossierArchByTd.get(`${p.ticker.toUpperCase()}|${p.direction}`) ??
      null;
    return swingThesisKey(p.ticker, p.direction, arch);
  };
  const clearedPlays = (snap.plays ?? []).filter((p) => cleared.has(playThesisKey(p))).map((p) => {
    const key = playThesisKey(p);
    const cand = (snap.watch ?? []).find((c) => swingThesisKey(c.ticker, c.direction, c.archetype) === key);
    const flagPx = snap.flagAnchorsByThesisKey?.[key] ?? p.flagUnderlyingPx ?? null;
    return {
      ...p,
      firstSeenAt: cand?.firstSeenAt ?? p.firstSeenAt,
      signalKinds: cand?.signalKinds ?? p.signalKinds,
      flagUnderlyingPx: flagPx,
    };
  });
  const observedPlays = (snap.plays ?? [])
    .filter((p) => {
      const key = playThesisKey(p);
      return observedByKey.has(key) && !cleared.has(key);
    })
    .map((p) => {
      const key = playThesisKey(p);
      const obs = observedByKey.get(key);
      const gap = obs ? persistenceGapReason(obs) : null;
      const flagPx = snap.flagAnchorsByThesisKey?.[key] ?? p.flagUnderlyingPx ?? null;
      return {
        ...p,
        firstSeenAt: obs?.firstSeenAt ?? p.firstSeenAt,
        signalKinds: obs?.signalKinds ?? p.signalKinds,
        flagUnderlyingPx: flagPx,
        persistenceObserved: true as const,
        persistenceGapReason: gap ?? "Building cross-session persistence.",
        reason: gap ? `${p.reason} · ${gap}` : p.reason,
      };
    });
  const plays = [...clearedPlays, ...observedPlays];
  // Contracts from plays (best first) so entry-state can stamp when a WATCH contract is attached.
  const contractsByTicker = new Map<string, ChainContract>();
  for (const p of plays) {
    const key = p.ticker.toUpperCase();
    if (!contractsByTicker.has(key) && p.contract) contractsByTicker.set(key, p.contract);
  }
  // Prefer cron-warmed live spots; fall back to each dossier's plan entry (last close at scan) so a
  // legacy snapshot without spotsByTicker still grounds setup maturity when plan levels exist.
  const spots: Record<string, number> = { ...(snap.spotsByTicker ?? {}) };
  for (const d of dossiers) {
    const key = d.ticker.toUpperCase();
    if (spots[key] != null) continue;
    const px = d.plan?.entryUnderlyingPx;
    if (px != null && Number.isFinite(px) && px > 0) spots[key] = px;
  }
  const readsByTicker = buildSwingReadsByTicker(dossiers, spots, {
    contractsByTicker,
    asOf: snap.asOf,
  });
  return { dossiers, plays, readsByTicker };
}
