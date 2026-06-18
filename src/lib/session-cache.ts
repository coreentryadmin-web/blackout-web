const PREFIX = "blackout:";

/** Keys stored without the blackout: prefix — cleared on Clerk sign-out. */
const EXTRA_SIGN_OUT_KEYS = ["largo-terminal-session", "blackout_desk_v1"] as const;

export const LARGO_SESSION_KEY = "largo-terminal-session";

type CacheEnvelope<T> = {
  at: number;
  data: T;
};

export function readSessionCache<T>(key: string, maxAgeMs?: number): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (maxAgeMs != null && Date.now() - parsed.at > maxAgeMs) return undefined;
    return parsed.data;
  } catch {
    return undefined;
  }
}

export function writeSessionCache<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    const envelope: CacheEnvelope<T> = { at: Date.now(), data };
    sessionStorage.setItem(`${PREFIX}${key}`, JSON.stringify(envelope));
  } catch {
    // ignore quota / private mode
  }
}

/** Clear all blackout session keys — call on Clerk sign-out. */
export function clearAllSessionCache(): void {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
    for (const k of EXTRA_SIGN_OUT_KEYS) sessionStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}
