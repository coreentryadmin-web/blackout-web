import { dbConfigured, dbQuery } from "@/lib/db";
import { sendWebPush, vapidConfigured } from "@/lib/push/send-web-push";
import { sharedCacheSetNx } from "@/lib/shared-cache";
import {
  ensureHelixAlertRulesTable,
  rowToHelixAlertRule,
  matchesHelixAlertRule,
  type HelixAlertRuleRow,
} from "@/features/helix/lib/helix-alert-rules-db";
import { fmtPremium } from "@/lib/fmt-money";
import type { PublishedFlowRow } from "@/lib/flow-persist";

/**
 * Per-ticker HELIX flow alert delivery — fires inline from `persistAndPublishFlowAlert` (the ONE
 * choke point every genuinely-new flow print already passes through, `shouldPublish` block,
 * alongside the existing Discord fan-out) rather than a polling cron. Flow prints already arrive
 * continuously via the ingest cron/WS path, so there is no "closed tab" gap a separate evaluator
 * cron would need to cover the way Vector's wall-touch/flip-cross rules do (those need a LIVE
 * chart tick a cron has to simulate; a flow print is itself the event).
 *
 * INERT BY DEFAULT (same discipline as gex-alerts/vector-alerts): requires BOTH
 * `HELIX_ALERTS_PUSH=1` AND VAPID keys configured. The env/VAPID check runs BEFORE any DB query,
 * so an unactivated deployment pays zero extra cost on the hot ingest path per the standing
 * latency-audit mandate — this function is called on every persisted print, all day, cluster-wide.
 */

const ALERT_COOLDOWN_SEC = 300; // 5 min — one push per (user, ticker) per cooldown window, not per print

function activated(): boolean {
  return (
    (process.env.HELIX_ALERTS_PUSH === "1" || process.env.HELIX_ALERTS_PUSH === "true") &&
    vapidConfigured()
  );
}

export async function notifyHelixAlertSubscribers(flow: PublishedFlowRow): Promise<void> {
  if (!activated() || !dbConfigured()) return;

  try {
    await ensureHelixAlertRulesTable();
    const { rows } = await dbQuery<HelixAlertRuleRow & { user_id: string }>(
      `SELECT user_id, ticker, min_premium, side, enabled
         FROM helix_alert_rules
        WHERE ticker = $1 AND enabled = true`,
      [flow.ticker]
    );
    if (!rows.length) return;

    for (const row of rows) {
      const rule = rowToHelixAlertRule(row);
      if (!matchesHelixAlertRule(rule, { ticker: flow.ticker, premium: flow.premium, option_type: flow.option_type })) {
        continue;
      }

      // Claim-before-send: a lost race means another replica/process already sent this user's
      // alert for this ticker within the cooldown window — skip rather than double-fire. Fails
      // OPEN is the wrong call here (unlike a cron's "missed guard is a lesser problem" — this
      // guard's whole job is stopping spam), so a Redis error is a hard skip, not a fallback-send.
      const cooldownKey = `helix:alert-cooldown:${row.user_id}:${flow.ticker}`;
      let claimed = false;
      try {
        claimed = await sharedCacheSetNx(cooldownKey, { at: flow.alerted_at || flow.event_at || null }, ALERT_COOLDOWN_SEC);
      } catch {
        continue;
      }
      if (!claimed) continue;

      void sendWebPush(
        {
          title: `${flow.ticker} ${flow.option_type} flow alert`,
          body: `${fmtPremium(flow.premium)} premium print${flow.strike ? ` · ${flow.strike}${flow.option_type === "PUT" ? "P" : "C"}` : ""}`,
          url: `/flows?ticker=${flow.ticker}`,
        },
        { userId: row.user_id }
      );
    }
  } catch (err) {
    // Fire-and-forget on the ingest hot path — a rule-evaluation failure must never affect the
    // print's own persist/publish/Discord flow, same discipline as notifyDiscord's own try/catch.
    console.warn("[helix-alert-notify]", err);
  }
}
