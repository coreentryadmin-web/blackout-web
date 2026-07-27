// APNs (native iOS) push sender — the counterpart to `send-web-push.ts`.
//
// SHAPE (deliberately mirrors send-web-push.ts):
//   - `apnsConfigured()` → single boolean gate; if false, `sendApnsPush` is a no-op.
//   - Reads token-based auth env vars (below) — no cert/pfx paths, no keychain.
//   - Lazily ensures the `push_native_devices` table (matches how the web-push
//     subscribe route auto-creates `push_subscriptions`) — no global migration change.
//   - 410/BadDeviceToken responses PRUNE the offending row so a rotated device
//     doesn't get retried indefinitely.
//   - Never throws — a misconfigured push environment must never break a caller.
//
// CREDENTIAL REQUIREMENT — the .p8 here is NOT the App Store Connect API key.
// Apple issues these two key types separately (App Store Connect → Users & Access
// vs Apple Developer → Certificates → Keys → APNs). They both look like a .p8
// PEM, but they auth different services and are NOT interchangeable. Until an
// APNs Auth Key is provided in the env, this helper reports
// `configured: false` and sends nothing.
//
// ENV CONTRACT
//   APNS_TEAM_ID        — 10-char Apple Team ID (same value as APPLE_TEAM_ID
//                         used in the iOS build — e.g. "ZA32C782N5").
//   APNS_KEY_ID         — 10-char Key ID printed next to the APNs key in the
//                         Apple Developer portal.
//   APNS_PRIVATE_KEY    — the full contents of the APNs AuthKey_XXXX.p8 file
//                         (PEM, multi-line — starts with -----BEGIN PRIVATE KEY-----).
//   APNS_BUNDLE_ID      — the app's bundle id — e.g. "com.blackout-trades.app".
//                         Sent as the `apns-topic` header on every push.
//   APNS_ENVIRONMENT    — "production" (default) or "sandbox". Sandbox routes to
//                         api.sandbox.push.apple.com (used by Xcode debug builds).

import { createSign, createPrivateKey } from "node:crypto";
import { connect as http2Connect, constants as h2Constants } from "node:http2";
import { dbConfigured, dbQuery } from "@/lib/db";

const {
  HTTP2_HEADER_METHOD,
  HTTP2_HEADER_PATH,
  HTTP2_HEADER_AUTHORIZATION,
  HTTP2_HEADER_STATUS,
} = h2Constants;

// APNs bounds a token JWT to a MAX lifetime of ~1 hour and REJECTS one that's
// too new (< a few minutes). We mint fresh per batch and cache for the batch
// only — the whole call site returns within seconds, so token drift is a
// non-issue and there's no shared cache to invalidate on key rotation.
const JWT_LIFETIME_SECONDS = 45 * 60;

// APNs endpoints. Production is used when APNS_ENVIRONMENT is unset or
// "production". "sandbox" routes to the Development APNs environment (Xcode
// debug builds register with the sandbox APS environment).
const PROD_HOST = "api.push.apple.com";
const SANDBOX_HOST = "api.sandbox.push.apple.com";
const APNS_PORT = 443;

export interface ApnsConfig {
  teamId: string;
  keyId: string;
  privateKey: string;
  bundleId: string;
  host: string;
}

/** True only when EVERY APNs credential is present. Reader for the caller
 *  (route handlers, the alerts cron) — no throws. */
export function apnsConfigured(): boolean {
  return Boolean(readApnsConfig());
}

/** Read + validate the APNs env. Returns null if any piece is missing so the
 *  sender can no-op instead of crashing on partial config. */
function readApnsConfig(): ApnsConfig | null {
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const keyId = process.env.APNS_KEY_ID?.trim();
  const privateKey = process.env.APNS_PRIVATE_KEY?.trim();
  const bundleId = process.env.APNS_BUNDLE_ID?.trim();
  if (!teamId || !keyId || !privateKey || !bundleId) return null;
  const env = process.env.APNS_ENVIRONMENT?.trim().toLowerCase();
  const host = env === "sandbox" ? SANDBOX_HOST : PROD_HOST;
  return { teamId, keyId, privateKey, bundleId, host };
}

/** Base64url — RFC 7515 §2. Node 20 has this in Buffer natively. */
function base64url(input: Buffer | string): string {
  return (typeof input === "string" ? Buffer.from(input) : input).toString("base64url");
}

/** Mint the ES256 JWT APNs expects.
 *  Header: { alg: "ES256", kid: keyId }.
 *  Claims: { iss: teamId, iat: now }.
 *  Signature: ES256 over `${header}.${payload}` in JOSE (r||s) form.
 *  Exported for unit tests. */
export function mintApnsJwt(cfg: ApnsConfig, nowSeconds: number = Math.floor(Date.now() / 1000)): string {
  const header = { alg: "ES256", kid: cfg.keyId, typ: "JWT" };
  const payload = { iss: cfg.teamId, iat: nowSeconds };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const key = createPrivateKey({ key: cfg.privateKey, format: "pem" });
  // Node's ES256 sign returns DER; APNs (JOSE) requires raw r||s. `dsaEncoding`
  // gives us the raw pair directly — same call shape used earlier this session
  // when minting the App Store Connect API JWT.
  const signer = createSign("SHA256");
  signer.update(signingInput);
  const signature = signer.sign({ key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${base64url(signature)}`;
}

/** JWT lifetime hint for callers that batch (single push in the pipeline uses
 *  a fresh token every time). */
export function jwtIsFresh(nowIssuedAt: number, currentTime: number = Math.floor(Date.now() / 1000)): boolean {
  return currentTime - nowIssuedAt < JWT_LIFETIME_SECONDS;
}

export interface ApnsPushPayload {
  /** APNs `aps` dictionary shell — the sender wraps user fields into it. */
  title?: string;
  body?: string;
  sound?: string; // "default" or a bundled sound name; omit for silent.
  badge?: number;
  /** Interruption level per APS spec — active|passive|time-sensitive|critical. */
  interruptionLevel?: "active" | "passive" | "time-sensitive" | "critical";
  /** Arbitrary user data delivered alongside `aps` — parsed by the app. */
  userInfo?: Record<string, unknown>;
  /** APS `category` — matches the app-registered notification category id. */
  category?: string;
}

/** Build the JSON body APNs expects — `aps` on the outside, `userInfo` merged
 *  at the top level per Apple's spec. Exported for testability. */
export function buildApnsBody(payload: ApnsPushPayload): string {
  const aps: Record<string, unknown> = {};
  if (payload.title || payload.body) {
    const alert: Record<string, string> = {};
    if (payload.title) alert.title = payload.title;
    if (payload.body) alert.body = payload.body;
    aps.alert = alert;
  }
  if (payload.sound !== undefined) aps.sound = payload.sound;
  if (payload.badge !== undefined) aps.badge = payload.badge;
  if (payload.category) aps.category = payload.category;
  if (payload.interruptionLevel) aps["interruption-level"] = payload.interruptionLevel;
  const body: Record<string, unknown> = { aps, ...(payload.userInfo || {}) };
  return JSON.stringify(body);
}

/** Idempotently ensure the native-devices table exists. Matches the pattern
 *  used by src/app/api/push/subscribe/route.ts for `push_subscriptions`. */
export async function ensureApnsDeviceTable(): Promise<void> {
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS push_native_devices (
      device_token TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      bundle_id    TEXT NOT NULL,
      environment  TEXT NOT NULL DEFAULT 'production',
      platform     TEXT NOT NULL DEFAULT 'ios',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await dbQuery(`
    CREATE INDEX IF NOT EXISTS push_native_devices_user_id_idx
      ON push_native_devices (user_id)
  `);
}

export interface SendResult {
  configured: boolean;
  attempted: number;
  sent: number;
  pruned: number;
  errors: Array<{ deviceToken: string; status: number; reason?: string }>;
}

/** Send `payload` to every APNs device registered for `userId`.
 *
 *  Never throws. Returns a result envelope the caller can log/act on.
 *  On any 410 / BadDeviceToken response the offending row is DELETED from
 *  `push_native_devices` (mirrors the 404/410 prune the web-push helper does). */
export async function sendApnsPush(userId: string, payload: ApnsPushPayload): Promise<SendResult> {
  const empty: SendResult = { configured: false, attempted: 0, sent: 0, pruned: 0, errors: [] };
  const cfg = readApnsConfig();
  if (!cfg) return empty;
  if (!dbConfigured()) return { ...empty, configured: true };

  await ensureApnsDeviceTable();

  const devices = (await dbQuery(
    `SELECT device_token FROM push_native_devices WHERE user_id = $1 AND bundle_id = $2`,
    [userId, cfg.bundleId]
  )).rows as Array<{ device_token: string }>;

  if (devices.length === 0) return { ...empty, configured: true };

  const jwt = mintApnsJwt(cfg);
  const body = buildApnsBody(payload);

  // A single HTTP/2 session for the whole batch — APNs multiplexes many
  // requests per session which is the whole point of HTTP/2 for push.
  const session = http2Connect(`https://${cfg.host}:${APNS_PORT}`);

  const errors: SendResult["errors"] = [];
  const stalePrunes: string[] = [];
  let sent = 0;

  try {
    // Fire all pushes, then await; error handling is per-request.
    const results = await Promise.all(
      devices.map((d) => sendOne(session, d.device_token, jwt, body, cfg))
    );
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const token = devices[i].device_token;
      if (r.status === 200) {
        sent++;
      } else {
        errors.push({ deviceToken: redactToken(token), status: r.status, reason: r.reason });
        if (r.status === 410 || r.reason === "BadDeviceToken" || r.reason === "Unregistered") {
          stalePrunes.push(token);
        }
      }
    }
  } finally {
    session.close();
  }

  if (stalePrunes.length > 0) {
    await dbQuery(`DELETE FROM push_native_devices WHERE device_token = ANY($1::text[])`, [stalePrunes]);
  }

  return {
    configured: true,
    attempted: devices.length,
    sent,
    pruned: stalePrunes.length,
    errors,
  };
}

/** One APNs HTTP/2 request. Resolves; never rejects (the outer sender wants
 *  per-device error data, not a single-bad-token failure of the batch). */
function sendOne(
  session: ReturnType<typeof http2Connect>,
  deviceToken: string,
  jwt: string,
  body: string,
  cfg: ApnsConfig
): Promise<{ status: number; reason?: string }> {
  return new Promise((resolve) => {
    let closed = false;
    const done = (r: { status: number; reason?: string }) => {
      if (closed) return;
      closed = true;
      resolve(r);
    };

    const req = session.request({
      [HTTP2_HEADER_METHOD]: "POST",
      [HTTP2_HEADER_PATH]: `/3/device/${deviceToken}`,
      [HTTP2_HEADER_AUTHORIZATION]: `bearer ${jwt}`,
      "apns-topic": cfg.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json; charset=utf-8",
      "content-length": String(Buffer.byteLength(body)),
    });

    let status = 0;
    let responseBody = "";
    req.on("response", (headers) => {
      status = Number(headers[HTTP2_HEADER_STATUS] || 0);
    });
    req.on("data", (chunk: Buffer | string) => {
      responseBody += chunk.toString();
    });
    req.on("end", () => {
      let reason: string | undefined;
      if (status !== 200 && responseBody) {
        try {
          const parsed = JSON.parse(responseBody);
          if (typeof parsed?.reason === "string") reason = parsed.reason;
        } catch {
          /* keep reason undefined */
        }
      }
      done({ status, reason });
    });
    req.on("error", (err) => done({ status: 0, reason: String(err.message || err).slice(0, 200) }));
    // 10s per-request timeout — APNs is normally <1s.
    req.setTimeout(10_000, () => {
      try { req.close(); } catch { /* noop */ }
      done({ status: 0, reason: "timeout" });
    });

    req.end(body);
  });
}

/** Redact device tokens in logs / error payloads (they're user-linkable). */
function redactToken(token: string): string {
  if (token.length <= 12) return "…";
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}
