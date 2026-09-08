// Pre-entry banger screen → WATCH plays cache (Swing Command unification).
//
// Engine B's cron screens the whole market post-close; open positions merge live via banger-lane-merge.
// This cache carries the screened movers + picked contracts as WATCH rows until a member commits or the
// next session overwrites — so the Swings tab shows "building bangers" without a separate tab.

import type { HorizonPlay } from "../horizon-plays";
import { sharedCacheGet, sharedCacheSet } from "../shared-cache";

export type BangerWatchSnapshot = {
  asOf: string;
  sessionDate: string;
  plays: HorizonPlay[];
};

const CACHE_KEY = (sessionDate: string) => `banger:watch:v1:${sessionDate}`;
const TTL_SEC = 26 * 60 * 60;

export async function persistBangerWatchSnapshot(snap: BangerWatchSnapshot): Promise<void> {
  await sharedCacheSet(CACHE_KEY(snap.sessionDate), snap, TTL_SEC).catch(() => undefined);
}

export async function readBangerWatchSnapshot(sessionDate: string): Promise<BangerWatchSnapshot | null> {
  const raw = await sharedCacheGet<BangerWatchSnapshot>(CACHE_KEY(sessionDate)).catch(() => null);
  if (!raw || !Array.isArray(raw.plays)) return null;
  return raw;
}
