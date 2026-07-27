import { auth } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { dbConfigured, dbQuery } from "@/lib/db";
import { ensureApnsDeviceTable } from "@/lib/push/send-apns-push";

// Register (or refresh) the caller's iOS APNs device token so future push
// notifications reach them. Mirrors src/app/api/push/subscribe/route.ts —
// same auth gate, same DB-availability gate, same lazy table creation —
// but for NATIVE (APNs) instead of web push (VAPID).
//
// Contract: called by the native SwiftUI app AFTER
//   1. the user grants push permission,
//   2. UIApplication.registerForRemoteNotifications succeeds,
//   3. the app delegate captures the APNs device token.
// The app POSTs {deviceToken, bundleId, environment} — we upsert the row.

export const dynamic = "force-dynamic";
// Explicit runtime: pg driver + http2 need node — do NOT let this get routed
// to Edge (it would silently fail to connect). The other push route sets
// force-dynamic + implicitly uses the node runtime for the same reason.
export const runtime = "nodejs";

interface RegisterBody {
  deviceToken?: string;
  bundleId?: string;
  environment?: "production" | "sandbox";
  platform?: "ios";
}

// APNs device tokens are 32 bytes = 64 hex chars in the classic form. The
// modern APNs "token" the app receives is `Data.map { String(format: "%02x", $0) }`
// so it should be 64 hex chars. Accept 64-256 hex chars to be forward-tolerant
// (Apple has hinted at longer tokens in the future) while still rejecting
// obvious garbage.
const TOKEN_PATTERN = /^[0-9a-fA-F]{64,256}$/;
// Bundle ID: reverse-DNS, letters/numbers/dot/hyphen. Deliberately restrictive
// so a caller can't inject via this field.
const BUNDLE_ID_PATTERN = /^[a-zA-Z0-9.-]{3,128}$/;

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!dbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let body: RegisterBody;
  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const deviceToken = body.deviceToken?.trim();
  const bundleId = body.bundleId?.trim();
  const environment = body.environment === "sandbox" ? "sandbox" : "production";
  const platform = body.platform === "ios" ? "ios" : "ios";

  if (!deviceToken || !TOKEN_PATTERN.test(deviceToken)) {
    return NextResponse.json({ error: "Invalid deviceToken" }, { status: 400 });
  }
  if (!bundleId || !BUNDLE_ID_PATTERN.test(bundleId)) {
    return NextResponse.json({ error: "Invalid bundleId" }, { status: 400 });
  }

  await ensureApnsDeviceTable();

  // UPSERT on the primary key so multiple devices per user are additive but
  // re-registering the same token from the same user is a cheap idempotent
  // refresh (updates last_seen_at). If a token ever appears against a
  // different user (device passed hands / account switch), we reassign to the
  // new owner — the previous owner shouldn't receive push for that device.
  await dbQuery(
    `INSERT INTO push_native_devices
       (device_token, user_id, bundle_id, environment, platform, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (device_token)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       bundle_id = EXCLUDED.bundle_id,
       environment = EXCLUDED.environment,
       platform = EXCLUDED.platform,
       last_seen_at = now()`,
    [deviceToken, userId, bundleId, environment, platform]
  );

  return NextResponse.json({ ok: true }, { status: 200 });
}

/** Unregister — called on sign-out or when the user disables notifications
 *  from Account settings. Deletes the specific device token so this device
 *  stops receiving push while other devices for the same user keep working. */
export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!dbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let body: { deviceToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const deviceToken = body.deviceToken?.trim();
  if (!deviceToken || !TOKEN_PATTERN.test(deviceToken)) {
    return NextResponse.json({ error: "Invalid deviceToken" }, { status: 400 });
  }

  await ensureApnsDeviceTable();
  // Scope the delete to (deviceToken, userId) so one user can never unregister
  // another user's device even if they happen to know the token string.
  const result = await dbQuery(
    `DELETE FROM push_native_devices WHERE device_token = $1 AND user_id = $2`,
    [deviceToken, userId]
  );
  return NextResponse.json({ ok: true, deleted: result.rowCount ?? 0 }, { status: 200 });
}
