/**
 * Persist visual memory for screenshot novelty — read/write JSON ledger.
 * Path: data/x-intel/visual-memory.json
 */

import type { XIntelFranchise } from "@/lib/x-intel/franchises";
import type { XIntelVisualMemoryEntry } from "@/lib/x-intel/visual-memory";

export type VisualMemoryLedger = {
  version: number;
  updated_at: string;
  /** Newest first — matches visual-memory.ts expectations. */
  entries: XIntelVisualMemoryEntry[];
  /** Optional engagement feedback keyed by cycle_key. */
  performance?: Record<
    string,
    {
      impressions?: number;
      likes?: number;
      reposts?: number;
      replies?: number;
      bookmarks?: number;
      profile_visits?: number;
      link_clicks?: number;
    }
  >;
};

export const VISUAL_MEMORY_PATH = "data/x-intel/visual-memory.json";

export function emptyVisualMemoryLedger(): VisualMemoryLedger {
  return { version: 1, updated_at: new Date().toISOString(), entries: [], performance: {} };
}

/** Parse ledger JSON safely. */
export function parseVisualMemoryLedger(raw: string): VisualMemoryLedger {
  const j = JSON.parse(raw) as VisualMemoryLedger;
  if (!Array.isArray(j.entries)) return emptyVisualMemoryLedger();
  return {
    version: j.version ?? 1,
    updated_at: j.updated_at ?? new Date().toISOString(),
    entries: j.entries,
    performance: j.performance ?? {},
  };
}

/** Append a capture to memory (newest first), cap history. */
export function appendVisualMemory(
  ledger: VisualMemoryLedger,
  entry: XIntelVisualMemoryEntry,
  maxEntries = 200,
): VisualMemoryLedger {
  const entries = [entry, ...ledger.entries.filter((e) => e.cycle_key !== entry.cycle_key)].slice(0, maxEntries);
  return {
    ...ledger,
    updated_at: new Date().toISOString(),
    entries,
  };
}

export type PublishedPostRecord = {
  post_id: string;
  cycle_key: string;
  timestamp: string;
  ticker: string;
  franchise: XIntelFranchise | null;
  market_story: string;
  attachments: Array<{
    catalog_id: string;
    product: string;
    visualization: string;
    signature: string;
  }>;
  diversity_score?: number;
};

export type PublishHistoryLedger = {
  version: number;
  updated_at: string;
  posts: PublishedPostRecord[];
};

export const PUBLISH_HISTORY_PATH = "data/x-intel/publish-history.json";

export function emptyPublishHistory(): PublishHistoryLedger {
  return { version: 1, updated_at: new Date().toISOString(), posts: [] };
}

export function appendPublishRecord(
  ledger: PublishHistoryLedger,
  record: PublishedPostRecord,
  maxPosts = 500,
): PublishHistoryLedger {
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    posts: [record, ...ledger.posts.filter((p) => p.post_id !== record.post_id)].slice(0, maxPosts),
  };
}
