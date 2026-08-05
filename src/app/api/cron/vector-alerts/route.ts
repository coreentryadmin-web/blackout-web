// Cron: server-side evaluation of members' Vector wall-touch/flip-cross alert rules + (when
// activated) sendWebPush delivery — the "closed-tab" follow-up `vector-alerts.ts`'s header comment
// calls out explicitly. Client-side, the SAME evaluateAlerts() only runs while a tab is open/alive
// (see vector-notify.ts's SCOPE note); this cron is the server half so a member gets pinged even
// with no tab open at all.
//
// INERT BY DEFAULT — ships safe, mirrors the gex-alerts cron's convention exactly. Does NOTHING
// (returns `{ ok: true, inert: true }`) unless BOTH:
//   1) `process.env.VECTOR_ALERTS_PUSH` is "1"/"true" (the activation flag), AND
//   2) `vapidConfigured()` (VAPID keys are set).
// The optional `web-push` package + the `push_subscriptions` DB are enforced one layer deeper
// inside `sendWebPush` (stays inert without them). No push is ever sent until the platform
// deliberately turns this on.
//
// PER-USER, PER-RULE (unlike gex-alerts, which is a broadcast-to-everyone regime alert): each
// member's own persisted `vector_alert_rules` rows (`vector-alert-rules-db.ts`) drive their own
// evaluation, reusing the EXACT SAME `evaluateAlerts()` state machine the client uses — see
// `vector-alerts.ts`. That engine already owns "don't refire mid-approach" via rising-edge +
// cooldown + hysteresis; this route's only job is to PERSIST the returned `AlertState` across cron
// ticks per (user, ticker) via `sharedCacheGet/Set` (`alertStateCacheKey`), not to reimplement any
// dedup logic of its own.
//
// DATA SOURCE — reuses whatever GET /api/market/vector/walls already calls
// (`getVectorGexWallsForHorizon` / `getVectorGammaFlipForHorizon` from vector-snapshot.ts, which in
// turn share `getPerExpiryGexWalls`'s short in-process memo) plus `getGexPositioning` for spot. NO
// new Polygon/UW fetch path — this cron is a cache-reader over the same server functions the chart
// itself uses, at the "all" (blended near-term) horizon, matching the rule engine's ticker-only
// (not horizon-scoped) `AlertRule` shape.
//
// CONTEXT FETCH IS PER-TICKER, NOT PER-USER: many members can share a rule on the same ticker
// (e.g. SPY), so spot/walls/flip are fetched ONCE per distinct ticker per tick
// (`distinctTickers`) and reused across every user with a rule on that ticker — see lib.ts.
//
// PRIOR SPOT for flip-cross detection is also ticker-scoped (not per-user) — it's the same market
// tape for everyone watching a ticker, persisted under `priorSpotCacheKey(ticker)` with a TTL a
// little over one cron interval so a single missed tick doesn't silently reset every flip-cross
// rule's baseline.
//
// SCHEDULE (infra-owned — DO NOT edit cron config from here, same note as gex-alerts): run on a
// short interval during market hours (e.g. every 1-2 min) so a wall approach/flip cross doesn't sit
// unalerted a member with no tab open. The route also works on-demand via a manual Bearer call.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { dbConfigured, dbQuery } from "@/lib/db";
import {
  ensureVectorAlertRulesTable,
  rowToAlertRule,
  type VectorAlertRuleRow,
} from "@/features/vector/lib/vector-alert-rules-db";
import { evaluateAlerts, type AlertContext, type AlertState } from "@/features/vector/lib/vector-alerts";
import { notificationForFire } from "@/features/vector/lib/vector-notify";
import { getGexPositioning } from "@/lib/providers/gex-positioning";
import {
  getVectorGexWallsForHorizon,
  getVectorGammaFlipForHorizon,
} from "@/features/vector/lib/vector-snapshot";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { sendWebPush, vapidConfigured } from "@/lib/push/send-web-push";
import { logCronRun } from "@/lib/cron-run";
import { distinctTickers, alertStateCacheKey, priorSpotCacheKey, type UserTickerPair } from "./lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** State TTL comfortably longer than any realistic gap between cron ticks — a missed tick or two
 *  shouldn't silently reset a member's cooldown/armed state. */
const ALERT_STATE_TTL_SEC = 6 * 60 * 60;
/** Prior-spot TTL only needs to bridge ONE tick gap for a clean flip-cross baseline; kept short. */
const PRIOR_SPOT_TTL_SEC = 15 * 60;

type TickerContext = { spot: number; walls: AlertContext["walls"]; flip: number | null } | null;

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // INERT-by-default gate: ship safe. Do nothing unless explicitly activated AND VAPID is set.
  const activated =
    (process.env.VECTOR_ALERTS_PUSH === "1" || process.env.VECTOR_ALERTS_PUSH === "true") &&
    vapidConfigured();
  if (!activated) {
    await logCronRun("vector-alerts", started, { ok: true, skipped: true, reason: "inert (VECTOR_ALERTS_PUSH + VAPID)" });
    return NextResponse.json({ ok: true, inert: true });
  }

  if (!dbConfigured()) {
    // No server-side rule store reachable — nothing to evaluate (members' rules only exist in
    // localStorage on this deployment). Not an error: this cron degrades to a no-op.
    await logCronRun("vector-alerts", started, { ok: true, skipped: true, reason: "database not configured" });
    return NextResponse.json({ ok: true, inert: true, reason: "database not configured" });
  }

  let pairs: UserTickerPair[] = [];
  try {
    await ensureVectorAlertRulesTable();
    const { rows } = await dbQuery<UserTickerPair>(
      `SELECT DISTINCT user_id, ticker FROM vector_alert_rules WHERE enabled = true`
    );
    pairs = rows;
  } catch (error) {
    console.error("[cron vector-alerts] failed to read vector_alert_rules", error);
    await logCronRun("vector-alerts", started, { ok: false, error: "failed to read rule table" });
    return NextResponse.json({ ok: false, error: "Failed to read rules" }, { status: 500 });
  }

  if (!pairs.length) {
    await logCronRun("vector-alerts", started, { ok: true, evaluated_count: 0 });
    return NextResponse.json({ ok: true, inert: false, evaluated: 0, fired: 0, sent: 0 });
  }

  // One context fetch per DISTINCT ticker this tick, shared by every user with a rule on it.
  const tickers = distinctTickers(pairs);
  const contextByTicker = new Map<string, TickerContext>();
  for (const ticker of tickers) {
    try {
      const [pos, walls, flip] = await Promise.all([
        getGexPositioning(ticker),
        getVectorGexWallsForHorizon(ticker, "all"),
        getVectorGammaFlipForHorizon(ticker, "all"),
      ]);
      const spot = pos?.spot;
      contextByTicker.set(ticker, spot && spot > 0 ? { spot, walls, flip } : null);
    } catch {
      // Per-ticker isolation — a single ticker's fetch failure can't abort the rest.
      contextByTicker.set(ticker, null);
    }
  }

  let evaluated = 0;
  let fired = 0;
  let sent = 0;

  // PER (user, ticker) — one failure here must never abort the remaining pairs (mirrors
  // gex-alerts's per-ticker/per-event isolation convention).
  for (const { user_id: userId, ticker } of pairs) {
    try {
      const ctx0 = contextByTicker.get(ticker);
      if (!ctx0) continue; // this ticker's live data was unavailable this tick

      const { rows } = await dbQuery<VectorAlertRuleRow>(
        `SELECT id, ticker, kind, tolerance_pct, enabled
           FROM vector_alert_rules
          WHERE user_id = $1 AND ticker = $2 AND enabled = true`,
        [userId, ticker]
      );
      const rules = rows.map(rowToAlertRule);
      if (!rules.length) continue;

      const stateKey = alertStateCacheKey(userId, ticker);
      const priorKey = priorSpotCacheKey(ticker);
      const [state, prior] = await Promise.all([
        sharedCacheGet<AlertState>(stateKey),
        sharedCacheGet<{ spot: number }>(priorKey),
      ]);

      const ctx: AlertContext = {
        spot: ctx0.spot,
        priorSpot: prior?.spot ?? null,
        walls: ctx0.walls,
        flip: ctx0.flip,
        nowMs: Date.now(),
      };
      const result = evaluateAlerts(rules, ctx, state ?? {});
      await sharedCacheSet(stateKey, result.state, ALERT_STATE_TTL_SEC);
      evaluated++;

      for (const fire of result.fired) {
        try {
          const payload = notificationForFire(fire);
          const pushResult = await sendWebPush(
            { title: payload.title, body: payload.body, url: payload.url },
            { userId }
          );
          fired++;
          sent += pushResult.sent;
        } catch {
          // A single alert's send failure must not abort the rest of this user's fired alerts.
        }
      }
    } catch {
      // Per (user, ticker) isolation — never throw out of the loop.
    }
  }

  // The ticker-scoped prior-spot baseline is written ONCE per ticker per tick (not per user) —
  // done after the per-pair loop so every user's flip-cross evaluation this tick saw the SAME
  // "prior" value (the reading from the last tick), not a value another user's pair already
  // advanced earlier in this same tick.
  for (const ticker of tickers) {
    const ctx0 = contextByTicker.get(ticker);
    if (!ctx0) continue;
    await sharedCacheSet(priorSpotCacheKey(ticker), { spot: ctx0.spot }, PRIOR_SPOT_TTL_SEC).catch(() => undefined);
  }

  await logCronRun("vector-alerts", started, {
    ok: true,
    evaluated_count: evaluated,
    fired_count: fired,
    sent_count: sent,
  });
  return NextResponse.json({ ok: true, inert: false, evaluated, fired, sent });
}
