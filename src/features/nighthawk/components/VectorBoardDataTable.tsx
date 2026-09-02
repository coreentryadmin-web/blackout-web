"use client";

import type { ReactNode, Ref } from "react";
import { useMemo } from "react";
import { clsx } from "clsx";
import { VectorBoardEmptyState } from "@/features/nighthawk/components/VectorBoardEmptyState";
import { computeBoardColumnWidths } from "@/features/nighthawk/lib/vector-board-column-layout";

export type VectorBoardTableColumn<TRow, TCtx = unknown> = {
  key: string;
  colClass: string;
  thClass: string;
  header: ReactNode;
  ariaSort?: "none" | "ascending" | "descending";
  onHeaderClick?: () => void;
  headerTitle?: string;
  renderCell: (row: TRow, ctx: TCtx) => ReactNode;
};

export function VectorBoardDataTable<TRow extends { key: string }, TCtx = unknown>({
  columns,
  rows,
  getRowCtx,
  selectedKey,
  onSelectRow,
  emptyTitle,
  emptyDescription,
  tableRef,
  rowClassName,
}: {
  columns: VectorBoardTableColumn<TRow, TCtx>[];
  rows: TRow[];
  getRowCtx: (row: TRow, index: number) => TCtx;
  selectedKey: string | null;
  onSelectRow: (row: TRow, index: number) => void;
  emptyTitle: string;
  emptyDescription: string;
  tableRef?: Ref<HTMLDivElement>;
  rowClassName?: (row: TRow, index: number) => string | undefined;
}) {
  const visibleColumnCount = Math.max(columns.length, 1);
  const colWidths = useMemo(() => computeBoardColumnWidths(columns.map((c) => c.key)), [columns]);

  return (
    <div className="vector-board-tablewrap" ref={tableRef}>
      <table className="vector-board-table">
        <colgroup>
          {columns.map((column, i) => (
            <col key={column.key} className={column.colClass} style={{ width: colWidths[i] }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={column.thClass}
                aria-sort={column.ariaSort}
                aria-label={column.key === "compare" ? "Compare" : undefined}
                title={column.headerTitle}
                onClick={column.onHeaderClick}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!rows.length ? (
            <tr className="vector-board-empty-row">
              <td colSpan={visibleColumnCount}>
                <div className="vector-board-empty">
                  <VectorBoardEmptyState title={emptyTitle} description={emptyDescription} />
                </div>
              </td>
            </tr>
          ) : (
            rows.map((row, index) => {
              const selected = selectedKey === row.key;
              const rowCtx = getRowCtx(row, index);
              return (
                <tr
                  key={row.key}
                  className={clsx(
                    "vector-board-row",
                    selected && "is-selected",
                    rowClassName?.(row, index)
                  )}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onSelectRow(row, index)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectRow(row, index);
                    }
                  }}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={column.colClass}
                      onClick={column.key === "compare" ? (e) => e.stopPropagation() : undefined}
                    >
                      {column.renderCell(row, rowCtx)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
