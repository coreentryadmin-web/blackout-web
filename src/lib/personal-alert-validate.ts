// Pure, alias-free Discord webhook validation. NO @clerk / no @/ imports so it
// unit-tests cleanly under `tsx --test` (mirrors the membership-tiebreak.test.ts
// convention of keeping Clerk-importing modules out of the test graph).
//
// SECURITY: accepts only https discord.com / discordapp.com /api/webhooks URLs to
// avoid SSRF-to-arbitrary-host and to ensure we only ever POST to Discord.

/**
 * Validate a user-supplied Discord webhook URL.
 * Accepts only https discord.com / discordapp.com (+ canary/ptb) /api/webhooks URLs.
 */
export function isValidDiscordWebhook(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.host.toLowerCase();
  const okHost =
    host === "discord.com" ||
    host === "discordapp.com" ||
    host === "canary.discord.com" ||
    host === "ptb.discord.com";
  if (!okHost) return false;
  // Path looks like /api/webhooks/{id}/{token}
  return /^\/api\/webhooks\/\d+\/[\w-]+$/.test(u.pathname);
}
