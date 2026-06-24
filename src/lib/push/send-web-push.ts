// Shared web-push send helper. This is the ONE place the actual push-send logic lives.
//
// It MIRRORS the inert scaffold at `src/app/api/push/send/route.ts` exactly — the same
// `vapidConfigured()` gate, the same runtime-only dynamic import of the OPTIONAL `web-push`
// package, the same `push_subscriptions (user_id, endpoint, p256dh, auth)` query, the same
// `setVapidDetails` + send loop, and the same 404/410 prune. It is intentionally self-contained
// (it does NOT import the route) so both the route and new callers (e.g. the gex-alerts cron)
// can reuse one tested send path.
//
// INERT BY DEFAULT: when VAPID keys are missing, the `web-push` package is not installed, or the
// database is unconfigured, it returns `{ configured: false, sent: 0, pruned: 0 }` and sends
// NOTHING. It NEVER throws — a misconfigured push environment must never break a caller (cron or
// route). No push is ever delivered without keys + the package + a DB of subscriptions.
//
// FOLLOW-UP (do not do here): the scaffold route `src/app/api/push/send/route.ts` could later be
// refactored to delegate its send body to `sendWebPush(...)` so the logic isn't duplicated. That
// route is a shared scaffold owned elsewhere and is intentionally NOT edited by this change.

import { dbConfigured, dbQuery } from "@/lib/db";

/** True only when BOTH VAPID keys are present — same check the scaffold route uses. */
export function vapidConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim()
  );
}

type WebPushModule = {
  setVapidDetails: (subject: string, pub: string, priv: string) => void;
  sendNotification: (sub: unknown, payload: string) => Promise<unknown>;
};

// Optional dependency. Loaded only if installed; absence => helper stays inert.
// The variable specifier keeps TS/bundlers from hard-resolving the (possibly uninstalled)
// module at build time — it stays a runtime-only dynamic import, exactly like the scaffold.
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

export type WebPushPayload = {
  title: string;
  body: string;
  url: string;
};

export type WebPushResult = {
  /** False when VAPID / the web-push package / the DB is absent → nothing was sent. */
  configured: boolean;
  /** Number of subscriptions a notification was delivered to. */
  sent: number;
  /** Number of stale (404/410) subscriptions pruned from `push_subscriptions`. */
  pruned: number;
};

/**
 * Send a web-push notification to stored subscriptions, mirroring the scaffold route's send path.
 *
 * - `opts.userId` set → only that user's subscriptions; otherwise BROADCAST to all subscriptions.
 * - Returns `{ configured: false, sent: 0, pruned: 0 }` (INERT) when VAPID keys are missing, the
 *   optional `web-push` package isn't installed, or the database is unconfigured.
 * - NEVER throws: any unexpected error (DB read, send loop, prune) is swallowed and reported as a
 *   `{ configured: true, sent, pruned }` partial — a single bad subscription can't abort the rest.
 */
export async function sendWebPush(
  payload: WebPushPayload,
  opts?: { userId?: string }
): Promise<WebPushResult> {
  // Gate 1: VAPID keys. No keys → inert, send nothing.
  if (!vapidConfigured()) return { configured: false, sent: 0, pruned: 0 };

  // Gate 2: optional web-push package. Not installed → inert.
  const webpush = await loadWebPush();
  if (!webpush) return { configured: false, sent: 0, pruned: 0 };

  // Gate 3: database of subscriptions. Unconfigured → nothing to send to → inert.
  if (!dbConfigured()) return { configured: false, sent: 0, pruned: 0 };

  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT?.trim() || "mailto:ops@blackouttrades.com",
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!.trim(),
      process.env.VAPID_PRIVATE_KEY!.trim()
    );

    const body = JSON.stringify({
      title: payload.title || "BlackOut Trades",
      body: payload.body || "",
      url: payload.url || "/dashboard",
    });

    const rows = opts?.userId
      ? (
          await dbQuery(
            `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
            [opts.userId]
          )
        ).rows
      : (await dbQuery(`SELECT endpoint, p256dh, auth FROM push_subscriptions`)).rows;

    let sent = 0;
    const stale: string[] = [];
    for (const r of rows as Array<{ endpoint: string; p256dh: string; auth: string }>) {
      try {
        await webpush.sendNotification(
          { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
          body
        );
        sent++;
      } catch (err: unknown) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) stale.push(r.endpoint); // gone — prune
      }
    }

    if (stale.length) {
      await dbQuery(`DELETE FROM push_subscriptions WHERE endpoint = ANY($1::text[])`, [
        stale,
      ]).catch(() => undefined);
    }

    return { configured: true, sent, pruned: stale.length };
  } catch {
    // Any unexpected failure (DB unreachable mid-call, etc.) — never throw to the caller.
    return { configured: true, sent: 0, pruned: 0 };
  }
}
