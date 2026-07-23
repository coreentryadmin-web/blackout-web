import { getWhopClient } from "@/lib/whop";
import type { ForumPostVisibilityType } from "@whop/sdk/resources/forum-posts.js";
import type { ForumPost } from "@whop/sdk/resources/shared.js";

export type WhopPostVisibility = "public" | "members_only";

export type WhopPostOptions = {
  title?: string;
  content: string;
  visibility: WhopPostVisibility;
  pinned?: boolean;
  /** Markdown is default; pass rich_content for Tiptap JSON. */
  richContent?: string;
};

export type WhopPostResult = {
  ok: boolean;
  postId?: string;
  error?: string;
};

function resolveVisibility(v: WhopPostVisibility): ForumPostVisibilityType {
  return v === "public" ? "globally_visible" : "members_only";
}

/**
 * Post to the Whop forum. Public posts go to the company's public forum
 * (visible to anyone on Whop); members-only posts go to the configured
 * experience (visible only to subscribers).
 */
export async function postToWhopForum(
  opts: WhopPostOptions,
): Promise<WhopPostResult> {
  const whop = getWhopClient();
  const companyId = process.env.WHOP_COMPANY_ID;
  const experienceId = process.env.WHOP_EXPERIENCE_ID;

  if (!companyId) {
    return { ok: false, error: "Missing WHOP_COMPANY_ID" };
  }

  const visibility = resolveVisibility(opts.visibility);

  const params: Parameters<typeof whop.forumPosts.create>[0] =
    opts.visibility === "public"
      ? {
          experience_id: "public",
          company_id: companyId,
          content: opts.content,
          title: opts.title ?? null,
          visibility,
          pinned: opts.pinned ?? false,
        }
      : {
          experience_id: experienceId ?? "public",
          company_id: experienceId ? undefined : companyId,
          content: opts.content,
          title: opts.title ?? null,
          visibility,
          pinned: opts.pinned ?? false,
        };

  if (opts.richContent) {
    params.rich_content = opts.richContent;
  }

  let post: ForumPost;
  try {
    post = await whop.forumPosts.create(params);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[whop-posting] create failed:", message);
    return { ok: false, error: message };
  }

  return { ok: true, postId: post.id };
}
