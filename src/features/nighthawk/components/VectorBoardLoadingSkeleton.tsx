"use client";

import { Skeleton } from "@/components/ui";

/** Board-shaped loading placeholder — toolbar, calendar chips, table rows. */
export function VectorBoardLoadingSkeleton() {
  return (
    <div className="vector-board-shell vector-board-shell--loading" aria-busy="true" aria-label="Loading Vector board">
      <div className="vector-board-skeleton-toolbar">
        <div className="vector-board-skeleton-tabs">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-20" />
        </div>
        <Skeleton className="h-8 w-44" />
      </div>
      <div className="vector-board-skeleton-controls">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-36" />
      </div>
      <div className="vector-board-skeleton-cal">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-[52px] shrink-0 rounded-lg" />
        ))}
      </div>
      <div className="vector-board-body vector-board-body--split min-h-0 flex-1">
        <div className="vector-board-table-pane min-h-0 flex-1">
          <div className="vector-board-panel min-h-0 flex-1">
            <div className="vector-board-skeleton-rows">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          </div>
        </div>
        <div className="vector-board-detail vector-board-detail--empty hidden min-h-0 md:flex">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-4 h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
