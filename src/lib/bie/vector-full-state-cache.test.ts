import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  vectorFullStateCacheKey,
  readVectorFullStateCache,
  writeVectorFullStateCache,
  VECTOR_FULL_STATE_CACHE_TTL_SEC,
} from "./vector-full-state-cache";
import { VECTOR_FULL_STATE_FIXTURE } from "./vector-full-state-fixture";

describe("vector-full-state cache", () => {
  test("cache key is vector:full-state:{version}:{ticker}:{horizon}, normalized", () => {
    assert.equal(vectorFullStateCacheKey("nvda", "all"), "vector:full-state:v3:NVDA:all");
    assert.equal(vectorFullStateCacheKey("SPY", "0dte"), "vector:full-state:v3:SPY:0dte");
  });

  // The version segment is the ONLY thing that makes a unit change safe to deploy: readers are
  // cache-first with a 15-min TTL, so without it the new code would serve old-shape snapshots for
  // 15 minutes (v1 held magnet.distancePct as a fraction; v3 added the ET session anchor beside asOf).
  test("the key carries an explicit payload-shape version", () => {
    assert.match(vectorFullStateCacheKey("SPX", "weekly"), /^vector:full-state:v\d+:SPX:weekly$/);
  });

  test("read returns null on a miss (never throws)", async () => {
    const miss = await readVectorFullStateCache("VFSNEVERWRITTEN", "weekly");
    assert.equal(miss, null);
  });

  test("write then read round-trips the full state (memory fallback when no Redis)", async () => {
    // A distinctive fake ticker so this never collides with a real cached snapshot.
    await writeVectorFullStateCache("VFSTESTX", "all", VECTOR_FULL_STATE_FIXTURE);
    const back = await readVectorFullStateCache("VFSTESTX", "all");
    // JSON round-trip through the shared cache preserves the whole object.
    assert.deepEqual(back, VECTOR_FULL_STATE_FIXTURE);
  });

  /**
   * RATCHET (Ask Largo standing mandate, live audit 2026-10-08): the TTL must survive one full
   * warm-pass rotation lap at the cron's MEASURED throughput, or most of the universe is cold most
   * of the time and this cache stops doing its job even though `rotateTickersForWarmPass` (the
   * 2026-10-08 starvation fix, `vector-full-state-warm-universe.ts`) is working exactly as
   * designed.
   *
   * MEASURED live in CloudWatch (`/ecs/blackout-production`), 2026-10-08, ~30 minutes of
   * consecutive `[cron/vector-full-state-snapshot] background done` lines, AFTER the rotation fix
   * had already shipped and was confirmed advancing (`cursor=22,26,28,30,32,34,36,38...`):
   *
   *   tickers=64 horizons=4 cursor=36 attempted=2 written=8 ... budgetHit=true elapsed=51050ms
   *   tickers=64 horizons=4 cursor=34 attempted=2 written=8 ... budgetHit=true elapsed=74664ms
   *   tickers=64 horizons=4 cursor=32 attempted=2 written=8 ... budgetHit=true elapsed=117676ms
   *   tickers=64 horizons=4 cursor=30 attempted=2 written=8 ... budgetHit=true elapsed=81934ms
   *
   * `attempted=2` (one `TICKER_CONCURRENCY=2` batch) on an ~5-min schedule against a 64-ticker
   * universe means a full rotation lap takes ~64/2 * 5min = 160 minutes — eleven times longer than
   * the old 15-minute TTL. So an entry is warm for 15 minutes out of every ~160, i.e. cold ~90% of
   * the time, for EVERY ticker, not just the ones the old fixed-order bug starved outright. That
   * reproduced as a 100% failure rate (9/9 sampled tickers, two different hours) on Ask Largo's own
   * `GET /api/market/swing/play-brief` — `ecosystem context` and `Vector state` both hard-timing
   * out at `BRIEF_SOURCE_TIMEOUT_MS` (8s) on every single ticker tried, including real open-capital
   * swing positions (MSFT, NRG, CIEN) that the rotation fix explicitly exists to protect.
   *
   * The fix is a longer TTL, not a faster cron: `describeVectorFreshness` (vector-state-freshness.ts)
   * already derives staleness purely from the snapshot's own `observed_at` vs read time, completely
   * independent of this Redis TTL — so a longer-lived entry is never misrepresented as live, it is
   * correctly labeled "stale" with an honest age once older than 10 minutes (Largo C2). Raising the
   * TTL therefore trades a hard, evidence-free "fetch failed" for an honestly-labeled possibly-stale
   * read, which is strictly more informative and does not touch the expensive per-ticker compute
   * path (the chain fetch, already flagged out of scope in the 2026-10-08 rotation-fix write-up).
   */
  test("TTL survives one full warm-pass rotation lap at the cron's measured throughput (2026-10-08)", () => {
    const MEASURED_UNIVERSE_SIZE = 64;
    const MEASURED_TICKERS_PER_CYCLE = 2; // `attempted=2` — one TICKER_CONCURRENCY batch per run
    const CRON_CYCLE_SEC = 5 * 60; // "~Every 5 min (market hours)" per cron-registry.ts
    const fullLapSec = (MEASURED_UNIVERSE_SIZE / MEASURED_TICKERS_PER_CYCLE) * CRON_CYCLE_SEC;
    assert.ok(
      VECTOR_FULL_STATE_CACHE_TTL_SEC > fullLapSec,
      `TTL (${VECTOR_FULL_STATE_CACHE_TTL_SEC}s) must exceed one full rotation lap ` +
        `(${fullLapSec}s, measured 64 tickers @ 2/cycle every 5min) or most of the universe is ` +
        `cold between warms — reproducing the 100% ecosystem/Vector fetch-failure rate measured ` +
        `live on Ask Largo's swing play-brief even after the rotation-starvation fix shipped`
    );
  });
});
