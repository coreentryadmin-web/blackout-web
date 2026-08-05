/**
 * HELIX repeat-hit milestone gate — ping at 3rd / 5th / 10th contract hit, not every repeat.
 */
import type { HelixDiscordFlowInput } from "@/lib/helix-discord-format";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";

export const HELIX_STACK_MILESTONES = [3, 5, 10] as const;

const MILESTONE_TTL_SEC = 8 * 60 * 60;

export function helixContractKey(flow: HelixDiscordFlowInput): string {
  const side = String(flow.option_type || "").toUpperCase().startsWith("C") ? "C" : "P";
  return `${String(flow.ticker).toUpperCase()}|${Math.round(Number(flow.strike))}|${String(flow.expiry).slice(0, 10)}|${side}`;
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
