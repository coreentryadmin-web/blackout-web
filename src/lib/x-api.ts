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
    .createHmac("sha1", sigKey)
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

  // OAuth signature for form-encoded body includes all params
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

export async function postTweet(
  text: string,
  mediaIds?: string[],
): Promise<TweetResult> {
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
    const text = await res.text();
    throw new Error(`X post tweet failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { data: TweetResult };
  return json.data;
}

// ---------------------------------------------------------------------------
// Delete a tweet (v2)
// ---------------------------------------------------------------------------

export async function deleteTweet(id: string): Promise<boolean> {
  const url = `${X_TWEET_URL}/${id}`;
  const auth = oauthHeader("DELETE", url);
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: auth },
  });
  return res.ok;
}

// ---------------------------------------------------------------------------
// Tweet with image convenience wrapper
// ---------------------------------------------------------------------------

export async function tweetWithImage(
  text: string,
  imageBuffer: Buffer,
  mimeType?: string,
): Promise<TweetResult> {
  const mediaId = await uploadMedia(imageBuffer, mimeType);
  return postTweet(text, [mediaId]);
}
