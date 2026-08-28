/**
 * Recognizes the audit/test-harness Clerk accounts this repo's own scripts create against
 * PRODUCTION Clerk (scripts/audit/lib/clerk-audit-user.mjs and ~15 other harnesses — see
 * `docs/audit/findings-staging/2026-08-28-ops-alert-audit-account-noise.md`). Every one of
 * them follows one of two conventions: this repo's own `claude-` prefix (claude-audit-temp+...,
 * claude-nh-check, claude-simfeed-temp, ...) or an `-audit-` tag used by lanes that mint their
 * own timestamped addresses (seo-audit-<ts>@, largo-spx-audit-<ts>@). `@example.com` is the
 * third convention, used by a couple of harnesses (helix-interaction-audit.mjs) that don't hit
 * the real domain at all.
 *
 * A REAL member's email will not collide with any of these: `startsWith("claude-")` requires
 * the hyphen immediately after "claude", so "claude@gmail.com" or "claude.smith@yahoo.com" (a
 * real person literally named Claude) do not match; `includes("-audit-")` requires the hyphen
 * on both sides, so "auditor@gmail.com" does not match either.
 */
export function isInternalAuditEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  if (lower.endsWith("@example.com")) return true;
  const local = lower.split("@")[0] ?? "";
  return local.startsWith("claude-") || local.includes("-audit-");
}
