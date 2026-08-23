import type { FlowAlert } from "@/lib/api";
import { flowCompositeKey, mergeFlowAlerts } from "@/features/helix/lib/helix-flow-merge";

export function flowDedupeKey(a: {
  alert_id?: string;
  ticker: string;
  strike: number;
  option_type: string;
  alerted_at?: string | null;
}): string {
  if (a.alert_id) return `id:${a.alert_id}`;
  return flowCompositeKey(a);
}

/**
 * When this print happened, in ms — or `null` when we cannot say.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────────────────────────
 *
 * This returned **0** for an undatable row. On a tape sorted newest-first, 0 is 1970 — the oldest
 * position there is. So a print that had just streamed in was rendered LAST.
 *
 * It is reachable on the live path, not in theory. `flow-persist.ts` publishes the SSE row with
 * `event.alerted_at = realCreatedAt ?? ""` under a comment that says the empty value means the row
 * is left out: *"leave it null so the UI excludes the row from LIVE/sort"*. **Nothing excludes it.**
 * The only two readers of an absent `alerted_at` are this function, which fabricated a 0, and
 * `helix-flow-format.ts`, which correctly returns null for display. So the documented behaviour and
 * the actual behaviour differ, which is why it stayed invisible — the comment answers the question
 * a reader would have asked.
 *
 * Reproduced against the real merge: two dated rows plus one brand-new SSE row with
 * `alerted_at: ""` puts the new print at **index 2 of 3**.
 *
 * ── WHY null AND NOT A DIFFERENT NUMBER ─────────────────────────────────────────────────────────
 *
 * Any sentinel is a fabricated timestamp, and the two callers want opposite placements for an
 * undated row — `mergeFlowTapeHead` is by definition the NEWEST page, `appendFlowTapePage` is
 * documented as "rows strictly older than what we already hold". One number cannot be right for
 * both, so the placement is each caller's decision and this function only reports what it knows.
 */
function flowTimeSortKey(a: FlowAlert): number | null {
  if (!a.alerted_at) return null;
  const ms = new Date(a.alerted_at).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Newest-first comparator. `undatedFirst` says where a row with no usable time belongs, which
 * differs per caller (see above). Undated rows keep their relative insertion order, so the merge
 * stays deterministic instead of depending on Map iteration against a tie.
 */
function byTimeDesc(undatedFirst: boolean) {
  return (a: FlowAlert, b: FlowAlert): number => {
    const ta = flowTimeSortKey(a);
    const tb = flowTimeSortKey(b);
    if (ta == null && tb == null) return 0;
    if (ta == null) return undatedFirst ? -1 : 1;
    if (tb == null) return undatedFirst ? 1 : -1;
    return tb - ta;
  };
}

/** Merge a fresh head page (poll/SSE refresh) into the full in-memory tape without dropping older pages. */
export function mergeFlowTapeHead(existing: FlowAlert[], head: FlowAlert[]): FlowAlert[] {
  const map = new Map<string, FlowAlert>();
  for (const row of existing) {
    map.set(flowDedupeKey(row), row);
  }
  for (const row of head) {
    const key = flowDedupeKey(row);
    const prev = map.get(key);
    map.set(key, prev ? mergeFlowAlerts(row, prev) : row);
  }
  // The head IS the newest page, so a row we cannot date belongs at the top, not at 1970.
  return [...map.values()].sort(byTimeDesc(true));
}

/** Append an older cursor page — rows strictly older than what we already hold. */
export function appendFlowTapePage(existing: FlowAlert[], older: FlowAlert[]): FlowAlert[] {
  if (!older.length) return existing;
  const map = new Map<string, FlowAlert>();
  for (const row of existing) {
    map.set(flowDedupeKey(row), row);
  }
  for (const row of older) {
    const key = flowDedupeKey(row);
    if (!map.has(key)) map.set(key, row);
  }
  // This page is documented as strictly OLDER than what we hold, so an undated row from it belongs
  // at the bottom — the opposite of the head case, and the reason the placement is not baked into
  // the sort key.
  return [...map.values()].sort(byTimeDesc(false));
}

/** Cursor for the next older page — timestamp of the oldest row in the current page. */
export function flowPageCursor(
  rows: readonly { alerted_at: string; event_at?: string | null }[]
): string | null {
  if (!rows.length) return null;
  let oldestMs = Infinity;
  let cursor: string | null = null;
  for (const row of rows) {
    const iso = row.event_at || row.alerted_at;
    if (!iso) continue;
    const ms = new Date(iso).getTime();
    if (Number.isFinite(ms) && ms < oldestMs) {
      oldestMs = ms;
      cursor = iso;
    }
  }
  return cursor;
}
