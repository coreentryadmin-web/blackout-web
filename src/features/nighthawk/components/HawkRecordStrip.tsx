"use client";

import type { NightHawkRecordResponse, NightHawkRecordSegmentWire } from "@/features/nighthawk/lib/types";
import { TRACK_RECORD_MIN_SAMPLE } from "@/components/track-record/format";
// Shared platform LOW-N threshold — amber-chip grammar for thin evidence samples.
import { LOW_N_THRESHOLD } from "@/lib/zerodte/record";
import { GRADE_METHODOLOGY_CURRENT } from "@/features/nighthawk/lib/grade-methodology";
import {
  TARGET_HIT_RATE_LABEL,
  targetHitCompositionLabel,
} from "@/features/nighthawk/lib/nighthawk-view";

type HawkRecordStripProps = {
  record: NightHawkRecordResponse | undefined;
  loading?: boolean;
};

/** Signed percent, so a negative return never renders as a bare number that reads as a gain. */
function fmtSignedPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v}%`;
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="nighthawk-metric-pill">
      <span className="nighthawk-metric-pill-label">{label}</span>
      <span className="nighthawk-metric-pill-value">{value}</span>
    </span>
  );
}

/** Same visual grammar as the 0DTE record section's LowNChip (ZeroDteBoard.tsx) — amber,
 *  mono, explicit threshold. Duplicated rather than imported: that chip is a private
 *  detail of a 1000+-line client board, and the styling contract (gold/amber, n<THRESHOLD
 *  copy) is what's shared, not the component instance. */
function LowNChip() {
  return (
    <span
      className="rounded-md border border-gold/35 bg-gold/[0.08] px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-gold"
      title={`Fewer than ${LOW_N_THRESHOLD} scoreable plays under current grading rules — not enough samples to read as a track record`}
    >
      n&lt;{LOW_N_THRESHOLD}
    </span>
  );
}

/** Compact methodology tag, e.g. "v2_fillability" → "v2 · fill-required". */
function MethodologyTag({ methodology }: { methodology: string }) {
  const short = methodology === GRADE_METHODOLOGY_CURRENT ? "v2 · fill-required" : methodology;
  return (
    <span
      className="rounded-md border border-sky-400/30 bg-sky-400/[0.1] px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-sky-100"
      title="Grading methodology of the headline record. Plays graded under superseded rules are reported separately and never blended in."
    >
      {short}
    </span>
  );
}

/** The counts that explain the headline denominator — always shown when non-zero:
 *  unfilled (gap-away, no fill existed), pulled (withdrawn pre-open by the morning
 *  confirm), and the legacy segment (grades from superseded rules, quarantined). */
function honestSplitParts(
  cur: NightHawkRecordSegmentWire,
  legacy: NightHawkRecordSegmentWire,
  pendingCount: number
): string[] {
  const parts: string[] = [];
  if (cur.unfilled > 0) parts.push(`${cur.unfilled} unfilled`);
  if (cur.pulled > 0) parts.push(`${cur.pulled} pulled`);
  if (cur.stop_data_unavailable > 0) parts.push(`${cur.stop_data_unavailable} ungradeable`);
  if (pendingCount > 0) parts.push(`${pendingCount} pending`);
  if (legacy.resolved > 0) parts.push(`${legacy.resolved} legacy-graded (reported separately)`);
  return parts;
}

export function HawkRecordStrip({ record, loading }: HawkRecordStripProps) {
  if (loading) {
    return (
      <div className="nighthawk-record-strip" role="status">
        <span className="nighthawk-record-label">Hawk record</span>
        <span className="nighthawk-record-value">Syncing outcomes…</span>
      </div>
    );
  }

  const segments = record?.segments;
  const cur = segments?.current;
  const legacy = segments?.legacy;

  // Gate ratio stats behind the shared minimum sample, not just zero: a strip showing
  // "Target hit 0%" (or 100%) off a handful of resolved plays reads as a confident
  // record when it's noise. Same threshold as the track-record page's SPX card, so the
  // two products apply one disclosure standard (audit MEDIUM: NH showed raw tiny-sample
  // stats while SPX gated behind "Collecting data").
  //
  // PR-N2: the sample that counts toward the gate is the CURRENT-methodology scoreable
  // sample — legacy-graded rows can't ripen the record any more than they can move its
  // win rate. (Fallback to total_resolved only for a stale cached payload without
  // segments.)
  const gateSample = cur ? cur.scoreable : record?.total_resolved ?? 0;
  if (!record?.available || gateSample < TRACK_RECORD_MIN_SAMPLE) {
    const splitParts = cur && legacy ? honestSplitParts(cur, legacy, record?.pending_count ?? 0) : [];
    return (
      <div className="nighthawk-record-strip" role="status">
        <span className="nighthawk-record-label">Hawk record</span>
        <span className="nighthawk-record-value">
          Building track record — outcomes resolve after each session
          {` · ${gateSample}/${TRACK_RECORD_MIN_SAMPLE} scoreable`}
          {splitParts.length > 0 ? ` · ${splitParts.join(" · ")}` : ""}
          {!cur && record?.pending_count ? ` · ${record.pending_count} pending` : ""}
        </span>
        {cur && cur.low_n && <LowNChip />}
        {record?.methodology && <MethodologyTag methodology={record.methodology} />}
      </div>
    );
  }

  return (
    <div className="nighthawk-record-strip" role="status">
      <span className="nighthawk-record-label">{record.window_days}d track record</span>
      <div className="nighthawk-record-metrics">
        <MetricPill label="Scoreable" value={String(cur ? cur.scoreable : record.total_resolved)} />
        {/* NAME THE METRIC FOR WHAT IT IS (2026-08-06). This lane's "win" is strictly a
            TARGET TOUCH inside the one-session grading horizon (play-outcomes.ts
            resolveOutcome → analytics.ts winRate, `outcome === "target"`); a play that
            closed green without trading to its target is an `open`, not a win. Calling
            that a plain "win rate" invites the reading that everything else lost. Show
            the composition beside it so the denominator is never a mystery. */}
        {cur && (
          <MetricPill
            label={TARGET_HIT_RATE_LABEL}
            value={`${record.win_rate_pct}% · ${targetHitCompositionLabel(cur)}`}
          />
        )}
        {/* FILL-EDGE basis as primary — members fill at the band edge, not its midpoint,
            and the gap is the ATR-scaled band half-width (~+1.12pp per play in the mid
            figure's favour). Mid is retained in the same pill for one window so the
            historical series stays comparable; falls back to mid alone on a stale cache. */}
        <MetricPill
          label="Profitable"
          value={
            record.profitable_rate_edge_pct != null
              ? `${record.profitable_rate_edge_pct}% (mid ${record.profitable_rate_pct}%)`
              : `${record.profitable_rate_pct}%`
          }
        />
        <MetricPill
          label="Avg return"
          value={
            record.avg_return_pct_edge != null
              ? `${fmtSignedPct(record.avg_return_pct_edge)} (mid ${fmtSignedPct(record.avg_return_pct)})`
              : fmtSignedPct(record.avg_return_pct)
          }
        />
        {/* PR-N2 honest split: the exclusions that explain the denominator, and the
            quarantined legacy segment — visible, labeled, never inside the numbers above. */}
        {cur && cur.unfilled > 0 && <MetricPill label="Unfilled" value={String(cur.unfilled)} />}
        {cur && cur.pulled > 0 && <MetricPill label="Pulled" value={String(cur.pulled)} />}
        {legacy && legacy.resolved > 0 && (
          <MetricPill label="Legacy-graded" value={`${legacy.resolved} (separate)`} />
        )}
      </div>
      {cur && cur.low_n && <LowNChip />}
      {record.methodology && <MethodologyTag methodology={record.methodology} />}
    </div>
  );
}
