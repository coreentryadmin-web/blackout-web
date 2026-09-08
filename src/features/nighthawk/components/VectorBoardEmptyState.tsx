"use client";

import { clsx } from "clsx";

/** Desk-theme-aware empty state for Vector board rows. */
export function VectorBoardEmptyState({
  title,
  description,
  className,
}: {
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={clsx("vector-board-empty-state", className)}>
      <h3 className="vector-board-empty-state-title">{title}</h3>
      {description ? <p className="vector-board-empty-state-copy">{description}</p> : null}
    </div>
  );
}
