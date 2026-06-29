"use client";

import type { NightHawkRecordResponse } from "@/lib/nighthawk/types";

type HawkRecordStripProps = {
  record: NightHawkRecordResponse | undefined;
  loading?: boolean;
};

export function HawkRecordStrip({ record, loading }: HawkRecordStripProps) {
  if (loading) {
    return (
      <div className="nighthawk-record-strip" role="status">
        <span className="nighthawk-record-label">Hawk record</span>
        <span className="nighthawk-record-value">Loading…</span>
      </div>
    );
  }

  if (!record?.available || record.total_resolved === 0) {
    return (
      <div className="nighthawk-record-strip" role="status">
        <span className="nighthawk-record-label">Hawk record</span>
        <span className="nighthawk-record-value">
          Building — outcomes resolve after each session
          {record?.pending_count ? ` · ${record.pending_count} pending` : ""}
        </span>
      </div>
    );
  }

  const topConv = record.by_conviction[0];

  return (
    <div className="nighthawk-record-strip" role="status">
      <span className="nighthawk-record-label">Hawk record · {record.window_days}d</span>
      <span className="nighthawk-record-value">
        {record.total_resolved} resolved · {record.win_rate_pct}% target hit ·{" "}
        {record.profitable_rate_pct}% profitable · avg {record.avg_return_pct >= 0 ? "+" : ""}
        {record.avg_return_pct}%
        {topConv ? ` · ${topConv.conviction} ${topConv.win_rate_pct}% (${topConv.n}n)` : ""}
      </span>
    </div>
  );
}
