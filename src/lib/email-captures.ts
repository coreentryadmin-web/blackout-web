import { dbConfigured, dbQuery } from "@/lib/db";

// Deliberately simple (not RFC 5322 exhaustive) — good enough to reject junk
// input without false-rejecting real addresses. Matches the "one @, something
// on each side, a dot in the domain" bar most production email validators use.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim()) && value.length <= 254;
}

export async function recordEmailCapture(input: {
  email: string;
  sourcePath?: string | null;
  utmSource?: string | null;
  utmCampaign?: string | null;
}): Promise<{ isNew: boolean }> {
  if (!dbConfigured()) return { isNew: false };
  const email = input.email.trim().toLowerCase();
  try {
    const res = await dbQuery(
      `INSERT INTO email_captures (email, source_path, utm_source, utm_campaign)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (LOWER(email)) DO NOTHING
       RETURNING id`,
      [email, input.sourcePath ?? null, input.utmSource ?? null, input.utmCampaign ?? null]
    );
    return { isNew: (res.rowCount ?? 0) > 0 };
  } catch (err) {
    console.warn("[email-captures] recordEmailCapture failed", err);
    return { isNew: false };
  }
}

export async function markLeadMagnetSent(email: string): Promise<void> {
  if (!dbConfigured()) return;
  try {
    await dbQuery(
      `UPDATE email_captures SET lead_magnet_sent_at = NOW() WHERE LOWER(email) = LOWER($1)`,
      [email.trim()]
    );
  } catch (err) {
    console.warn("[email-captures] markLeadMagnetSent failed", err);
  }
}
