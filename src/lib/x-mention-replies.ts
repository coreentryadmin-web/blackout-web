import { fetchMentions, postReply } from "@/lib/x-api";
import { pickMentionReply } from "@/lib/x-engage-replies";
import { ENGAGE_LIMITS } from "@/lib/x-engage-config";

export interface MentionReplyStats {
  replied: number;
  scanned: number;
  errors: string[];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Reply to everyone @mentioning @BlackOutTrade — converts engagers to followers. */
export async function runMentionReplySweep(opts: {
  dryRun?: boolean;
  maxReplies?: number;
}): Promise<MentionReplyStats> {
  const dryRun = opts.dryRun === true;
  const maxReplies = opts.maxReplies ?? ENGAGE_LIMITS.mentionReplies;
  const stats: MentionReplyStats = { replied: 0, scanned: 0, errors: [] };

  const mentions = await fetchMentions(30);
  for (const m of mentions) {
    stats.scanned += 1;
    const username = m.author_username;
    if (!username || username.toLowerCase() === "blackouttrade") continue;

    const text = pickMentionReply(username, m.text).slice(0, 280);

    if (!dryRun) {
      try {
        await postReply(text, m.id);
        stats.replied += 1;
      } catch (e) {
        stats.errors.push(e instanceof Error ? e.message : "reply failed");
      }
    } else {
      stats.replied += 1;
    }
    await sleep(ENGAGE_LIMITS.delayMs);
    if (stats.replied >= maxReplies) break;
  }

  return stats;
}
