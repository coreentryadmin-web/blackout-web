import { runEngagementSweep, type EngageStats } from "@/lib/x-engage-engine";
import {
  runMentionReplySweep,
  type MentionReplyStats,
} from "@/lib/x-mention-replies";

export interface GrowthStats {
  engage: EngageStats;
  mentions: MentionReplyStats;
}

/** Full growth pass: max likes/follows/RTs/@mentions + reply to everyone who @mentions us. */
export async function runGrowthSweep(opts: {
  dryRun?: boolean;
}): Promise<GrowthStats> {
  const engage = await runEngagementSweep(opts);
  const mentions = await runMentionReplySweep(opts);
  return { engage, mentions };
}
