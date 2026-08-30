"use client";

// Split out for the same reason as NighthawkSessionPnlChart.tsx — code-split the recharts bundle
// via next/dynamic at the import site. Renders a REAL continuous mark history for one committed
// 0DTE play, from actual Polygon minute bars (GET /api/market/nighthawk/play-bars) since entry —
// built specifically because drawing a smooth line through the play's few known SNAPSHOT points
// (entry/peak/trough/current) would imply a price path nothing measured. See that route's own
// header comment for the fuller rationale. ZERO_DTE only: a Swing/LEAPS/Legacy hold spans days,
// which needs a daily-bar series (a different endpoint/shape) this component does not fetch —
// callers must not render it for a multi-day horizon.
import useSWR from "swr";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import { makeEndpointDot } from "@/features/nighthawk/lib/recharts-endpoint-dot";

type PlayBarsResponse = { occ: string; since: string; points: Array<{ t: string; c: number }> };

async function fetchPlayBars(occ: string, since: string): Promise<PlayBarsResponse> {
  const res = await fetch(
    `/api/market/nighthawk/play-bars?occ=${encodeURIComponent(occ)}&since=${encodeURIComponent(since)}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(`play-bars ${res.status}`);
  return res.json() as Promise<PlayBarsResponse>;
}

function MarkHistoryTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { t: string; pct: number; mark: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(p.t));
  return (
    <div className="nh-analytics-tooltip">
      <div className="nh-analytics-tooltip-ticker">{clock} ET</div>
      <div>
        ${p.mark.toFixed(2)} · {p.pct >= 0 ? "+" : ""}
        {p.pct.toFixed(1)}%
      </div>
    </div>
  );
}

/** Real mark-history chart for one committed 0DTE play — entry through the latest polled minute
 *  bar, plotted as % return off the real entry premium. Degrades to nothing (never a fabricated
 *  or placeholder chart) on a load error, too few real bars to draw a line, or a non-positive
 *  entry (percent-off-entry is meaningless against a $0 or negative basis, which shouldn't occur
 *  but is guarded rather than trusted). */
export function PlayMarkHistoryChart({
  occ,
  since,
  entry,
}: {
  occ: string | null | undefined;
  since: string | null | undefined;
  entry: number | null | undefined;
}) {
  const key = occ && since ? (["play-bars", occ, since] as const) : null;
  const { data, error, isLoading } = useSWR(key, () => fetchPlayBars(occ!, since!), {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  if (!key) return null;
  if (isLoading) return <div className="nh-deck-recnote">Loading mark history…</div>;
  if (error || !data || entry == null || !(entry > 0)) return null;

  const pts = data.points.map((p) => ({ t: p.t, mark: p.c, pct: ((p.c - entry) / entry) * 100 }));
  if (pts.length < 2) return null; // too early in the play's life for a real line — honest absence, not a stub chart

  const last = pts[pts.length - 1]!;
  const color = last.pct >= 0 ? "#00D9A3" : "#F0637C";

  return (
    <div className="nh-deck-mark-history">
      <div className="nh-deck-lab">Mark history</div>
      <ResponsiveContainer width="100%" height={90}>
        <AreaChart data={pts} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="nhPlayMarkGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
          <XAxis dataKey="t" hide />
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip content={<MarkHistoryTooltip />} cursor={{ stroke: "rgba(154,159,171,0.25)" }} />
          <Area
            type="monotone"
            dataKey="pct"
            stroke={color}
            strokeWidth={2}
            fill="url(#nhPlayMarkGrad)"
            dot={makeEndpointDot(color, pts.length - 1)}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="nh-deck-recnote">Real Polygon minute bars for this contract since entry — {pts.length} bars.</div>
    </div>
  );
}

export default PlayMarkHistoryChart;
