/**
 * HELIX repeat-hit milestone gate — ping at 3rd / 5th / 10th contract hit, not every repeat.
 */
import type { HelixDiscordFlowInput } from "@/lib/helix-discord-format";
import { flowContractKeyOrUnknown } from "@/lib/helix/contract-identity";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";

export const HELIX_STACK_MILESTONES = [3, 5, 10] as const;

const MILESTONE_TTL_SEC = 8 * 60 * 60;

/**
 * Cache key holding which milestone a contract has already posted.
 *
 * This used to quantise the strike to the nearest DOLLAR, which made two separately traded
 * contracts share ONE counter — and here that direction is SUPPRESSION, not overstatement: once
 * `INTC 92.5P` had posted its 3rd-hit milestone, a genuine 3rd hit on `INTC 93P` read
 * `lastPosted: 3` and never posted. No error, no log, just an alert that does not arrive.
 *
 * A cache bucket must exist even for a malformed row, so this uses the never-null variant — which
 * keeps ticker/expiry/side rather than collapsing every unusable-strike row onto one counter.
 */
export function helixContractKey(flow: HelixDiscordFlowInput): string {
  return flowContractKeyOrUnknown(flow);
}

export function isHelixRepeatFlow(flow: HelixDiscordFlowInput): boolean {
  return /repeat/i.test(String(flow.alert_rule || ""));
}

/** Highest milestone crossed by `hitCount` that is above `lastPosted`. */
export function hitMilestoneForCount(hitCount: number, lastPosted: number): number | null {
  if (!Number.isFinite(hitCount) || hitCount < 1) return null;
  let best: number | null = null;
  for (const m of HELIX_STACK_MILESTONES) {
    if (hitCount >= m && m > lastPosted) best = m;
  }
  return best;
}

export function shouldPostHelixRepeatLive(hitCount: number, lastPosted: number): boolean {
  return hitMilestoneForCount(hitCount, lastPosted) != null;
}

type MilestoneState = { lastPosted: number; hitCount: number };

function milestoneKey(contractKey: string): string {
  return `helix-discord-milestone:${contractKey}`;
}

/**
 * Resolve repeat-hit count and whether this print should post live.
 * Non-repeat flows always return `post: true`.
 */
export async function resolveHelixMilestoneGate(
  flow: HelixDiscordFlowInput,
  hitCountHint?: number
): Promise<{ post: boolean; hitCount: number; milestone: number | null }> {
  if (!isHelixRepeatFlow(flow)) {
    return { post: true, hitCount: hitCountHint ?? 1, milestone: null };
  }

  const contract = helixContractKey(flow);
  const key = milestoneKey(contract);
  const prev = (await sharedCacheGet<MilestoneState>(key)) ?? { lastPosted: 0, hitCount: 0 };
  const hitCount = Math.max(hitCountHint ?? 0, prev.hitCount + 1, flow.stack_hits?.length ?? 0);
  const milestone = hitMilestoneForCount(hitCount, prev.lastPosted);
  const post = milestone != null;

  if (post && milestone != null) {
    await sharedCacheSet(
      key,
      { lastPosted: milestone, hitCount },
      MILESTONE_TTL_SEC
    );
  } else {
    await sharedCacheSet(key, { lastPosted: prev.lastPosted, hitCount }, MILESTONE_TTL_SEC);
  }

  return { post, hitCount, milestone };
}
