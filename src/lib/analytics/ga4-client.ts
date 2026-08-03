import { GA4_MEASUREMENT_ID } from "./ga4-measurement-id";
import {
  GA4_ONCE_STORAGE_KEY,
  attributionEventParams,
} from "./utm";

type GtagFn = (...args: unknown[]) => void;

declare global {
  interface Window {
    gtag?: GtagFn;
    dataLayer?: unknown[];
  }
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function ga4Available(): boolean {
  return isBrowser() && typeof window.gtag === "function";
}

/** Fire once per browser session for a given dedupe key. */
export function ga4OncePerSession(key: string): boolean {
  if (!isBrowser()) return false;
  try {
    const raw = sessionStorage.getItem(GA4_ONCE_STORAGE_KEY);
    const fired: string[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(fired)) return true;
    if (fired.includes(key)) return false;
    fired.push(key);
    sessionStorage.setItem(GA4_ONCE_STORAGE_KEY, JSON.stringify(fired));
    return true;
  } catch {
    return true;
  }
}

export function trackGa4Event(
  name: string,
  params: Record<string, string | number | boolean | undefined> = {},
): void {
  if (!ga4Available()) return;
  const payload = {
    ...attributionEventParams(),
    ...params,
  };
  for (const key of Object.keys(payload)) {
    if (payload[key as keyof typeof payload] === undefined) delete payload[key as keyof typeof payload];
  }
  window.gtag!("event", name, payload);
}

export function trackGa4PageView(pathname: string, search = ""): void {
  if (!ga4Available()) return;
  const page_path = `${pathname}${search}`;
  window.gtag!("config", GA4_MEASUREMENT_ID, { page_path });
}

export function hasSessionCookie(): boolean {
  if (!isBrowser()) return false;
  return document.cookie.includes("__session=");
}

export function markPendingSignUp(): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.setItem("bo_ga4_pending_signup_v1", "1");
  } catch {
    /* ignore */
  }
}

export function consumePendingSignUp(): boolean {
  if (!isBrowser()) return false;
  try {
    const v = sessionStorage.getItem("bo_ga4_pending_signup_v1");
    if (v !== "1") return false;
    sessionStorage.removeItem("bo_ga4_pending_signup_v1");
    return true;
  } catch {
    return false;
  }
}