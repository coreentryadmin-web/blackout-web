// Pure resolver for personal-alert fan-out. Decides WHICH opt-in webhooks receive a
// personal copy of a play alert, given the feature flag and a candidate list. No I/O
// here on purpose: this keeps the decision logic unit-testable under `tsx --test` and
// keeps the money path (engines -> notifyPlayDiscord) free of any Clerk enumeration.
//
// The feature is OFF by default: when the flag is not set the resolver returns [],
// so notifyPlayPersonal becomes an immediate no-op and shared-webhook behavior is
// byte-for-byte unchanged.

export interface PersonalAlertCandidate {
  userId: string;
  url: string;
}

/** True only when SPX_PERSONAL_ALERTS is explicitly enabled ("1" / "true"). */
export function personalAlertsEnabled(
  env: string | undefined = process.env.SPX_PERSONAL_ALERTS
): boolean {
  const v = env?.trim().toLowerCase();
  return v === "1" || v === "true";
}

/** Hard cap on personal fan-out per alert (protects against accidental blast). */
export function personalAlertMaxRecipients(
  env: string | undefined = process.env.SPX_PERSONAL_ALERTS_MAX
): number {
  const n = Number(env?.trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200;
}

/**
 * Pure: filter + dedup + cap candidates into deliverable targets.
 * - drops blank urls
 * - dedups by url (a user with two accounts pointing at one channel = one post)
 * - caps to maxRecipients
 * Returns [] when the feature is disabled.
 */
export function resolvePersonalAlertTargets(
  candidates: PersonalAlertCandidate[],
  opts: { enabled: boolean; maxRecipients: number }
): PersonalAlertCandidate[] {
  if (!opts.enabled) return [];
  const seen = new Set<string>();
  const out: PersonalAlertCandidate[] = [];
  for (const c of candidates) {
    const url = c.url?.trim();
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ userId: c.userId, url });
    if (out.length >= opts.maxRecipients) break;
  }
  return out;
}
