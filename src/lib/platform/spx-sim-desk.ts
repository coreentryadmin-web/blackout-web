// ── ADMIN-ONLY SPX Slayer desk simulation store (fix/spx-desk-sim) ────────────────────
//
// A faithful mirror of the Night Hawk 0DTE sim (see zerodte-sim-board.ts). It lets an ADMIN
// watch a synthetic SPX session play through the REAL desk UI at /dashboard?sim=1 while
// MEMBERS keep seeing the untouched live desk.
//
// SAFETY CONTRACT — members must NEVER see sim data. Three independent layers guard this,
// and ALL THREE must hold before a byte of sim data reaches a browser:
//   1. AUTH GATE   — the ingest endpoint is admin-only (requireAdminApi); every SPX read
//                    route only consults the sim key when the requester is a signed-in ADMIN.
//   2. SEPARATE KEY — sim frames live in `spx:desk:snapshot:sim:v1`, a DIFFERENT Redis key
//                    from every live SPX cache lane (`spx-desk:<date>`, `spx-desk-pulse:*`,
//                    `spx-desk-flow:*`, `spx-pin:*`, `spx-bootstrap:*`, `gex-overlay:*`,
//                    the matrix cache, …). This module NEVER reads or writes any of those,
//                    so a bug here physically cannot corrupt what members see.
//   3. OPT-IN PARAM — a read serves sim ONLY when `?sim=1` is present. Absent the param, the
//                    live member path runs unchanged for EVERYONE, admin included.
// The live SPX lanes (spx-desk.ts / spx-desk-loader.ts / spx-service.ts / gex-heatmap route)
// are deliberately left byte-for-byte untouched — this module is purely additive and imports
// only the shared cache + the payload TYPES, never any live reader/writer.
//
// Sim writes carry a SHORT TTL (default 30 min) so an abandoned sim self-expires and can
// never linger as stale data.
import type { SpxDeskPayload, SpxDeskFlow, SpxDeskPulse } from "@/features/spx/lib/spx-desk";
// Type-only imports — erased at compile, so the server-only spx-pin / options-gex chain deps
// never get pulled into this module's runtime (matches how the client hooks import these).
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-payload";
import type { SpxPinForecast } from "@/features/spx/lib/spx-pin";
import type { GexHeatmap } from "@/lib/providers/polygon-options-gex";
import { sharedCacheDel, sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";

/** ISOLATED sim snapshot key — DISTINCT from every live SPX cache lane. Prefixed to
 *  `blackout:spx:desk:snapshot:sim:v1` by sharedCacheSet. The `:sim:` segment is the
 *  physical isolation boundary; no live lane shares this key. */
export const SPX_SIM_SNAPSHOT_KEY = "spx:desk:snapshot:sim:v1";

/** Short TTL so an abandoned sim self-expires instead of lingering as stale data. */
export const SPX_SIM_TTL_SEC = Math.max(60, Number(process.env.SPX_SIM_TTL_SEC ?? 30 * 60));

/**
 * The bootstrap lane payload — desk + flow + pulse + merged (+ optional SPX matrix). Mirrors
 * SpxBootstrapPayload from the bootstrap route, kept structural here so this module doesn't
 * import from a route file.
 */
export type SpxSimBootstrap = {
  desk: SpxDeskPayload;
  flow: SpxDeskFlow | null;
  pulse: SpxDeskPulse | null;
  merged: SpxDeskPayload;
  gexHeatmap: GexHeatmap | null;
};

/**
 * ONE frame of the sim: the payloads for each desk lane an admin `?sim=1` read can request.
 * Every field is OPTIONAL — the feeder may post a partial frame, and a route serving a lane
 * that a frame didn't include falls back to a minimal `{ available: false }` empty (graceful
 * "scanning / unavailable" state, exactly like the live routes' own error contract).
 */
export type SpxSimDeskBundle = {
  bootstrap?: SpxSimBootstrap;
  desk?: SpxDeskPayload;
  pulse?: SpxDeskPulse;
  flow?: SpxDeskFlow;
  play?: SpxPlayPayload;
  pin?: SpxPinForecast;
  gexHeatmap?: GexHeatmap;
};

/**
 * THE gate — the single decision that keeps members away from sim data. Pure so it is
 * unit-tested exhaustively (see spx-sim-desk.test.ts). Sim data is served ONLY when BOTH
 * conditions hold; every other combination falls through to the untouched member path. There
 * is deliberately no third state — non-admin + sim=1 is indistinguishable from a plain member
 * request.
 */
export function shouldServeSpxSim(isAdmin: boolean, simRequested: boolean): boolean {
  return isAdmin === true && simRequested === true;
}

/** Parse the `sim` query param into the opt-in boolean the gate consumes. Only the explicit
 *  `?sim=1` opts in — any other value (absent, `0`, `true`, garbage) is a member request. */
export function isSpxSimRequested(simParam: string | null | undefined): boolean {
  return simParam === "1";
}

/**
 * Structural validation of a posted sim frame. The ingest endpoint rejects anything that
 * fails this, so a malformed frame can never be written to the sim key (and thus never
 * rendered). Intentionally loose (not field-by-field): the frame is an object, and each
 * present lane is itself an object — enough to guarantee the shape the read routes JSON-serve.
 */
export function isSpxSimDeskBundle(value: unknown): value is SpxSimDeskBundle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  for (const lane of ["bootstrap", "desk", "pulse", "flow", "play", "pin", "gexHeatmap"] as const) {
    if (v[lane] === undefined) continue;
    if (!v[lane] || typeof v[lane] !== "object" || Array.isArray(v[lane])) return false;
  }
  return true;
}

/** An EMPTY sim bundle — served for an admin `?sim=1` read before any frame has been seeded
 *  (or after a reset). Every lane absent → each route serves its own `{ available: false }`
 *  empty, so the desk renders a quiet "scanning" state rather than a degraded/error state. */
export function emptySpxSimSnapshot(): SpxSimDeskBundle {
  return {};
}

/** Read the sim snapshot (fail-soft: any store/shape error → null so the caller serves the
 *  empty bundle, never a broken desk). NEVER touches any live SPX lane. */
export async function readSpxSimSnapshot(): Promise<SpxSimDeskBundle | null> {
  try {
    const snap = await sharedCacheGet<SpxSimDeskBundle>(SPX_SIM_SNAPSHOT_KEY);
    if (!snap || !isSpxSimDeskBundle(snap)) return null;
    return snap;
  } catch {
    return null;
  }
}

/** Serve the sim bundle for an admin `?sim=1` read: the seeded frame, or an empty bundle when
 *  no frame has been posted yet. */
export async function getSpxSimSnapshot(): Promise<SpxSimDeskBundle> {
  return (await readSpxSimSnapshot()) ?? emptySpxSimSnapshot();
}

/** Write ONE validated frame to the sim key with the short sim TTL. Returns the exact key +
 *  ttl written so the ingest endpoint can echo it back to the feeder. */
export async function writeSpxSimSnapshot(
  bundle: SpxSimDeskBundle
): Promise<{ key: string; ttlSec: number }> {
  await sharedCacheSet(SPX_SIM_SNAPSHOT_KEY, bundle, SPX_SIM_TTL_SEC);
  return { key: SPX_SIM_SNAPSHOT_KEY, ttlSec: SPX_SIM_TTL_SEC };
}

/** Clear the sim key (reset). NEVER touches any live SPX lane. */
export async function clearSpxSimSnapshot(): Promise<{ key: string }> {
  await sharedCacheDel(SPX_SIM_SNAPSHOT_KEY);
  return { key: SPX_SIM_SNAPSHOT_KEY };
}
