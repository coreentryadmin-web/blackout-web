/**
 * TIKTOK CONTENT POSTING — photo posts of a rendered card.
 *
 * SHAPED DELIBERATELY LIKE `x-api.ts`, because the posting pipeline already exists and this is a
 * new destination for it, not a new pipeline. `/api/cron/x-autopost` renders a card to a PNG
 * Buffer and hands it to `tweetWithImage`; this module accepts the SAME Buffer so the fan-out is a
 * second call rather than a second pipeline.
 *
 * WHY THIS IS THE EASIER OF THE TWO PLATFORMS. TikTok accepts raw bytes (`FILE_UPLOAD`).
 * Instagram's Graph API does not — it fetches `image_url` itself, so the card has to be reachable
 * on a public URL first. That difference is the whole reason TikTok ships before Instagram.
 *
 * ── TWO PUBLISH MODES, AND THE DEFAULT IS THE CAUTIOUS ONE ────────────────────────────────────
 *
 * `inbox`  — the post lands in the creator's TikTok drafts and a human hits publish.
 * `direct` — the post goes live immediately.
 *
 * `inbox` is the default for two independent reasons, either sufficient on its own:
 *   1. Direct Post requires TikTok to AUDIT the app. Before that audit an unaudited app can only
 *      post private/self-only content, so `direct` would silently produce posts nobody can see.
 *   2. Nothing should go out unattended while the copy generation is still being tuned. A draft
 *      that a human approves cannot embarrass the brand; a live post can.
 * Promote to `direct` by setting TIKTOK_PUBLISH_MODE=direct once the audit clears.
 *
 * ── CREATOR INFO IS NOT OPTIONAL ──────────────────────────────────────────────────────────────
 *
 * TikTok requires `creator_info/query` BEFORE any direct post, and rejects a publish whose privacy
 * level is not one the creator actually allows. Guessing `PUBLIC_TO_EVERYONE` on an account that
 * disallows it is a rejected post, so the allowed set is read and honoured rather than assumed.
 *
 * ── FAILS CLOSED, AND SILENTLY ABSENT ─────────────────────────────────────────────────────────
 *
 * `tiktokEnabled()` mirrors `xApiEnabled()`: no credentials means the caller SKIPS this
 * destination, not that the run errors. That is what lets this ship dark — merged, deployed and
 * inert — before any TikTok account or app review exists.
 */

const TIKTOK_API = "https://open.tiktokapis.com/v2";

/** Token lifetime is ~24h; refresh tokens last ~365d. Both come from the OAuth grant. */
function getCredentials(): { accessToken: string } | null {
  const token = process.env.TIKTOK_ACCESS_TOKEN?.trim();
  if (!token) return null;
  return { accessToken: token };
}

export function tiktokEnabled(): boolean {
  return getCredentials() !== null;
}

export type TikTokPublishMode = "inbox" | "direct";

/** `inbox` unless explicitly promoted — see the header on why the cautious default is load-bearing. */
export function tiktokPublishMode(): TikTokPublishMode {
  return process.env.TIKTOK_PUBLISH_MODE?.trim() === "direct" ? "direct" : "inbox";
}

export type TikTokPrivacy =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"
  | "SELF_ONLY";

export type TikTokCreatorInfo = {
  nickname: string | null;
  /** The ONLY privacy levels this creator permits. Publishing outside this set is rejected. */
  privacyOptions: TikTokPrivacy[];
  maxVideoPostDurationSec: number | null;
};

export type TikTokPostResult = {
  publishId: string;
  mode: TikTokPublishMode;
  privacy: TikTokPrivacy | null;
};

async function tiktokFetch(path: string, body: unknown): Promise<Response> {
  const creds = getCredentials();
  if (!creds) throw new Error("TikTok credentials not configured");
  return fetch(`${TIKTOK_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });
}

/**
 * What this creator actually allows. Required before a direct post; also the honest way to pick a
 * privacy level rather than assuming the account is public.
 */
export async function fetchCreatorInfo(): Promise<TikTokCreatorInfo> {
  const res = await tiktokFetch("/post/publish/creator_info/query/", {});
  const json = (await res.json().catch(() => ({}))) as {
    data?: {
      creator_nickname?: string;
      privacy_level_options?: string[];
      max_video_post_duration_sec?: number;
    };
    error?: { code?: string; message?: string };
  };
  if (!res.ok || (json.error?.code && json.error.code !== "ok")) {
    throw new Error(`TikTok creator_info failed (${res.status}): ${json.error?.message ?? "unknown"}`);
  }
  return {
    nickname: json.data?.creator_nickname ?? null,
    privacyOptions: (json.data?.privacy_level_options ?? []) as TikTokPrivacy[],
    maxVideoPostDurationSec: json.data?.max_video_post_duration_sec ?? null,
  };
}

/**
 * Choose the privacy level to publish under.
 *
 * PREFERS THE NARROWEST SENSIBLE LEVEL THE CREATOR ALLOWS rather than the widest. An automated
 * poster that defaults to the most public option available is one misconfiguration away from
 * broadcasting something unintended, and the caller can always ask for wider explicitly.
 *
 * Returns null when the creator allows nothing we can post under — the caller must then SKIP
 * rather than fall back to a level TikTok would reject anyway.
 */
export function pickPrivacy(allowed: readonly TikTokPrivacy[], want?: TikTokPrivacy): TikTokPrivacy | null {
  if (want && allowed.includes(want)) return want;
  if (want) return null; // an explicit ask the creator forbids is a skip, never a silent downgrade
  for (const level of ["SELF_ONLY", "FOLLOWER_OF_CREATOR", "MUTUAL_FOLLOW_FRIENDS", "PUBLIC_TO_EVERYONE"] as const) {
    if (allowed.includes(level)) return level;
  }
  return null;
}

/**
 * Post a rendered card as a TikTok photo.
 *
 * `imageUrls` rather than raw bytes at THIS call: TikTok's photo endpoint takes
 * `PULL_FROM_URL` for images (unlike video, which supports FILE_UPLOAD), so the card must be
 * reachable. That is the same public-URL requirement Instagram has, which means the signed
 * card route serves BOTH platforms and is worth building once.
 *
 * The domain must be verified in the TikTok developer console before PULL_FROM_URL is accepted.
 */
export async function postPhoto(params: {
  title: string;
  description?: string;
  imageUrls: string[];
  privacy?: TikTokPrivacy;
  mode?: TikTokPublishMode;
}): Promise<TikTokPostResult> {
  if (!params.imageUrls.length) throw new Error("TikTok photo post requires at least one image URL");
  const mode = params.mode ?? tiktokPublishMode();

  let privacy: TikTokPrivacy | null = null;
  if (mode === "direct") {
    const info = await fetchCreatorInfo();
    privacy = pickPrivacy(info.privacyOptions, params.privacy);
    if (!privacy) {
      throw new Error(
        `TikTok creator allows none of the requested privacy levels (allowed: ${info.privacyOptions.join(",") || "none"})`
      );
    }
  }

  const endpoint = mode === "direct" ? "/post/publish/content/init/" : "/post/publish/inbox/content/init/";
  const body: Record<string, unknown> = {
    media_type: "PHOTO",
    post_mode: mode === "direct" ? "DIRECT_POST" : "MEDIA_UPLOAD",
    source_info: {
      source: "PULL_FROM_URL",
      photo_cover_index: 0,
      photo_images: params.imageUrls,
    },
  };
  if (mode === "direct") {
    body.post_info = {
      title: params.title,
      description: params.description ?? params.title,
      privacy_level: privacy,
      disable_comment: false,
      auto_add_music: false,
    };
  }

  const res = await tiktokFetch(endpoint, body);
  const json = (await res.json().catch(() => ({}))) as {
    data?: { publish_id?: string };
    error?: { code?: string; message?: string };
  };
  if (!res.ok || !json.data?.publish_id) {
    throw new Error(`TikTok publish failed (${res.status}): ${json.error?.message ?? "no publish_id"}`);
  }
  return { publishId: json.data.publish_id, mode, privacy };
}

export type TikTokStatus = "PROCESSING" | "PUBLISH_COMPLETE" | "FAILED" | "UNKNOWN";

/**
 * Publishing is ASYNCHRONOUS — `publish_id` is a receipt, not a confirmation. A caller that logs
 * the id and calls it done will report success for posts TikTok later rejected.
 */
export async function fetchPublishStatus(publishId: string): Promise<{ status: TikTokStatus; reason: string | null }> {
  const res = await tiktokFetch("/post/publish/status/fetch/", { publish_id: publishId });
  const json = (await res.json().catch(() => ({}))) as {
    data?: { status?: string; fail_reason?: string };
    error?: { message?: string };
  };
  if (!res.ok) return { status: "UNKNOWN", reason: json.error?.message ?? `http ${res.status}` };
  const raw = json.data?.status ?? "";
  const status: TikTokStatus =
    raw === "PUBLISH_COMPLETE" ? "PUBLISH_COMPLETE" : raw === "FAILED" ? "FAILED" : raw ? "PROCESSING" : "UNKNOWN";
  return { status, reason: json.data?.fail_reason ?? null };
}
