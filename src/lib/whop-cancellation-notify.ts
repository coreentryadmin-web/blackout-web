/**
 * Pure helpers for the cancellation-reason-capture ops notification
 * (docs/marketing/SEO-GROWTH.md finding #6) — split out of the webhook route
 * so the formatting/trigger logic is unit-testable without the route's
 * signature-verification/Redis/DB machinery.
 */

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
  const who = input.email ?? input.whopUserId ?? "unknown member";
  const reasonLabel = input.cancelOption ?? "no_reason_given";
  const freeText = input.cancellationReason?.trim();
  return (
    `${who} cancels ${reasonLabel}` +
    (freeText ? ` — "${freeText}"` : "") +
    ". No automatic win-back offer exists yet (cancellation happens entirely on Whop's " +
    "portal — no in-app interception point); this is visibility only."
  );
}
