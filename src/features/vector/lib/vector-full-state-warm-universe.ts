import { fetchOpenSwingPositions } from "@/lib/db";
import { listSharedUniverseTickers, mergeSharedUniverseTickers } from "./vector-dynamic-universe";

/**
 * The ticker set `vector-full-state-snapshot`'s cron should proactively warm — the cache
 * `fetchVectorFullState`/`fetchEcosystemContext` read cache-first (`vector:full-state:{ticker}:
 * {horizon}`, TTL `VECTOR_FULL_STATE_CACHE_TTL_SEC` — 4h as of #5705, see vector-full-state-cache.ts
 * for why — was 15min when this header was first written), consumed by Ask Largo's swing
 * play-brief, ecosystem context, and every other reader `vector-full-state.ts`'s own header lists.
 *
 * GAP FOUND (Ask Largo x Night Hawk Swings standing mandate): the cron previously iterated only
 * `vectorUniverseTickers()` (the static allowlist), not even `listSharedUniverseTickers()`'s
 * static-union-dynamic-viewed set its sibling crons (`heatmap-warm`, `vector-walls-warm`) already
 * use. `vector-dynamic-universe.ts`'s own header names the resulting hole explicitly: "Night Hawk
 * is deliberately NOT wired in here: its ticker universe is discovery-driven ... if Night Hawk
 * ever needs its board's active tickers kept warm, that should be a bulk union of discovery
 * output, not this per-view path." Nobody had closed that gap — a ticker with a REAL, committed
 * swing position but outside the static allowlist (live repro 2026-09-26: HUT) never got
 * proactively warmed. Its full-state entry only existed when someone happened to read it, and
 * expired 15 minutes later; the next read after expiry paid a genuine cold-compute fan-out
 * (measured live: 2169ms cold vs 150-290ms warm for the identical ticker/horizon), which under
 * concurrent load can tip the swing play-brief's 8s per-source budget
 * (BRIEF_SOURCE_TIMEOUT_MS, brief-source-timeout.ts) into a real "ecosystem context: fetch
 * failed" / "Vector state: fetch failed" disclosure on Ask Largo's brief for a position held with
 * real member capital — reproduced live on HUT's play-brief the same day.
 *
 * Scoped to OPEN swing positions (real capital, the highest-stakes blast radius), not the whole
 * WATCH rail — a smaller, high-value bulk union rather than re-deriving the entire discovery pool
 * here. `fetchOpenSwingPositions` failing (a DB hiccup) degrades to the shared universe alone,
 * never blocks the sweep.
 *
 * ORDERING (Ask Largo standing mandate, live audit 2026-10-08): open positions are placed FIRST,
 * not appended after the shared universe. `mergeSharedUniverseTickers` keeps only the FIRST
 * occurrence of each ticker (de-dupes on the way through its own argument order), and this list's
 * order is exactly what `rotateTickersForWarmPass`'s cursor walks — so "appended last" used to mean
 * "warmed last in every lap, every time," for the exact population (real committed capital) the
 * rotation/TTL fixes above (#5701, #5705) exist to protect. Confirmed live, ~2h after #5705
 * deployed (two rotation laps' worth of cron cycles observed in CloudWatch): CIEG/MRNA/PSX — all
 * three real open swing positions — were STILL hard-timing out on Ask Largo's swing play-brief
 * (`SwingBriefSourceTimeout: brief source read exceeded 8000ms` on both `ecosystem context` and
 * `Vector state`), because the tail-heavy ordering meant this lap simply hadn't reached them yet.
 * The TTL fix makes a WARM entry survive long enough to outlast a lap; it does nothing for an
 * entry that is never the FIRST one warmed in a given lap. Putting positions first fixes the
 * latter without touching the former — the shared static/dynamic universe is still fully covered
 * every lap, just after the highest-stakes names rather than before them.
 */
export async function activeVectorFullStateTickers(): Promise<string[]> {
  const [shared, positions] = await Promise.all([
    listSharedUniverseTickers(),
    fetchOpenSwingPositions().catch(() => []),
  ]);
  return mergeSharedUniverseTickers(
    positions.map((p) => p.ticker),
    shared
  );
}

/**
 * Rotate `tickers` so repeated warm passes advance through the WHOLE list instead of resetting to
 * index 0 every run.
 *
 * BUG FOUND (Ask Largo x Night Hawk Swings standing mandate, live audit 2026-10-08): this cron's
 * own TIME_BUDGET_MS check (route.ts) only runs BETWEEN ticker batches, and a cold
 * `computeVectorFullState` pays a chain fetch (`vector-gex-heatmap-server.ts`'s
 * `fetchReconstructChain`, up to 60 paginated `/v3/snapshot/options/{underlying}` pages) that now
 * routinely costs far more than the per-batch share of the 50s budget under current shared-
 * rate-limiter load. Measured live: 13 consecutive runs over 3+ hours each logged
 * `written=8` (exactly ONE `TICKER_CONCURRENCY=2 x 4 horizons` batch) against a 59-62-ticker
 * universe, `elapsed=77220-146306ms` (1.5-3x the 50s budget), `budgetHit=true` every time.
 * Because `activeVectorFullStateTickers()` above always returns the SAME fixed order (static
 * allowlist first, in `vectorUniverseTickers()`'s own order, then dynamic/open-swing-position
 * names appended), the route's loop always dies on the SAME first ~2 static names and NEVER
 * reaches anything after them — not "slower," but a hard, permanent 0% coverage for every other
 * ticker in the merged universe, run after run, forever. That falsifies this cron's own stated
 * recovery invariant ("partial completion is fine... the next run... fills whatever this run
 * didn't reach" — route.ts's own comment) and silently reproduces the EXACT gap this file's own
 * header names as already fixed for HUT (2026-09-26): a real OPEN swing position (confirmed live:
 * INTC, positionId 50) never gets warmed at all, so its `fetchVectorFullState`/
 * `fetchEcosystemContext` read hard-times-out at the swing play-brief's 8s
 * `BRIEF_SOURCE_TIMEOUT_MS` on every single request — confirmed in CloudWatch
 * (`[swing-play-brief] ecosystem context fetch failed for INTC: SwingBriefSourceTimeout`), 13/13
 * sampled invocations across 3+ hours, for INTC and seven other tickers never in the first two
 * static slots (NET, BE, GOOGL, CIEN, MSFT, NRG, MRVL) — silently dropping Ask Largo's Vector/
 * ecosystem evidence from every swing play-brief for any ticker that isn't one of the first two
 * names in the static allowlist.
 *
 * Fix: the caller (route.ts) persists a rotating start offset across runs, so each run begins
 * where the PREVIOUS run's budget cutoff left off instead of restarting at index 0 every time.
 * Over enough 5-min runs this guarantees every ticker in the merged universe — including a real
 * open swing position far down the list — eventually gets its turn, without touching the
 * expensive Polygon-chain fetch itself (out of scope here — that cost is the other half of the
 * already-open ALB tail-latency investigation and needs its own measurement, not a blind change
 * to a shared hot path several other Vector/Thermal/Largo readers depend on).
 *
 * Pure: `cursor` is read/written by the caller (sharedCacheGet/Set in route.ts); this just computes
 * the rotated order. Wraps safely for an out-of-range/negative/non-finite cursor (a stale cursor
 * from a shorter previous universe, or corrupted Redis state, must never throw or skip everything).
 */
export function rotateTickersForWarmPass(tickers: readonly string[], cursor: number): string[] {
  const n = tickers.length;
  if (n === 0) return [];
  const safeCursor = Number.isFinite(cursor) ? Math.trunc(cursor) : 0;
  const start = ((safeCursor % n) + n) % n;
  return [...tickers.slice(start), ...tickers.slice(0, start)];
}

/**
 * Resolve the NUMERIC rotation cursor `rotateTickersForWarmPass` wants, from the TICKER NAME the
 * previous run last attempted — content-addressed, never a raw array offset carried across runs.
 *
 * BUG FOUND (Ask Largo standing mandate, live audit 2026-10-08, same day as the ordering fix
 * above): the caller used to persist `cursor` as a bare number and feed it straight back into
 * `rotateTickersForWarmPass` next run. That is only safe while `activeVectorFullStateTickers()`
 * returns tickers in a STABLE order — the moment that order changes, a stored numeric offset keeps
 * meaning "skip this many array slots," not "resume after ticker X," and silently points somewhere
 * else entirely. The ordering fix immediately above is exactly such a change: it moves ~35 open
 * positions from the TAIL of the merged list to the HEAD. Confirmed live: the persisted cursor
 * (34, carried over from the pre-fix tail-heavy list) was still being interpreted as a raw index
 * into the NEW, position-first list after the fix deployed — which, with positions now occupying
 * indices 0-34, put the cursor's rotation start WELL PAST every open position and into the shared-
 * universe tail instead, so the very first lap after the reorder dropped right past the highest-
 * stakes names the reorder exists to prioritize. The rotation only reaches them again once the raw
 * index happens to wrap back around past the list length — a full lap's delay (confirmed in
 * CloudWatch: FUBO/CRDU/LQDA — all real open positions near the front of the new order — still
 * logging `SwingBriefSourceTimeout` on `ecosystem context fetch failed` at 18:56, fourteen minutes
 * after the reorder fix had already deployed and three rotation runs had already fired).
 *
 * Resolving by CONTENT instead of position fixes this permanently, not just for today's one-time
 * reorder: any future change in list shape (a position opens/closes, the dynamic/shared universe's
 * membership shifts) resumes "right after whatever we last actually finished," wherever that
 * ticker now sits, rather than at a raw offset that silently means something else once the list
 * underneath it moves.
 *
 * Falls back to 0 (the START of the list — i.e., today's highest-priority names) when the
 * remembered ticker is no longer present (position closed, dropped from the universe, or no prior
 * run yet) — restarting a lap costs at most one extra partial pass over already-warm entries
 * (TTL is 4h, #5705), while silently resuming at a stale offset risks starving the exact
 * population a reorder was meant to protect, which is the far more expensive failure.
 *
 * DEPLOY-TRANSITION SAFETY: `lastAttemptedTicker` is typed `unknown`, not `string`, because the
 * FIRST read after this change ships will still hand back whatever the OLD code last persisted — a
 * bare NUMBER
 * (Redis/JSON round-trips a number as a number, not a string; TypeScript's generic on the read
 * side cannot enforce that at runtime). Accepting `unknown` here and checking `typeof` explicitly
 * means that leftover number is treated as "no remembered ticker" (falls back to 0) instead of
 * throwing when `.trim()` is called on it — the exact kind of one-release-only crash that is easy
 * to miss in a diff review because it only ever happens once, right after deploy.
 */
export function resolveWarmCursorIndex(
  tickers: readonly string[],
  lastAttemptedTicker: unknown
): number {
  if (typeof lastAttemptedTicker !== "string" || !lastAttemptedTicker) return 0;
  const key = lastAttemptedTicker.trim().toUpperCase();
  if (!key) return 0;
  const idx = tickers.findIndex((t) => t.toUpperCase() === key);
  return idx === -1 ? 0 : idx + 1; // resume AFTER the last ticker actually attempted
}
