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

/** How long one address may go without receiving the lead magnet again. */
export const LEAD_MAGNET_RESEND_COOLDOWN_HOURS = 24;

/**
 * Has this address already been sent the lead magnet inside the cooldown window?
 *
 * The abuse this closes: POST /api/public/email-capture is unauthenticated by design (a logged-out
 * visitor closing the tab is exactly who it exists for) and used to send on EVERY submission. Its
 * only bound was an IP rate limit, which caps the CALLER, not the RECIPIENT — so anyone could name
 * a victim's address and have us mail it repeatedly, ~7,200/day from a single IP and linearly more
 * with rotation. That is a mail-bomb amplifier pointed at a sending domain with no reputation yet,
 * and the damage lands on the domain (and therefore on transactional mail) rather than on the
 * attacker.
 *
 * Deliberately NOT gated on `recordEmailCapture`'s `isNew`: that returns false both for a duplicate
 * AND when the DB is unavailable, so a DB blip would silently stop every send. This asks a separate
 * question — "did we already mail this address recently?" — and answers `false` when it cannot
 * tell, so an outage degrades to today's behaviour rather than to silence.
 */
export async function wasLeadMagnetSentRecently(
  email: string,
  cooldownHours: number = LEAD_MAGNET_RESEND_COOLDOWN_HOURS
): Promise<boolean> {
  if (!dbConfigured()) return false;
  try {
    const res = await dbQuery<{ recent: boolean }>(
      `SELECT (lead_magnet_sent_at IS NOT NULL
               AND lead_magnet_sent_at > NOW() - ($2 || ' hours')::interval) AS recent
         FROM email_captures
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1`,
      [email.trim(), String(cooldownHours)]
    );
    return res.rows[0]?.recent === true;
  } catch (err) {
    console.warn("[email-captures] wasLeadMagnetSentRecently failed", err);
    return false;
  }
}
