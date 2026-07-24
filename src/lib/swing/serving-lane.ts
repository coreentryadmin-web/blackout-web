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
