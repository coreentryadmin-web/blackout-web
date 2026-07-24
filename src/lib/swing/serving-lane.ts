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
import { sharedCacheGet, sharedCacheSet } from "../shared-cache";
import {
  assembleSwingServingLane,
  emptySwingServingLane,
  type SwingServingLane,
} from "./serving-board";
import { swingServingMetaFromDossier, type SwingServingReads } from "./serving-ingest";

/** What an injected discovery run must hand back: the scored dossiers + the SWING plays produced from them.
 *  (Matches the relevant slice of PR-11's `SwingDiscoveryResult` — `dossiers` + `playSet.SWING`.) */
export interface SwingDiscoveryLike {
  dossiers: SwingDossier[];
  plays: HorizonPlay[];
}

export interface SwingServingLaneDeps {
  /** Injected discovery source. Absent / null / throwing ⇒ an honest empty lane (see header). */
  discover?: () => Promise<SwingDiscoveryLike | null>;
  /** Optional grounded price-vs-level reads per ticker (uppercased) — ground the setup/entry observables so
   *  a name can route beyond RESEARCH. Absent for a name ⇒ it degrades honestly (no fabricated maturity). */
  readsByTicker?: Map<string, SwingServingReads>;
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
  return {
    ...play,
    setupState: meta.setupState ?? play.setupState,
    entryStatus: meta.entryStatus ?? play.entryStatus,
    archetype: meta.archetype ?? play.archetype,
    subLane: meta.subLane ?? play.subLane,
  };
}

/**
 * Assemble the SWING serving lane for the route. Runs the injected discovery, enriches each produced play
 * with its observable serving state, and hands the enriched plays to the sectioned-lane assembler. Any
 * failure (no discover, null result, thrown error) degrades to an empty structured lane — never a throw.
 */
export async function getSwingServingLane(deps: SwingServingLaneDeps = {}): Promise<SwingServingLane> {
  if (!deps.discover) return emptySwingServingLane();
  try {
    const result = await deps.discover();
    if (!result || !Array.isArray(result.plays) || result.plays.length === 0) {
      return emptySwingServingLane();
    }
    const idx = dossiersByTicker(result.dossiers ?? []);
    const enriched = result.plays.map((p) =>
      enrichPlay(p, idx.get(p.ticker.toUpperCase()), deps.readsByTicker?.get(p.ticker.toUpperCase())),
    );
    return assembleSwingServingLane(enriched);
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
// whose (ticker, direction) has cleared the cross-session persistence bar — i.e. appears in the persisted
// `watch` list. A first-sighting name that produced a play never reaches the member board on a single
// sighting, exactly as the accumulation gate requires. Empty watch / empty plays ⇒ an honest empty lane.

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
}

/** Shared-cache key + TTL. TTL outlives a full session day so the latest scan serves until the next scan
 *  refreshes it (discovery fires per phase per day; a stale-but-present blob still degrades to gated plays). */
export const SWING_SERVING_CACHE_KEY = "swing:serving:latest:v1";
export const SWING_SERVING_TTL_SEC = 26 * 60 * 60;

/** Persist one scan's scored output for the member route to read. Best-effort: a cache write miss just
 *  leaves the serving lane on its member-safe empty fallback — it NEVER fails the discovery cron. */
export async function persistSwingServingSnapshot(snapshot: SwingServingSnapshot): Promise<void> {
  try {
    await sharedCacheSet(SWING_SERVING_CACHE_KEY, snapshot, SWING_SERVING_TTL_SEC);
  } catch {
    // non-fatal — the read side degrades to an empty lane when there's nothing (or nothing fresh) to read.
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
  const cleared = new Set((snap.watch ?? []).map((c) => `${c.ticker.toUpperCase()}|${c.direction}`));
  const plays = (snap.plays ?? []).filter((p) => cleared.has(`${p.ticker.toUpperCase()}|${p.direction}`));
  return { dossiers: snap.dossiers ?? [], plays };
}
