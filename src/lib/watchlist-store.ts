// Pure, alias-free watchlist logic — no React, no window, no @/ imports.
// Covered by watchlist-store.test.ts (tsx --test). Array iteration only (no Map
// spread) so it is safe at this tsconfig target.

export const STORAGE_KEY = "blackout:watchlist:v1";
export const MAX_WATCHLIST = 50;

/** Uppercase, strip non-letters, cap length. Returns "" for junk. */
export function normalizeTicker(raw: string): string {
  if (typeof raw !== "string") return "";
  return raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
}

/** Tolerant parse of a persisted blob into a clean, deduped, capped ticker list. */
export function parseWatchlist(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of arr) {
    if (typeof item !== "string") continue;
    const t = normalizeTicker(item);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_WATCHLIST) break;
  }
  return out;
}

export function serializeWatchlist(list: string[]): string {
  return JSON.stringify(list);
}

export function isStarred(list: string[], ticker: string): boolean {
  const t = normalizeTicker(ticker);
  if (!t) return false;
  return list.indexOf(t) !== -1;
}

/** Add ticker if absent, remove if present. Returns a NEW array (immutable). */
export function toggleTicker(list: string[], ticker: string): string[] {
  const t = normalizeTicker(ticker);
  if (!t) return list.slice();
  const idx = list.indexOf(t);
  if (idx !== -1) {
    const next = list.slice();
    next.splice(idx, 1);
    return next;
  }
  if (list.length >= MAX_WATCHLIST) return list.slice(); // at cap — no-op add
  return [t, ...list];
}

/** Remove ticker (used by chip × button). Returns a NEW array. */
export function removeTicker(list: string[], ticker: string): string[] {
  const t = normalizeTicker(ticker);
  if (!t) return list.slice();
  const idx = list.indexOf(t);
  if (idx === -1) return list.slice();
  const next = list.slice();
  next.splice(idx, 1);
  return next;
}
