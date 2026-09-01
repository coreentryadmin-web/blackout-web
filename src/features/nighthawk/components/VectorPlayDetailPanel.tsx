"use client";

import Link from "next/link";
import { useState } from "react";
import { clsx } from "clsx";
import { VectorBoardMeter } from "@/features/nighthawk/components/VectorBoardMeter";
import { VectorBoardStatusPill } from "@/features/nighthawk/components/VectorBoardStatus";
import { VectorPremiumSparkline } from "@/features/nighthawk/components/VectorPremiumSparkline";
import {
  vectorBoardTimeline,
  vectorBoardTradeTicket,
} from "@/features/nighthawk/lib/vector-board-row-utils";
import type { VectorBoardTableRow } from "@/features/nighthawk/lib/vector-board-table-utils";
import { formatPremiumPct, premiumPctTone, vectorBoardMeter } from "@/features/nighthawk/lib/vector-board-table-utils";
import { etDateTimeShort } from "@/lib/et-clock";

const EM = "—";

function fmtPrice(v: number | null): string {
  return v != null && Number.isFinite(v) ? `$${v.toFixed(2)}` : EM;
}

function fmtTime(iso: string): string {
  if (!iso) return EM;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EM;
  return etDateTimeShort(d) ?? EM;
}

function pnlClass(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "is-flat";
  if (pct > 0) return "is-up";
  if (pct < 0) return "is-down";
  return "is-flat";
}

function DetailMetric({
  label,
  value,
  bold,
  tone,
}: {
  label: string;
  value: string;
  bold?: boolean;
  tone?: "up" | "down" | "flat";
}) {
  return (
    <div className="vector-board-detail-metric">
      <span className="vector-board-detail-metric-label">{label}</span>
      <span
        className={clsx(
          "vector-board-detail-metric-value tabular-nums",
          bold && "is-bold",
          tone && `is-${tone}`
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function VectorPlayDetailPanel({
  row,
  onClose,
}: {
  row: VectorBoardTableRow | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!row) {
    return (
      <aside className="vector-board-detail vector-board-detail--empty" aria-label="Play detail">
        <p className="vector-board-detail-empty-title">Select a pick</p>
        <p className="vector-board-detail-empty-copy">
          Click any row to inspect contract, premium path, and desk reason — same drill-down model as
          the X Ads campaign inspector. Use ↑/↓ to navigate, / to search.
        </p>
      </aside>
    );
  }

  const pctTone = premiumPctTone(row.premiumPct);
  const timeline = vectorBoardTimeline(row);

  const copyTicket = async () => {
    const text = vectorBoardTradeTicket(row);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <aside className="vector-board-detail" aria-label={`${row.ticker} play detail`}>
      <div className="vector-board-detail-head">
        <div className="vector-board-detail-titleblock">
          <h2 className="vector-board-detail-ticker">{row.ticker}</h2>
          <p className="vector-board-detail-contract">{row.contractLabel}</p>
          <p className="vector-board-detail-id">OCC {row.occ}</p>
        </div>
        <button type="button" className="vector-board-detail-close" onClick={onClose} aria-label="Close detail">
          ×
        </button>
      </div>

      <div className="vector-board-detail-status-row">
        <VectorBoardStatusPill status={row.status} label={row.statusLabel} />
        {row.tier === "elite" ? <span className="vector-board-detail-tag">Elite</span> : null}
        {row.rank != null ? <span className="vector-board-detail-tag">Rank #{row.rank}</span> : null}
      </div>

      <div className="vector-board-detail-hero">
        <span className="vector-board-detail-hero-label">Premium vs entry</span>
        <span
          className={clsx(
            "vector-board-detail-hero-value tabular-nums",
            pctTone === "bull" && "is-up",
            pctTone === "bear" && "is-down",
            pctTone === "sky" && "is-flat"
          )}
        >
          {formatPremiumPct(row.premiumPct)}
        </span>
      </div>

      <div className="vector-board-detail-spark-wrap">
        <span className="vector-board-detail-reason-label">Premium path</span>
        <VectorPremiumSparkline row={row} />
      </div>

      <div className="vector-board-detail-grid">
        <DetailMetric label="Session" value={row.sessionDate} />
        <DetailMetric label="Updated" value={fmtTime(row.timestamp)} />
        <DetailMetric label="Entry mid" value={fmtPrice(row.entryMid)} bold />
        <DetailMetric label={row.kind === "closed" ? "Close mid" : "Live mid"} value={fmtPrice(row.markMid)} bold />
        <DetailMetric
          label="Peak"
          value={formatPremiumPct(row.peakPct)}
          tone={pnlClass(row.peakPct) === "is-up" ? "up" : pnlClass(row.peakPct) === "is-down" ? "down" : "flat"}
        />
        {row.progressPct != null ? <DetailMetric label="Of peak" value={`${row.progressPct}%`} /> : null}
      </div>

      <div className="vector-board-detail-meter-block">
        <span className="vector-board-detail-reason-label">Progress meter</span>
        <VectorBoardMeter meter={vectorBoardMeter(row)} />
      </div>

      <div className="vector-board-detail-timeline">
        <span className="vector-board-detail-reason-label">Timeline</span>
        <ol className="vector-board-detail-timeline-list">
          {timeline.map((evt, i) => (
            <li key={`${evt.at}-${i}`} className={clsx("vector-board-detail-timeline-item", evt.tone && `is-${evt.tone}`)}>
              <span className="vector-board-detail-timeline-time">{fmtTime(evt.at)}</span>
              <span className="vector-board-detail-timeline-label">{evt.label}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="vector-board-detail-reason">
        <span className="vector-board-detail-reason-label">Desk read</span>
        <p className="vector-board-detail-reason-copy">{row.reason || EM}</p>
      </div>

      <div className="vector-board-detail-actions">
        <button type="button" className="vector-board-detail-action" onClick={copyTicket}>
          {copied ? "Copied" : "Copy ticket"}
        </button>
        <Link href={`/vector?ticker=${encodeURIComponent(row.ticker)}`} className="vector-board-detail-action">
          Open in Vector
        </Link>
      </div>
    </aside>
  );
}
