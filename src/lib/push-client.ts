"use client";

// Client-side web-push subscription helper. FULLY INERT when
// NEXT_PUBLIC_VAPID_PUBLIC_KEY is unset: every entry point returns
// { ok: false, reason: "unconfigured" } and performs no network/permission work.

export type PushResult = { ok: boolean; reason?: string };

function vapidPublicKey(): string | null {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  return key ? key : null;
}

export function pushConfigured(): boolean {
  return vapidPublicKey() !== null;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  // Back the view with a concrete ArrayBuffer so it satisfies BufferSource
  // (applicationServerKey) under the current TS lib's stricter typings.
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Prompt for permission, subscribe via the SW, and persist server-side. No-op if unconfigured. */
export async function subscribeToPush(): Promise<PushResult> {
  const key = vapidPublicKey();
  if (!key) return { ok: false, reason: "unconfigured" };
  if (!pushSupported()) return { ok: false, reason: "unsupported" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };

  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    }));

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  if (!res.ok) return { ok: false, reason: `server_${res.status}` };
  return { ok: true };
}

/** Unsubscribe locally + tell the server to drop the record. */
export async function unsubscribeFromPush(): Promise<PushResult> {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return { ok: true };
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => undefined);
  await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => undefined);
  return { ok: true };
}
