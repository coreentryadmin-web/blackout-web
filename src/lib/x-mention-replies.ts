import { fetchMentions, postReply } from "@/lib/x-api";
import { pickMentionReply } from "@/lib/x-engage-replies";
import { anthropicText } from "@/lib/providers/anthropic";
import {
  getRepliedTweetIds,
  markTweetReplied,
} from "@/lib/x-marketing-meta";
import {
  resolveRunBudget,
  recordBudgetUse,
  pauseForRateLimit,
  engagementJitterMs,
} from "@/lib/x-rate-budget";
import type { MarketSnapshot } from "@/lib/x-content";

export interface MentionReplyStats {
  replied: number;
  scanned: number;
  skipped: number;
  errors: string[];
  skippedReason?: string;
}

const REPLY_SYSTEM = `You reply as @BlackOutTrade — a sharp SPX/0DTE options desk.
- Warm, human, specific — one short paragraph max
- Reference gamma/flip/flow/dealer positioning when relevant
- End with ONE question to keep the thread going
- NO Whop link, NO hashtags, NO @tagging other accounts besides the person you're replying to
- Under 240 characters`;

async function craftMentionReply(
  username: string,
  mentionText: string,
  snapshot?: MarketSnapshot,
): Promise<string> {
  const handle = `@${username.replace(/^@/, "")}`;
  const levels =
    snapshot?.spxPrice != null
      ? `Live desk: SPX $${Math.round(snapshot.spxPrice)}, flip ${snapshot.flipLevel ?? "n/a"}.`
      : "";

  try {
    const raw = await anthropicText(
      `${levels}\nThey wrote: ${mentionText}\n\nReply to ${handle}:`,
      280,
      REPLY_SYSTEM,
      { model: "claude-haiku-4-5", aiGate: "global", temperature: 0.82 },
    );
    const text = raw?.trim().replace(/^["']|["']$/g, "");
    if (text && text.length >= 20 && text.length <= 260) {
      return text.startsWith("@") ? text : `${handle} ${text}`;
    }
  } catch {
    /* template fallback */
  }
  return pickMentionReply(username, mentionText);
}

/** Reply to @mentions — deduped, budgeted, human voice when AI available. */
export async function runMentionReplySweep(opts: {
  dryRun?: boolean;
  maxReplies?: number;
  cronMode?: boolean;
  marketSnapshot?: MarketSnapshot;
}): Promise<MentionReplyStats> {
  const dryRun = opts.dryRun === true;
  const cronMode = opts.cronMode !== false;
  const budget = await resolveRunBudget({ cronMode });
  const maxReplies = Math.min(
    opts.maxReplies ?? budget.replies,
    budget.replies,
  );

  const stats: MentionReplyStats = {
    replied: 0,
    scanned: 0,
    skipped: 0,
    errors: [],
  };

  if (!budget.allowed || maxReplies <= 0) {
    stats.skippedReason = budget.reason ?? "reply budget exhausted";
    return stats;
  }

  const replied = await getRepliedTweetIds();
  const mentions = await fetchMentions(15);

  for (const m of mentions) {
    if (stats.replied >= maxReplies) break;
    stats.scanned += 1;
    const username = m.author_username;
    if (!username || username.toLowerCase() === "blackouttrade") continue;
    if (replied.has(m.id)) {
      stats.skipped += 1;
      continue;
    }

    const text = await craftMentionReply(
      username,
      m.text ?? "",
      opts.marketSnapshot,
    );

    if (!dryRun) {
      try {
        await postReply(text.slice(0, 280), m.id);
        await markTweetReplied(m.id);
        await recordBudgetUse("replies");
        stats.replied += 1;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "reply failed";
        stats.errors.push(msg);
        if (msg.includes("429") || msg.includes("rate limited")) {
          await pauseForRateLimit();
          break;
        }
      }
    } else {
      stats.replied += 1;
    }
    await new Promise((r) => setTimeout(r, engagementJitterMs()));
  }

  return stats;
}
