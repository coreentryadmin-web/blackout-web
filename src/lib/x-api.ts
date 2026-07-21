import * as crypto from "node:crypto";

const X_TWEET_URL = "https://api.x.com/2/tweets";
const X_MEDIA_UPLOAD_URL =
  "https://upload.twitter.com/1.1/media/upload.json";

function getCredentials() {
  const ck = process.env.X_API_KEY?.trim();
  const cs = process.env.X_API_KEY_SECRET?.trim();
  const at = process.env.X_ACCESS_TOKEN?.trim();
  const ats = process.env.X_ACCESS_TOKEN_SECRET?.trim();
  if (!ck || !cs || !at || !ats) return null;
  return {
    consumerKey: ck,
    consumerSecret: cs,
    accessToken: at,
    accessTokenSecret: ats,
  };
}

export function xApiEnabled(): boolean {
  return getCredentials() !== null;
}

/** @BlackOutTrade account user id (OAuth context). */
export const X_ACCOUNT_USER_ID = "2055511397338087425";

/** Never amplify other brand accounts on @BlackOutTrade. */
export const X_BLOCK_RT_USERNAMES = new Set(["IHate0dte", "ihate0dte"]);

function pctEnc(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function oauthHeader(
  method: string,
  url: string,
  extraParams: Record<string, string> = {},
): string {
  const creds = getCredentials();
  if (!creds) throw new Error("X API credentials not configured");

  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: ts,
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  const all = { ...oauthParams, ...extraParams };
  const paramStr = Object.keys(all)
    .sort()
    .map((k) => `${pctEnc(k)}=${pctEnc(all[k])}`)
    .join("&");

  const baseStr = `${method}&${pctEnc(url)}&${pctEnc(paramStr)}`;
  const sigKey = `${pctEnc(creds.consumerSecret)}&${pctEnc(creds.accessTokenSecret)}`;
  const sig = crypto
    .createHmac("sha1", sigKey) // lgtm[js/insufficient-password-hash]
    .update(baseStr)
    .digest("base64");

  oauthParams.oauth_signature = sig;
  return (
    "OAuth " +
    Object.keys(oauthParams)
      .sort()
      .map((k) => `${pctEnc(k)}="${pctEnc(oauthParams[k])}"`)
      .join(", ")
  );
}

async function oauthFetch(
  method: string,
  url: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  const u = new URL(url);
  const base = `${u.origin}${u.pathname}`;
  const queryParams: Record<string, string> = {};
  u.searchParams.forEach((v, k) => {
    queryParams[k] = v;
  });
  const auth = oauthHeader(
    method,
    base,
    method === "GET" ? queryParams : {},
  );
  const headers: Record<string, string> = { Authorization: auth };
  let init: RequestInit = { method, headers };
  if (body) {
    headers["Content-Type"] = "application/json";
    init = { ...init, headers, body: JSON.stringify(body) };
  }
  return fetch(url, init);
}

// ---------------------------------------------------------------------------
// Media upload (v1.1 simple upload — images up to 5 MB)
// ---------------------------------------------------------------------------

export async function uploadMedia(
  imageBuffer: Buffer,
  mimeType: string = "image/png",
): Promise<string> {
  const b64 = imageBuffer.toString("base64");
  const params: Record<string, string> = {
    media_data: b64,
    media_category: "tweet_image",
  };

  const auth = oauthHeader("POST", X_MEDIA_UPLOAD_URL, params);
  const body = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const res = await fetch(X_MEDIA_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`X media upload failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { media_id_string: string };
  return json.media_id_string;
}

// ---------------------------------------------------------------------------
// Post a tweet (v2)
// ---------------------------------------------------------------------------

export interface TweetResult {
  id: string;
  text: string;
}

import { isTimelinePostAllowed } from "@/lib/x-feed-policy";

export async function postTweet(
  text: string,
  mediaIds?: string[],
): Promise<TweetResult> {
  if (!isTimelinePostAllowed(text)) {
    throw new Error(
      "Timeline post rejected: do not @tag other accounts on @BlackOutTrade profile",
    );
  }
  const payload: Record<string, unknown> = { text };
  if (mediaIds?.length) {
    payload.media = { media_ids: mediaIds };
  }

  const auth = oauthHeader("POST", X_TWEET_URL);
  const res = await fetch(X_TWEET_URL, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    if (res.status === 429) {
      throw new Error(`X post tweet rate limited (429): ${errText.slice(0, 120)}`);
    }
    throw new Error(`X post tweet failed (${res.status}): ${errText}`);
  }

  const json = (await res.json()) as { data: TweetResult };
  return json.data;
}

export async function deleteTweet(id: string): Promise<boolean> {
  const url = `${X_TWEET_URL}/${id}`;
  const auth = oauthHeader("DELETE", url);
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: auth },
  });
  return res.ok;
}

export async function tweetWithImage(
  text: string,
  imageBuffer: Buffer,
  mimeType?: string,
): Promise<TweetResult> {
  const mediaId = await uploadMedia(imageBuffer, mimeType);
  return postTweet(text, [mediaId]);
}

// ---------------------------------------------------------------------------
// Threads / replies
// ---------------------------------------------------------------------------

export async function postReply(
  text: string,
  inReplyToTweetId: string,
  mediaIds?: string[],
): Promise<TweetResult> {
  const payload: Record<string, unknown> = {
    text,
    reply: { in_reply_to_tweet_id: inReplyToTweetId },
  };
  if (mediaIds?.length) payload.media = { media_ids: mediaIds };

  const auth = oauthHeader("POST", X_TWEET_URL);
  const res = await fetch(X_TWEET_URL, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text();
    if (res.status === 429) {
      throw new Error(`X post reply rate limited (429): ${err.slice(0, 120)}`);
    }
    throw new Error(`X post reply failed (${res.status}): ${err}`);
  }
  const json = (await res.json()) as { data: TweetResult };
  return json.data;
}

/** Quote-post — Enterprise API only on self-serve pay-per-use. */
export async function postQuoteTweet(
  text: string,
  quotedTweetId: string,
): Promise<TweetResult> {
  if (!isTimelinePostAllowed(text)) {
    throw new Error(
      "Quote tweet rejected: do not @tag other accounts on @BlackOutTrade profile",
    );
  }
  const payload: Record<string, unknown> = {
    text,
    quote_tweet_id: quotedTweetId,
  };

  const auth = oauthHeader("POST", X_TWEET_URL);
  const res = await fetch(X_TWEET_URL, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text();
    if (res.status === 429) {
      throw new Error(`X quote tweet rate limited (429): ${err.slice(0, 120)}`);
    }
    throw new Error(`X quote tweet failed (${res.status}): ${err}`);
  }
  const json = (await res.json()) as { data: TweetResult };
  return json.data;
}

export async function postThread(texts: string[]): Promise<TweetResult[]> {
  const out: TweetResult[] = [];
  let parentId: string | undefined;
  for (const text of texts) {
    const tweet = parentId
      ? await postReply(text, parentId)
      : await postTweet(text);
    out.push(tweet);
    parentId = tweet.id;
    await new Promise((r) => setTimeout(r, 1200));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Engagement — likes, RTs, follows
// ---------------------------------------------------------------------------

export type XActionResult = "ok" | "rate_limited" | "failed" | "already_following";

export type LikeResult = XActionResult;

export async function likeTweet(tweetId: string): Promise<LikeResult> {
  const url = `https://api.x.com/2/users/${X_ACCOUNT_USER_ID}/likes`;
  const res = await oauthFetch("POST", url, { tweet_id: tweetId });
  if (res.ok) return "ok";
  if (res.status === 429) return "rate_limited";
  return "failed";
}

export async function retweet(tweetId: string): Promise<XActionResult> {
  const url = `https://api.x.com/2/users/${X_ACCOUNT_USER_ID}/retweets`;
  const res = await oauthFetch("POST", url, { tweet_id: tweetId });
  if (res.ok) return "ok";
  if (res.status === 429) return "rate_limited";
  return "failed";
}

export async function followUser(targetUserId: string): Promise<XActionResult> {
  const url = `https://api.x.com/2/users/${X_ACCOUNT_USER_ID}/following`;
  const res = await oauthFetch("POST", url, { target_user_id: targetUserId });
  if (res.ok) return "ok";
  if (res.status === 429) return "rate_limited";
  const body = await res.text();
  if (
    res.status === 403 ||
    res.status === 409 ||
    /already/i.test(body) ||
    /duplicate/i.test(body)
  ) {
    return "already_following";
  }
  return "failed";
}

export interface XUser {
  id: string;
  username: string;
  name?: string;
}

export async function lookupUserByUsername(
  username: string,
): Promise<XUser | null> {
  const handle = username.replace(/^@/, "");
  const url = `https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}?user.fields=username,name`;
  const res = await oauthFetch("GET", url);
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: XUser };
  return json.data ?? null;
}

export interface XTweet {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  public_metrics?: {
    impression_count?: number;
    like_count?: number;
    reply_count?: number;
    retweet_count?: number;
  };
}

export interface XTweetSearchHit extends XTweet {
  author_username?: string;
}

export async function fetchUserTweets(
  userId: string,
  maxResults = 5,
): Promise<XTweet[]> {
  const params = new URLSearchParams({
    max_results: String(Math.min(Math.max(maxResults, 5), 100)),
    exclude: "retweets,replies",
    "tweet.fields": "author_id,created_at,public_metrics",
  });
  const url = `https://api.x.com/2/users/${userId}/tweets?${params}`;
  const res = await oauthFetch("GET", url);
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: XTweet[] };
  return json.data ?? [];
}

/** Recent search — discovery for engagement (requires X API search access). */
export async function searchRecentTweets(
  query: string,
  maxResults = 10,
): Promise<XTweetSearchHit[]> {
  const params = new URLSearchParams({
    query,
    max_results: String(Math.min(Math.max(maxResults, 10), 100)),
    "tweet.fields": "author_id,created_at,public_metrics",
    expansions: "author_id",
    "user.fields": "username",
  });
  const url = `https://api.x.com/2/tweets/search/recent?${params}`;
  const res = await oauthFetch("GET", url);
  if (!res.ok) return [];

  const json = (await res.json()) as {
    data?: XTweet[];
    includes?: { users?: XUser[] };
  };
  const users = new Map(
    (json.includes?.users ?? []).map((u) => [u.id, u.username]),
  );
  return (json.data ?? []).map((t) => ({
    ...t,
    author_username: t.author_id ? users.get(t.author_id) : undefined,
  }));
}

/** Recent @mentions of @BlackOutTrade with author usernames resolved. */
export interface XMention extends XTweet {
  author_username: string;
  author_id: string;
}

export async function fetchMentions(maxResults = 10): Promise<XMention[]> {
  const params = new URLSearchParams({
    max_results: String(Math.min(Math.max(maxResults, 5), 100)),
    "tweet.fields": "author_id,created_at,in_reply_to_user_id",
    expansions: "author_id",
    "user.fields": "username",
  });
  const url = `https://api.x.com/2/users/${X_ACCOUNT_USER_ID}/mentions?${params}`;
  const res = await oauthFetch("GET", url);
  if (!res.ok) return [];

  const json = (await res.json()) as {
    data?: XTweet[];
    includes?: { users?: XUser[] };
  };
  const users = new Map(
    (json.includes?.users ?? []).map((u) => [u.id, u.username]),
  );
  return (json.data ?? [])
    .map((t) => {
      const authorId = t.author_id ?? "";
      const username = users.get(authorId);
      if (!username) return null;
      return {
        ...t,
        author_id: authorId,
        author_username: username,
      };
    })
    .filter((m): m is XMention => m !== null);
}

/** Original tweets posted by @BlackOutTrade today (ET calendar day). */
export async function countOwnPostsTodayEt(): Promise<number> {
  const tweets = await fetchUserTweets(X_ACCOUNT_USER_ID, 20);
  const todayEt = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
  return tweets.filter((t) => {
    if (!t.created_at) return false;
    const d = new Date(t.created_at).toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    });
    return d === todayEt;
  }).length;
}

/** Minutes since the most recent original tweet from @BlackOutTrade. */
export async function minutesSinceLastOwnPost(): Promise<number | null> {
  const tweets = await fetchUserTweets(X_ACCOUNT_USER_ID, 5);
  const latest = tweets.find((t) => t.created_at)?.created_at;
  if (!latest) return null;
  return (Date.now() - new Date(latest).getTime()) / 60_000;
}

export interface XAccountMetrics {
  followers: number;
  following: number;
  tweet_count: number;
}

export interface XOwnProfile {
  id: string;
  username: string;
  name?: string;
  description?: string;
  url?: string;
  pinned_tweet_id?: string;
  public_metrics?: XAccountMetrics;
}

/** @BlackOutTrade public metrics for growth tracking. */
export async function fetchOwnAccountMetrics(): Promise<XAccountMetrics | null> {
  const params = new URLSearchParams({
    "user.fields": "public_metrics",
  });
  const url = `https://api.x.com/2/users/${X_ACCOUNT_USER_ID}?${params}`;
  const res = await oauthFetch("GET", url);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    data?: { public_metrics?: Record<string, number> };
  };
  const m = json.data?.public_metrics;
  if (!m) return null;
  return {
    followers: m.followers_count ?? 0,
    following: m.following_count ?? 0,
    tweet_count: m.tweet_count ?? 0,
  };
}

const X_ACCOUNT_UPDATE_URL =
  "https://api.twitter.com/1.1/account/update_profile.json";

/** Update @BlackOutTrade bio / website (v1.1 — OAuth user context). */
export async function updateAccountProfile(opts: {
  description?: string;
  url?: string;
  name?: string;
  location?: string;
}): Promise<boolean> {
  const params: Record<string, string> = {};
  if (opts.description !== undefined) params.description = opts.description;
  if (opts.url !== undefined) params.url = opts.url;
  if (opts.name !== undefined) params.name = opts.name;
  if (opts.location !== undefined) params.location = opts.location;
  if (!Object.keys(params).length) return false;

  const auth = oauthHeader("POST", X_ACCOUNT_UPDATE_URL, params);
  const body = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const res = await fetch(X_ACCOUNT_UPDATE_URL, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`X profile update failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return true;
}

/** Current @BlackOutTrade profile fields for growth ops. */
export async function fetchOwnProfile(): Promise<XOwnProfile | null> {
  const params = new URLSearchParams({
    "user.fields":
      "username,name,description,url,pinned_tweet_id,public_metrics",
  });
  const url = `https://api.x.com/2/users/${X_ACCOUNT_USER_ID}?${params}`;
  const res = await oauthFetch("GET", url);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    data?: {
      id: string;
      username: string;
      name?: string;
      description?: string;
      url?: string;
      pinned_tweet_id?: string;
      public_metrics?: Record<string, number>;
    };
  };
  const d = json.data;
  if (!d) return null;
  const m = d.public_metrics;
  return {
    id: d.id,
    username: d.username,
    name: d.name,
    description: d.description,
    url: d.url,
    pinned_tweet_id: d.pinned_tweet_id,
    public_metrics: m
      ? {
          followers: m.followers_count ?? 0,
          following: m.following_count ?? 0,
          tweet_count: m.tweet_count ?? 0,
        }
      : undefined,
  };
}

/** @mention outreach posts today (legacy counter — outreach removed from timeline). */
export async function countOwnMentionPostsTodayEt(): Promise<number> {
  const tweets = await fetchUserTweets(X_ACCOUNT_USER_ID, 40);
  const todayEt = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
  return tweets.filter((t) => {
    if (!t.created_at || !t.text?.trim().startsWith("@")) return false;
    const d = new Date(t.created_at).toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    });
    return d === todayEt;
  }).length;
}
