/** First-touch UTM capture + helpers for attributed checkout/sign-up links. */

export const ATTRIBUTION_STORAGE_KEY = "bo_attribution_v1";
export const GA4_ONCE_STORAGE_KEY = "bo_ga4_once_v1";
export const GA4_PENDING_SIGNUP_KEY = "bo_ga4_pending_signup_v1";

export const UTM_PARAM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

export type UtmParamKey = (typeof UTM_PARAM_KEYS)[number];
export type AttributionParams = Partial<Record<UtmParamKey, string>>;

export type StoredAttribution = AttributionParams & {
  captured_at?: string;
  landing_path?: string;
};

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/** Parse standard UTM query params from a search string (with or without leading ?). */
export function parseUtmFromSearch(search: string): AttributionParams {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const out: AttributionParams = {};
  for (const key of UTM_PARAM_KEYS) {
    const value = params.get(key)?.trim();
    if (value) out[key] = value;
  }
  return out;
}

export function readStoredAttribution(): StoredAttribution | null {
  if (!isBrowser()) return null;
  try {
    const raw = sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAttribution;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Persist first-touch UTMs for the session (never overwrite once utm_source is set). */
export function captureAttributionFromSearch(
  search: string,
  landingPath?: string,
): StoredAttribution | null {
  if (!isBrowser()) return null;
  const existing = readStoredAttribution();
  if (existing?.utm_source) return existing;

  const incoming = parseUtmFromSearch(search);
  if (!incoming.utm_source) return existing;

  const merged: StoredAttribution = {
    ...incoming,
    captured_at: new Date().toISOString(),
    landing_path: landingPath,
  };

  try {
    sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(merged));
  } catch {
    /* quota / private mode */
  }
  return merged;
}

export function internalCampaignParams(
  source: string,
  campaign: string,
  medium = "referral",
): AttributionParams {
  return {
    utm_source: source,
    utm_medium: medium,
    utm_campaign: campaign,
  };
}

/** Server-safe UTM append (no sessionStorage). */
export function appendUtmParams(href: string, params: AttributionParams): string {
  try {
    const url = new URL(href);
    for (const key of UTM_PARAM_KEYS) {
      const value = params[key];
      if (value) url.searchParams.set(key, value);
    }
    return url.toString();
  } catch {
    return href;
  }
}

/** Append stored + optional override UTMs to an absolute or relative URL. */
export function appendAttributionToUrl(
  href: string,
  overrides?: AttributionParams,
): string {
  const stored = readStoredAttribution() ?? {};
  const merged: AttributionParams = { ...stored, ...overrides };
  const hasUtm = UTM_PARAM_KEYS.some((k) => merged[k]);
  if (!hasUtm) return href;

  try {
    const base =
      typeof window !== "undefined" ? window.location.origin : "https://blackouttrades.com";
    const url = new URL(href, base);
    for (const key of UTM_PARAM_KEYS) {
      const value = merged[key];
      if (value && !url.searchParams.has(key)) url.searchParams.set(key, value);
    }
    if (href.startsWith("http://") || href.startsWith("https://")) return url.toString();
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}

/** GA4 event params derived from stored attribution. */
export function attributionEventParams(): Record<string, string> {
  const stored = readStoredAttribution();
  if (!stored) return {};
  const out: Record<string, string> = {};
  for (const key of UTM_PARAM_KEYS) {
    const value = stored[key];
    if (value) out[key] = value;
  }
  if (stored.landing_path) out.landing_path = stored.landing_path;
  return out;
}
