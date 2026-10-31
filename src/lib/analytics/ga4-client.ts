import { GA4_MEASUREMENT_ID } from "./ga4-measurement-id";
import {
  GA4_ONCE_STORAGE_KEY,
  GA4_PENDING_SIGNUP_KEY,
  attributionEventParams,
} from "./utm";
import { clerkClientCookiePresent } from "@/lib/clerk-client-cookie";

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
  // Clerk may write `__session_<publishableKeySuffix>` INSTEAD OF the bare `__session` cookie
  // (confirmed live in this deployment — #797, #7082); a signed-in member whose browser carries
  // only the suffixed cookie previously made this `includes("__session=")` check — and therefore
  // every GA4/Google Ads conversion event gated on it (`sign_up`, the `signup` Ads conversion,
  // `desk_opened`) — silently never fire. See `clerk-client-cookie.ts`.
  return clerkClientCookiePresent("__session");
}

export function markPendingSignUp(): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.setItem(GA4_PENDING_SIGNUP_KEY, "1");
  } catch {
    /* ignore */
  }
}

/**
 * Non-destructive check: is a sign-up still pending? Callers that might not be able to actually
 * dispatch the event yet (e.g. gtag hasn't loaded) must check this BEFORE calling
 * `consumePendingSignUp`, so a dropped fire leaves the flag in place for a retry (a page refresh
 * re-runs the whole script-load race) instead of the event being silently and permanently lost.
 */
export function hasPendingSignUp(): boolean {
  if (!isBrowser()) return false;
  try {
    return sessionStorage.getItem(GA4_PENDING_SIGNUP_KEY) === "1";
  } catch {
    return false;
  }
}

export function consumePendingSignUp(): boolean {
  if (!isBrowser()) return false;
  try {
    const v = sessionStorage.getItem(GA4_PENDING_SIGNUP_KEY);
    if (v !== "1") return false;
    sessionStorage.removeItem(GA4_PENDING_SIGNUP_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Same shape of bug, same fix, a different call site: `Ga4ConversionTracker`'s purchase-fired
 * flag used to be written to localStorage unconditionally, before confirming gtag was ready to
 * accept the call — so a lost gtag-not-ready race on this flag was WORSE than the sign-up one,
 * because localStorage (unlike sessionStorage) survives a refresh/new tab, permanently blocking
 * every future attempt for that user. `hasPurchaseFired` is the non-destructive peek; the caller
 * must check `ga4Available()` before calling `markPurchaseFired`, mirroring `hasPendingSignUp`.
 */
export function hasPurchaseFired(userId: string): boolean {
  if (!isBrowser()) return false;
  try {
    return localStorage.getItem(`bo_ga4_purchase_fired:${userId}`) === "1";
  } catch {
    // Private mode (or storage blocked): we can't persist a flag either way, so there is
    // nothing to dedupe against — treat as "not yet fired" and let the caller fire once per
    // mount, matching the pre-existing "still fire once this session" fallback behavior.
    return false;
  }
}

export function markPurchaseFired(userId: string): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(`bo_ga4_purchase_fired:${userId}`, "1");
  } catch {
    /* private mode — best-effort only, matches hasPurchaseFired's fallback */
  }
}