/**
 * Pure helper for the "new member signed up" ops notification — split out of the Clerk
 * `user.created` webhook route so the formatting logic is unit-testable without the route's
 * signature-verification/DB machinery, same pattern as whop-cancellation-notify.ts.
 */

export function buildNewMemberNotificationBody(input: {
  email: string | null | undefined;
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  clerkUserId: string;
}): string {
  const name = [input.firstName, input.lastName].filter(Boolean).join(" ").trim();
  return (
    `${input.email ?? "no email on account"}` +
    (name ? ` — ${name}` : "") +
    ` · clerk_user_id=${input.clerkUserId}`
  );
}
