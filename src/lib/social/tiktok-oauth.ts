import { randomBytes, timingSafeEqual } from "node:crypto";
import { dbQuery, dbConfigured, ensureSchema } from "@/lib/db";

/**
 * TIKTOK OAUTH — the authorisation grant, and keeping the token alive afterwards.
 *
 * WHY THIS EXISTS SEPARATELY FROM `tiktok-api.ts`. That module posts; this one is the only thing
 * that knows how a token is obtained, stored and renewed. Keeping them apart means the transport
 * never reads `process.env` for a credential that changes underneath it — it asks for the current
 * token and gets one that is valid, or an error saying re-authorisation is required.
 *
 * THE PROBLEM THIS SOLVES, stated plainly. A TikTok access token lives ~24 hours. The refresh
 * token that mints the next one lives ~365 days AND IS REPLACED on every refresh. The first cut of
 * `tiktok-api.ts` read `TIKTOK_ACCESS_TOKEN` from the environment, which works for a manual test
 * and then fails silently the following day — an env var cannot be rewritten by the process that
 * learns the new value. That is the same class of defect as everything else fixed in this session:
 * a real capability whose path to the layer that needs it is broken.
 *
 * FAILS CLOSED AND LOUD. Every function returns null or throws with a reason rather than falling
 * back to a stale token. A scheduled post that quietly used an expired credential would report
 * success and publish nothing.
 */

const TIKTOK_AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";

/**
 * `video.publish` is requested even though the first release posts to DRAFTS.
 *
 * The scope set is fixed at consent time. Asking only for `video.upload` now would mean a SECOND
 * consent round-trip the day the audit clears — and TikTok's consent screen is a place you want to
 * send an operator once. Requesting it does not enable Direct Post; `TIKTOK_PUBLISH_MODE` still
 * gates that, and the audit gates it upstream of us.
 */
export const TIKTOK_SCOPES = ["user.info.basic", "video.upload", "video.publish"] as const;

function clientCreds(): { key: string; secret: string } | null {
  const key = process.env.TIKTOK_CLIENT_KEY?.trim();
  const secret = process.env.TIKTOK_CLIENT_SECRET?.trim();
  if (!key || !secret) return null;
  return { key, secret };
}

export function tiktokOauthConfigured(): boolean {
  return clientCreds() !== null;
}

/** Where TikTok sends the operator back. Must match the console registration EXACTLY. */
export function tiktokRedirectUri(): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://blackouttrades.com";
  return `${base.replace(/\/$/, "")}/api/social/tiktok/callback`;
}

/**
 * The consent URL an operator visits once.
 *
 * `state` is the CSRF guard — TikTok echoes it back and the callback rejects a mismatch. Without
 * it, anyone could hand our callback a code from a different authorisation and bind THEIR TikTok
 * account to our credential row.
 */
export function tiktokAuthorizeUrl(state: string): string | null {
  const creds = clientCreds();
  if (!creds) return null;
  const q = new URLSearchParams({
    client_key: creds.key,
    scope: TIKTOK_SCOPES.join(","),
    response_type: "code",
    redirect_uri: tiktokRedirectUri(),
    state,
  });
  return `${TIKTOK_AUTH_URL}?${q.toString()}`;
}

/** The cookie the connect route writes and the callback route reads back. */
export const TIKTOK_STATE_COOKIE = "tt_oauth_state";

/** 10 minutes — long enough to read a consent screen, short enough that a stale tab cannot replay. */
export const TIKTOK_STATE_TTL_S = 10 * 60;

export function newOauthState(): string {
  return randomBytes(24).toString("hex");
}

/**
 * Constant-time state comparison.
 *
 * The state is the ONLY thing standing between our credential row and a login-CSRF: without it an
 * attacker sends the operator a callback URL carrying a code from THEIR TikTok account, and we
 * store their token as ours and start publishing the desk's cards to a stranger's feed. Compared
 * in constant time for the same reason every other token here is — a length/prefix oracle on a
 * 10-minute secret is still an oracle.
 */
export function stateMatches(cookieState: string | undefined | null, queryState: string | undefined | null): boolean {
  if (!cookieState || !queryState) return false;
  const a = Buffer.from(cookieState, "utf8");
  const b = Buffer.from(queryState, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type TikTokTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms. */
  expiresAt: number;
  refreshExpiresAt: number | null;
  scopes: string | null;
  openId: string;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  scope?: string;
  open_id?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(body: Record<string, string>, nowMs: number): Promise<TikTokTokenSet> {
  const creds = clientCreds();
  if (!creds) throw new Error("TikTok client credentials not configured");
  const res = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({ client_key: creds.key, client_secret: creds.secret, ...body }).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || json.error || !json.access_token) {
    // The description can carry the client secret back in some error shapes — never log the raw body.
    throw new Error(`TikTok token exchange failed (${res.status}): ${json.error ?? "no access_token"}`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: nowMs + (json.expires_in ?? 86_400) * 1000,
    refreshExpiresAt: json.refresh_expires_in ? nowMs + json.refresh_expires_in * 1000 : null,
    scopes: json.scope ?? null,
    openId: json.open_id ?? "default",
  };
}

/** Exchange the one-time code from the callback. */
export function exchangeCode(code: string, nowMs: number): Promise<TikTokTokenSet> {
  return tokenRequest({ code, grant_type: "authorization_code", redirect_uri: tiktokRedirectUri() }, nowMs);
}

/** Trade a refresh token for a new access token. TikTok also returns a NEW refresh token. */
export function refreshAccessToken(refreshToken: string, nowMs: number): Promise<TikTokTokenSet> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, nowMs);
}

/**
 * Persist a token set, replacing whatever was there.
 *
 * The REFRESH token is the part that must never be lost: TikTok rotates it on every refresh, and
 * dropping the new one strands the account until a human re-authorises. It is written in the same
 * statement as the access token so a partial write cannot leave the two out of step.
 */
export async function saveTokens(platform: "tiktok", t: TikTokTokenSet, displayName?: string | null): Promise<void> {
  if (!dbConfigured()) throw new Error("no database configured — cannot persist social tokens");
  await ensureSchema();
  await dbQuery(
    `INSERT INTO social_tokens
       (platform, account_id, access_token, refresh_token, expires_at, refresh_expires_at, scopes, display_name, updated_at)
     VALUES ($1,$2,$3,$4,to_timestamp($5/1000.0),to_timestamp($6/1000.0),$7,$8,NOW())
     ON CONFLICT (platform, account_id) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, social_tokens.refresh_token),
       expires_at = EXCLUDED.expires_at,
       refresh_expires_at = COALESCE(EXCLUDED.refresh_expires_at, social_tokens.refresh_expires_at),
       scopes = COALESCE(EXCLUDED.scopes, social_tokens.scopes),
       display_name = COALESCE(EXCLUDED.display_name, social_tokens.display_name),
       updated_at = NOW()`,
    [
      platform,
      t.openId,
      t.accessToken,
      t.refreshToken,
      t.expiresAt,
      t.refreshExpiresAt,
      t.scopes,
      displayName ?? null,
    ]
  );
}

/**
 * REFRESH EARLY, NOT ON FAILURE.
 *
 * Five minutes of headroom. Refreshing only when a request 401s means the first call after expiry
 * always fails — and on a scheduled post, that one failure IS the run. The margin also covers the
 * gap between deciding to post and the request actually landing.
 */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export function needsRefresh(expiresAt: number | null, nowMs: number): boolean {
  if (expiresAt == null) return true;
  return expiresAt - nowMs <= REFRESH_MARGIN_MS;
}

/**
 * The current usable access token, refreshing it first if it is close to expiry.
 *
 * Returns null — never a stale token — when there is no row, no refresh token, or the refresh
 * token itself has expired. The caller must then SKIP and surface that re-authorisation is needed.
 */
export async function currentAccessToken(platform: "tiktok", nowMs: number): Promise<string | null> {
  if (!dbConfigured()) return null;
  await ensureSchema();
  const res = await dbQuery<{
    account_id: string;
    access_token: string;
    refresh_token: string | null;
    expires_at: Date | null;
    refresh_expires_at: Date | null;
  }>(
    `SELECT account_id, access_token, refresh_token, expires_at, refresh_expires_at
       FROM social_tokens WHERE platform = $1 ORDER BY updated_at DESC LIMIT 1`,
    [platform]
  );
  const row = res.rows[0];
  if (!row) return null;

  const expiresAt = row.expires_at ? row.expires_at.getTime() : null;
  if (!needsRefresh(expiresAt, nowMs)) return row.access_token;

  // Past this point the stored access token is unusable. A null return is the honest answer.
  if (!row.refresh_token) return null;
  const refreshExp = row.refresh_expires_at ? row.refresh_expires_at.getTime() : null;
  if (refreshExp != null && refreshExp <= nowMs) return null; // a human must re-authorise

  const fresh = await refreshAccessToken(row.refresh_token, nowMs);
  await saveTokens(platform, fresh);
  return fresh.accessToken;
}
