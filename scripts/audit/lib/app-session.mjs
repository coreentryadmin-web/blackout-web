/**
 * Mint an authenticated session for audit probes.
 *
 * Was a two-provider resolver: `staging.` hosts went through Cognito admin-initiate-auth, everything
 * else through Clerk. Staging was decommissioned 2026-07-25 and its Cognito pool deleted with it, so
 * the staging arm could only ever fail — it loaded a secret that no longer exists to reach a host
 * that no longer resolves. Production is the only environment, and it is Clerk-only.
 *
 * Kept as a thin wrapper rather than deleted: several harnesses import `mintAppSession` by name, and
 * a one-line indirection is cheaper than touching all of them for no behavioural gain.
 */
import { mintClerkPremiumSession } from "./prod-clerk-session.mjs";

export async function mintAppSession({ appUrl }) {
  const clerk = await mintClerkPremiumSession({ appUrl });
  if (!clerk.skip) clerk.provider = "clerk";
  return clerk;
}
