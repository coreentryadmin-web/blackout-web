"use client";

import { clsx } from "clsx";
import type { VectorBoardStatus } from "@/features/nighthawk/lib/vector-board-table-utils";

const STATUS_CLASS: Record<VectorBoardStatus, string> = {
  open: "is-open",
  runner: "is-open",
  winner: "is-open",
  caution: "is-neutral",
  closed: "is-closed",
  invalidated: "is-closed",
};

/** X Ads–style delivery status: colored dot + label, no heavy pill chrome. */
export function VectorBoardStatusPill({
  status,
  label,
  className,
}: {
  status: VectorBoardStatus;
  label: string;
  className?: string;
}) {
  return (
    <span className={clsx("vector-board-status", STATUS_CLASS[status], className)}>
      <span className="vector-board-status-dot" aria-hidden />
      <span className="vector-board-status-label">{label}</span>
    </span>
  );
}
