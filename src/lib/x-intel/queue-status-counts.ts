import type { XIntelQueueRow } from "@/lib/x-intel/queue-types";

/**
 * Tallies the status chip counts (ready/review/skip) over the rows actually RENDERED below them.
 * Must be called with the same array the panel displays — including the fixture substitution —
 * never with the raw API `rows` alone. Counting from `rows` while rendering fixture cards (when
 * the real queue is genuinely empty) produces a visible self-contradiction: the chip bar reads
 * "ready 0 · review 0 · skip 0" while fixture cards with real READY/REVIEW/SKIP badges render
 * underneath it, the exact kind of mismatch this queue's own design rules exist to prevent.
 */
export function computeXIntelStatusCounts(display: XIntelQueueRow[]): {
  READY: number;
  REVIEW: number;
  SKIP: number;
} {
  return {
    READY: display.filter((r) => r.status === "READY").length,
    REVIEW: display.filter((r) => r.status === "REVIEW").length,
    SKIP: display.filter((r) => r.status === "SKIP").length,
  };
}
