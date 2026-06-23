import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/admin-access";
import { dbConfigured, dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";

// SCAFFOLD. Admin-only. Sends a web-push notification to stored subscriptions.
// This route is INERT until BOTH:
//   1) VAPID keys are set (NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY), and
//   2) the optional `web-push` package is installed.
// Until then it returns 501 and sends nothing. No push is ever delivered without keys.

function vapidConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim()
  );
}

type WebPushModule = {
  setVapidDetails: (subject: string, pub: string, priv: string) => void;
  sendNotification: (sub: unknown, payload: string) => Promise<unknown>;
};

// Optional dependency. Loaded only if installed; absence => scaffold stays inert.
// Variable specifier keeps TS/bundlers from hard-resolving the (uninstalled)
// module at build time — it stays a runtime-only dynamic import.
async function loadWebPush(): Promise<WebPushModule | null> {
  try {
    const spec = "web-push";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(/* webpackIgnore: true */ spec);
    return (mod.default ?? mod) as WebPushModule;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  if (!vapidConfigured()) {
    return NextResponse.json(
      { error: "Push not configured", detail: "Set NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY." },
      { status: 501 }
    );
  }
  const webpush = await loadWebPush();
  if (!webpush) {
    return NextResponse.json(
      { error: "web-push not installed", detail: "Run: npm i web-push" },
      { status: 501 }
    );
  }
  if (!dbConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let body: { title?: string; body?: string; url?: string; userId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT?.trim() || "mailto:ops@blackouttrades.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!.trim(),
    process.env.VAPID_PRIVATE_KEY!.trim()
  );

  const payload = JSON.stringify({
    title: body.title || "BlackOut Trades",
    body: body.body || "",
    url: body.url || "/dashboard",
  });

  const rows = body.userId
    ? (await dbQuery(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`, [body.userId])).rows
    : (await dbQuery(`SELECT endpoint, p256dh, auth FROM push_subscriptions`)).rows;

  let sent = 0;
  const stale: string[] = [];
  for (const r of rows as Array<{ endpoint: string; p256dh: string; auth: string }>) {
    try {
      await webpush.sendNotification(
        { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
        payload
      );
      sent++;
    } catch (err: unknown) {
      const code = (err as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) stale.push(r.endpoint); // gone — prune
    }
  }
  if (stale.length) {
    await dbQuery(`DELETE FROM push_subscriptions WHERE endpoint = ANY($1::text[])`, [stale]).catch(
      () => undefined
    );
  }

  return NextResponse.json({ ok: true, sent, pruned: stale.length });
}
