// Personal-alert fan-out: delivers the SAME formatted play content to each opt-in
// user's personal Discord webhook, reusing discord-post.ts. This is the only impure
// piece of the scaffold.
//
// INERT BY DEFAULT: returns immediately unless SPX_PERSONAL_ALERTS is enabled. Even
// when enabled it no-ops until a recipient source is wired (loadPersonalAlertRecipients
// returns [] in this scaffold). It NEVER throws into callers and NEVER blocks the shared
// webhook path — notifyPlayDiscord calls it fire-and-forget.
//
// SECURITY: never logs webhook URLs; postDiscordWebhook already logs only redacted hosts.

import { postDiscordWebhook } from "@/lib/discord-post";
import {
  personalAlertsEnabled,
  personalAlertMaxRecipients,
  resolvePersonalAlertTargets,
  type PersonalAlertCandidate,
} from "@/lib/personal-alert-targets";

/**
 * Recipient source for personal alerts. SCAFFOLD STUB: returns [] so nothing is sent
 * and no Clerk enumeration happens on the money path.
 *
 * To activate (post-decision — see manualUserSteps), replace the body with a source
 * that lists opt-in {userId, url} pairs. Recommended: maintain a lightweight opt-in
 * index (a personal_alert_optin DB table, or a Clerk publicMetadata boolean + a cached
 * nightly scan) rather than enumerating ALL Clerk users on every alert.
 */
export async function loadPersonalAlertRecipients(): Promise<PersonalAlertCandidate[]> {
  return [];
}

/**
 * Fan `content` out to every opt-in personal webhook. Fire-and-forget; never throws.
 * No-op when the feature flag is off or there are no recipients.
 */
export async function notifyPlayPersonal(content: string): Promise<void> {
  try {
    const enabled = personalAlertsEnabled();
    if (!enabled) return;

    const candidates = await loadPersonalAlertRecipients();
    const targets = resolvePersonalAlertTargets(candidates, {
      enabled,
      maxRecipients: personalAlertMaxRecipients(),
    });
    if (targets.length === 0) return;

    // Deliver in parallel; postDiscordWebhook self-guards (never throws, logs redacted).
    await Promise.all(
      targets.map((t) =>
        postDiscordWebhook(t.url, { content }, "spx-play-personal").catch(() => false)
      )
    );
  } catch (err) {
    // Personal fan-out must never affect the shared alert path.
    console.error(
      "[personal-alert-fanout] unexpected error",
      err instanceof Error ? err.message : err
    );
  }
}
