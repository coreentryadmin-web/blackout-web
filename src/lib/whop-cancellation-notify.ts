/**
 * Pure helpers for the cancellation-reason-capture ops notification
 * (docs/marketing/SEO-GROWTH.md finding #6) — split out of the webhook route
 * so the formatting/trigger logic is unit-testable without the route's
 * signature-verification/Redis/DB machinery.
 *
 * SECURITY: `cancellationReason` is Whop's own free-text cancellation-survey field — a member
 * types it verbatim into Whop's cancel flow, and it reaches this ops Discord notification
 * unreviewed. `email`'s local-part may also legally contain Markdown-special characters (RFC
 * 5321). Both are interpolated into a plain-text Discord `content` string (via
 * `notifyOpsDiscord`'s `body`), and Discord still renders Markdown emphasis/strikethrough/
 * inline-code/blockquote inside plain message content (only masked `[label](url)` links are
 * embed-only, per `clerk-new-member-notify.ts`'s own header comment). Without escaping, a
 * cancelling member could inject formatting — or, via a stray backtick/`>`, visually break out
 * of the intended quoted free-text span — into the internal ops channel. Same bug shape as the
 * `firstName`/`email` Discord-markdown gap that module fixed; reuses its
 * `escapeDiscordMarkdown` rather than duplicating it.
 */

import { escapeDiscordMarkdown } from "./clerk-new-member-notify";

/** Only a NEW cancellation (cancel_at_period_end flipping to true) carries a fresh reason. */
export function shouldNotifyCancellation(
  eventType: string,
  cancelAtPeriodEnd: boolean | null | undefined
): boolean {
  return eventType === "membership.cancel_at_period_end_changed" && cancelAtPeriodEnd === true;
}

export function buildCancellationNotificationBody(input: {
  email: string | null | undefined;
  whopUserId: string | null | undefined;
  cancelOption: string | null | undefined;
  cancellationReason: string | null | undefined;
}): string {
  // email is attacker-controlled free text and must be escaped; whopUserId is a server-assigned
  // id (safe as-is — escaping it would mangle legitimate underscores in e.g. "user_whop_123").
  const who = input.email
    ? escapeDiscordMarkdown(input.email)
    : input.whopUserId ?? "unknown member";
  const reasonLabel = input.cancelOption ?? "no_reason_given";
  const freeText = input.cancellationReason?.trim();
  return (
    `${who} cancels ${reasonLabel}` +
    (freeText ? ` — "${escapeDiscordMarkdown(freeText)}"` : "") +
    ". No automatic win-back offer exists yet (cancellation happens entirely on Whop's " +
    "portal — no in-app interception point); this is visibility only."
  );
}
