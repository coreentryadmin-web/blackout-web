/**
 * Auth provider selector — now a Clerk-only constant.
 *
 * Cognito was decommissioned; production auth is Clerk, always. The entire Cognito
 * implementation (the `/api/auth/cognito/*` OAuth routes, `cognito-config`, `cognito-session`,
 * the Cognito middleware, and the client Cognito provider) has been deleted. This module is kept
 * only as a hardcoded shim so the handful of admin user-management routes that still branch on
 * `isCognitoAuth()` compile unchanged — those branches are now provably dead (this always returns
 * false) and are a safe, mechanical follow-up cleanup, deliberately not surgically removed in the
 * same change as the security-relevant deletion to avoid touching live admin-auth logic.
 *
 * Do NOT reintroduce a Cognito branch here. If a second auth provider is ever needed, add it as a
 * new, tested integration rather than resurrecting this switch.
 */
export type AuthProviderName = "clerk";

export function getAuthProvider(): AuthProviderName {
  return "clerk";
}

export function isCognitoAuth(): boolean {
  return false;
}

export function isClerkAuth(): boolean {
  return true;
}

export function getClientAuthProvider(): AuthProviderName {
  return "clerk";
}

export function isClientCognitoAuth(): boolean {
  return false;
}
