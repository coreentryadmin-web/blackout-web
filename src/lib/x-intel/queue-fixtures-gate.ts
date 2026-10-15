import type { XIntelQueueRow } from "@/lib/x-intel/queue-types";

/**
 * True only when the X intel queue is genuinely empty (no rows at all, status filter "ALL") —
 * never when a specific status filter (e.g. "SKIP") simply has zero matches this cycle while
 * other statuses have real rows. The two are different claims: "nothing has ever been generated"
 * vs "nothing in this bucket right now" — conflating them would show fixture rows (mixed statuses,
 * not live data) labeled "No queue rows yet" under a filter the admin explicitly chose, which is
 * exactly the kind of absence-mislabeling AdminXIntelQueuePanel's own design rules exist to prevent.
 */
export function shouldShowXIntelFixtures(
  status: string,
  rows: XIntelQueueRow[] | null
): boolean {
  return status === "ALL" && rows != null && rows.length === 0;
}
