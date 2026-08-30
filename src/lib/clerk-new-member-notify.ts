/**
 * Pure helper for the "new member signed up" ops notification — split out of the Clerk
 * `user.created` webhook route so the formatting logic is unit-testable without the route's
 * signature-verification/DB machinery, same pattern as whop-cancellation-notify.ts.
 *
 * Builds Discord EMBED fields (Email / Name / Clerk User ID), not a flat content string —
 * the flat-string version this replaced rendered as one unstructured line
 * ("a@b.com — Name · clerk_user_id=user_x") next to Whop's own native "Membership was
 * generated" embed, which is a properly labeled card. `notifyOpsDiscord` now accepts
 * `fields` and renders them the same way.
 */

export interface OpsNotificationField {
  name: string;
  value: string;
  inline?: boolean;
}

export function buildNewMemberNotificationFields(input: {
  email: string | null | undefined;
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  clerkUserId: string;
}): OpsNotificationField[] {
  const name = [input.firstName, input.lastName].filter(Boolean).join(" ").trim();
  const fields: OpsNotificationField[] = [
    { name: "Email", value: input.email ?? "*no email on account*" },
  ];
  if (name) fields.push({ name: "Name", value: name });
  fields.push({ name: "Clerk User ID", value: `\`${input.clerkUserId}\`` });
  return fields;
}
