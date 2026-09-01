import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";

// Trial-ending conversion nudge — one send per membership per trial window. Whop fires
// membership.trial_ending_soon ahead of the first charge; without it members only discover
// billing at deactivation.

const TRIAL_NUDGE_PREFIX = "whop:trial-nudge:";
const TRIAL_NUDGE_TTL_SEC = 45 * 24 * 60 * 60;

export async function wasTrialEndingNudgeSent(membershipId: string | null | undefined): Promise<boolean> {
  if (!membershipId) return false;
  return (await sharedCacheGet<number>(TRIAL_NUDGE_PREFIX + membershipId)) === 1;
}

export async function markTrialEndingNudgeSent(membershipId: string | null | undefined): Promise<void> {
  if (!membershipId) return;
  await sharedCacheSet(TRIAL_NUDGE_PREFIX + membershipId, 1, TRIAL_NUDGE_TTL_SEC);
}
