/** Primary email from a Clerk webhook `UserJSON` payload (not guaranteed [0] is primary). */
export function primaryEmailFromClerkWebhook(data: {
  primary_email_address_id?: string | null;
  email_addresses?: Array<{ id: string; email_address?: string }> | null;
}): string | null {
  const primaryId = data.primary_email_address_id;
  if (primaryId && data.email_addresses?.length) {
    const match = data.email_addresses.find((e) => e.id === primaryId);
    if (match?.email_address) return match.email_address;
  }
  return data.email_addresses?.[0]?.email_address ?? null;
}
