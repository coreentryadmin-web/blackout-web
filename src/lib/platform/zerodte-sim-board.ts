// ── ADMIN-ONLY 0DTE Night Hawk simulation board (feat/zerodte-admin-sim-view) ──────
//
// SAFETY CONTRACT — members must NEVER see sim data. Three independent layers guard
// this, and ALL THREE must hold before a byte of sim data reaches a browser:
//   1. AUTH GATE   — the ingest endpoint is admin-only (requireAdminApi); the board
//                    GET route only consults the sim key when the requester is admin.
//   2. SEPARATE KEY — sim frames live in `zerodte:board:snapshot:sim:v1`, a DIFFERENT
//                    Redis key from the member snapshot (`zerodte:board:snapshot:v1`).
//                    This module NEVER reads or writes the member key, so a bug here
//                    physically cannot corrupt what members see.
//   3. OPT-IN PARAM — the board GET route serves sim ONLY when `?sim=1` is present.
//                    Absent the param, the member path runs unchanged for EVERYONE,
//                    admin included.
// The member snapshot lane (zerodte-service.ts) is deliberately left byte-for-byte
// untouched — this module is purely additive and imports only the shared cache + the
// board payload TYPE, never the member read/write functions.
//
// Sim writes carry a SHORT TTL (default 30 min) so an abandoned sim self-expires and
// can never linger as stale data.
import type { ZeroDteBoardPayload } from "@/lib/platform/zerodte-service";
import { sharedCacheDel, sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { sessionHeat } from "@/lib/zerodte/board";
import { etNowParts, isTradingDayEt, todayEt } from "@/features/nighthawk/lib/session";

/** ISOLATED sim snapshot key — DISTINCT from the member key `zerodte:board:snapshot:v1`.
 *  Prefixed to `blackout:zerodte:board:snapshot:sim:v1` by sharedCacheSet, exactly as the
 *  member key is. The `:sim:` segment is the physical isolation boundary. */
export const SIM_BOARD_SNAPSHOT_KEY = "zerodte:board:snapshot:sim:v1";

/** Short TTL so an abandoned sim self-expires instead of lingering as stale data. */
export const SIM_BOARD_TTL_SEC = Math.max(
  60,
  Number(process.env.ZERODTE_SIM_BOARD_TTL_SEC ?? 30 * 60)
);

/**
 * THE gate — the single decision that keeps members away from sim data. Pure so it is
 * unit-tested exhaustively (see zerodte-sim-board.test.ts). Sim data is served ONLY when
 * BOTH conditions hold; every other combination falls through to the untouched member
 * path. There is deliberately no third state — non-admin + sim=1 is indistinguishable
 * from a plain member request.
 */
export function shouldServeSimBoard(isAdmin: boolean, simRequested: boolean): boolean {
  return isAdmin === true && simRequested === true;
}

/** Parse the `sim` query param into the opt-in boolean the gate consumes. Only the
 *  explicit `?sim=1` opts in — any other value (absent, `0`, `true`, garbage) is member. */
export function isSimRequested(simParam: string | null | undefined): boolean {
  return simParam === "1";
}

/**
 * Structural validation of a posted board frame against the real ZeroDteBoardPayload
 * contract. The ingest endpoint rejects anything that fails this, so a malformed frame
 * can never be written to the sim key (and thus never rendered). Intentionally
 * structural (not exhaustive field-by-field) — it verifies the load-bearing shape the
 * board reader and the deck adapters depend on, matching how the member reader
 * (readSharedBoardSnapshot) itself validates: available===true, a parseable as_of, and
 * array-typed setups/ledger.
 */
export function isZeroDteBoardPayload(value: unknown): value is ZeroDteBoardPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.available !== true) return false;
  if (typeof v.as_of !== "string" || !Number.isFinite(Date.parse(v.as_of))) return false;
  if (!v.session || typeof v.session !== "object") return false;
  const session = v.session as Record<string, unknown>;
  if (typeof session.date !== "string") return false;
  if (typeof session.trading_day !== "boolean") return false;
  if (!session.heat || typeof session.heat !== "object") return false;
  if (!Array.isArray(v.setups)) return false;
  if (!Array.isArray(v.ledger)) return false;
  if (!Array.isArray(v.covered_elsewhere)) return false;
  if (!Array.isArray(v.allocation)) return false;
  return true;
}

/** A VALID, empty board payload — served for an admin `?sim=1` read before any frame
 *  has been seeded (or after a reset). Same shape a real quiet session produces, so the
 *  deck renders "no setup cleared the floor" rather than a degraded/error state. */
export function emptySimBoardPayload(): ZeroDteBoardPayload {
  const today = todayEt();
  const tradingDay = isTradingDayEt(today);
  const { hour, minute } = etNowParts();
  const heat = sessionHeat(hour * 60 + minute, tradingDay);
  return {
    available: true,
    as_of: new Date().toISOString(),
    upstream_ok: true,
    session: { date: today, trading_day: tradingDay, heat },
    setups: [],
    ledger: [],
    covered_elsewhere: [],
    governor: null,
    allocation: [],
    market_state: null,
    discovery_funnel: null,
    spx_slayer_badge: null,
  };
}

/** Read the sim snapshot (fail-soft: any store/shape error → null so the caller serves
 *  the empty payload, never a broken board). NEVER touches the member key. */
export async function readSimBoardSnapshot(): Promise<ZeroDteBoardPayload | null> {
  try {
    const snap = await sharedCacheGet<ZeroDteBoardPayload>(SIM_BOARD_SNAPSHOT_KEY);
    if (!snap || !isZeroDteBoardPayload(snap)) return null;
    return snap;
  } catch {
    return null;
  }
}

/** Serve the sim board for an admin `?sim=1` read: the seeded frame, or a valid empty
 *  payload when no frame has been posted yet. */
export async function getSimBoardPayload(): Promise<ZeroDteBoardPayload> {
  return (await readSimBoardSnapshot()) ?? emptySimBoardPayload();
}

/** Write ONE validated frame to the sim key with the short sim TTL. Returns the exact
 *  key + ttl written so the ingest endpoint can echo it back to the feeder. */
export async function writeSimBoardSnapshot(
  payload: ZeroDteBoardPayload
): Promise<{ key: string; ttlSec: number }> {
  await sharedCacheSet(SIM_BOARD_SNAPSHOT_KEY, payload, SIM_BOARD_TTL_SEC);
  return { key: SIM_BOARD_SNAPSHOT_KEY, ttlSec: SIM_BOARD_TTL_SEC };
}

/** Clear the sim key (reset). NEVER touches the member key. */
export async function clearSimBoardSnapshot(): Promise<{ key: string }> {
  await sharedCacheDel(SIM_BOARD_SNAPSHOT_KEY);
  return { key: SIM_BOARD_SNAPSHOT_KEY };
}
