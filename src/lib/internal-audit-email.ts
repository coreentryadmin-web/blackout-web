/**
 * Recognizes the audit/test-harness Clerk accounts this repo's own scripts create against
 * PRODUCTION Clerk. `scripts/audit/lib/clerk-audit-user.mjs` is the shared entry point, but
 * ~30 older/ad-hoc harnesses each mint their own address inline instead of going through it —
 * see `docs/audit/findings-staging/2026-08-28-ops-alert-audit-account-noise.md` (the original
 * fix) and `docs/audit/findings-staging/2026-08-28-e2e-audit-emails-not-recognized.md` (this
 * widening — found live: `vector-e2e-<ts>@` and `ios-ui-e2e-<ts>@` posting real "New member
 * signed up" alerts to ops Discord, neither caught by the original two rules).
 *
 * Every convention observed across those ~30 scripts reduces to five shapes:
 *  1. This repo's own `claude-` prefix (claude-audit-temp+..., claude-nh-check, claude-e2e-...).
 *  2. An `-audit-` tag, or a bare `audit-` prefix (seo-audit-<ts>@, audit-nh-force-<ts>@).
 *  3. `e2e` as its own hyphen-delimited segment (vector-e2e-, spx-e2e-, ios-ui-e2e-,
 *     e2e-subject-, e2e-subject-fb-, zerodte-e2e-).
 *  4. A hyphen immediately followed by 9+ digits — a `Date.now()` (Unix-ms) suffix, the
 *     dominant convention for the rest (rth-sweep-, jwt-probe-, nh-deploy-,
 *     deep-security-audit's `${label}-${Date.now()}-...`, premium-security-audit's
 *     `${label}-${Date.now()}`, ...). Anchored to a hyphen so a genuine phone-number-style
 *     local part ("5551234567@...") cannot false-positive.
 *  5. A hyphen immediately followed by exactly 8 lowercase hex chars — the shape of
 *     `crypto.randomBytes(4).toString("hex")`, used by the handful of harnesses that don't
 *     embed a timestamp at all (meridian-cap-, cto-free-, cto-prem-, admin-ui-, nav-soak-,
 *     desk-ui-).
 *  6. `@example.com` — used by a couple of harnesses (helix-interaction-audit.mjs) that don't
 *     hit the real domain at all.
 *
 * A REAL member's email will not collide with any of these: `startsWith("claude-")` requires
 * the hyphen immediately after "claude", so "claude@gmail.com" or "claude.smith@yahoo.com" (a
 * real person literally named Claude) do not match; the e2e/digit/hex checks are all anchored
 * to a hyphen boundary, so an incidental substring match ("cafe2e5@..." contains "e2e" but not
 * as its own hyphen-bounded segment) does not trigger them.
 */
export function isInternalAuditEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  if (lower.endsWith("@example.com")) return true;
  const local = lower.split("@")[0] ?? "";
  if (local.startsWith("claude-") || local.startsWith("audit-") || local.includes("-audit-")) {
    return true;
  }
  if (/(^|-)e2e(-|$)/.test(local)) return true;
  if (/-\d{9,}/.test(local)) return true;
  if (/-[0-9a-f]{8}$/.test(local)) return true;
  return false;
}
