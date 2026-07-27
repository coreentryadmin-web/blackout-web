// Unified alert fan-out. Callers (crons, per-user handlers) send ONE payload
// through here; the helper fans it out to every push channel the app supports
// (web-push VAPID for browsers, APNs for the native iOS app) in parallel.
//
// Both channels are independently GATED: if VAPID keys are missing the
// web-push path is inert, if the APNs Auth Key isn't in env the APNs path is
// inert. Neither ever throws. The returned envelope tells the caller which
// channels were configured + attempted + sent so the cron log carries the
// truth ("apns: sent=0 because inert" vs "apns: sent=12"), not a false-positive
// "success" that hides the fact that iOS members got nothing.
//
// This exists so a new server-side alert source (e.g. `personal-alert-fanout`
// or a future Vector-alerts channel) has ONE call to make and inherits the
// full delivery matrix instead of copy-pasting sendWebPush + sendApnsPush.

import { sendWebPush, vapidConfigured } from "./send-web-push";
import { sendApnsPush, apnsConfigured, type ApnsPushPayload } from "./send-apns-push";

export interface BroadcastPayload {
  title: string;
  body: string;
  /** In-app URL to deep-link to on tap. Both channels pass this through
   *  (web-push service worker + APNs `userInfo.url`). */
  url?: string;
  /** APS category id — mapped to your app-registered notification category
   *  so the app can route/action-taxonomize taps. Optional. */
  category?: string;
  /** APNs interruption level. Defaults to `.active` (matches "Deliver
   *  Immediately" — the right default for a market-move alert). Use
   *  `time-sensitive` for setup confirmations that MUST breach Focus mode. */
  interruptionLevel?: ApnsPushPayload["interruptionLevel"];
}

export interface BroadcastRecipient {
  /** When set, both channels scope to this user. Omit for a system-wide
   *  broadcast (matches the existing gex-alerts cron behaviour). */
  userId?: string;
}

export interface BroadcastResult {
  web: { configured: boolean; sent: number; pruned: number };
  apns: { configured: boolean; attempted: number; sent: number; pruned: number };
  /** Convenience: total delivered across both channels. */
  totalSent: number;
}

/** Fire ONE alert to every channel this deployment has configured. Runs
 *  the two channels in parallel — Promise.allSettled so one channel's
 *  failure never taints the other's result. */
export async function broadcastAlert(
  payload: BroadcastPayload,
  recipient: BroadcastRecipient = {}
): Promise<BroadcastResult> {
  // sendWebPush treats `url` as required in its own type (defaults to
  // /dashboard when the payload is JSON-serialised). Pass through what the
  // caller gave us, falling back to /dashboard here so the type is satisfied
  // and the eventual notification-tap navigation is never undefined.
  const webPromise = sendWebPush(
    { title: payload.title, body: payload.body, url: payload.url ?? "/dashboard" },
    { userId: recipient.userId }
  );
  const apnsPromise = sendApnsPush(
    {
      title: payload.title,
      body: payload.body,
      category: payload.category,
      interruptionLevel: payload.interruptionLevel ?? "active",
      userInfo: payload.url ? { url: payload.url } : undefined,
    },
    { userId: recipient.userId }
  );

  const [webRes, apnsRes] = await Promise.allSettled([webPromise, apnsPromise]);

  const web = webRes.status === "fulfilled"
    ? { configured: webRes.value.configured, sent: webRes.value.sent, pruned: webRes.value.pruned }
    : { configured: vapidConfigured(), sent: 0, pruned: 0 };

  const apns = apnsRes.status === "fulfilled"
    ? {
        configured: apnsRes.value.configured,
        attempted: apnsRes.value.attempted,
        sent: apnsRes.value.sent,
        pruned: apnsRes.value.pruned,
      }
    : { configured: apnsConfigured(), attempted: 0, sent: 0, pruned: 0 };

  return { web, apns, totalSent: web.sent + apns.sent };
}
