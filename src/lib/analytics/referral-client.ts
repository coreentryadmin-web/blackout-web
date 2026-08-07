/** First-touch ?ref= capture — the referral "code" is the referrer's Clerk user ID. */

const REFERRAL_STORAGE_KEY = "bo_referral_v1";
const REFERRAL_ATTRIBUTED_FLAG = "bo_referral_attributed_v1";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/** Persist the first ?ref= seen this session (never overwrite once captured). */
export function captureReferralFromSearch(search: string): string | null {
  if (!isBrowser()) return readStoredReferrer();
  const existing = readStoredReferrer();
  if (existing) return existing;

  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const ref = params.get("ref")?.trim();
  if (!ref) return null;

  try {
    sessionStorage.setItem(REFERRAL_STORAGE_KEY, ref);
  } catch {
    /* quota / private mode */
  }
  return ref;
}

export function readStoredReferrer(): string | null {
  if (!isBrowser()) return null;
  try {
    return sessionStorage.getItem(REFERRAL_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Guards a single attribute-endpoint call per browser session. */
export function referralAttributionAlreadySent(): boolean {
  if (!isBrowser()) return true;
  try {
    return sessionStorage.getItem(REFERRAL_ATTRIBUTED_FLAG) === "1";
  } catch {
    return true;
  }
}

export function markReferralAttributionSent(): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.setItem(REFERRAL_ATTRIBUTED_FLAG, "1");
  } catch {
    /* quota / private mode */
  }
}
