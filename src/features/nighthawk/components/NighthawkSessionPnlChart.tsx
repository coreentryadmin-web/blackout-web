"use client";

// The ONLY recharts importer for the analytics panel — split out so the (large) recharts
// bundle is code-split via next/dynamic at the import site, same pattern as
// helix/components/DarkPoolSpark.tsx. Renders the cumulative same-session P&L shape from
// analytics-panel.ts's `sessionPnlCurve` — real data, dynamic re-render on every SWR tick as
// plays resolve through the session (a number changing here is an actual re-fetch, not a
// decorative animation).
import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import type { PnlCurvePoint } from "@/features/nighthawk/lib/analytics-panel";

function CurveTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: PnlCurvePoint }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="nh-analytics-tooltip">
      <div className="nh-analytics-tooltip-ticker">{p.ticker}</div>
      <div>
        this play {p.pnl_pct >= 0 ? "+" : ""}
        {p.pnl_pct}%
      </div>
      <div>
        cumulative {p.cumulative_pct >= 0 ? "+" : ""}
        {p.cumulative_pct}%
      </div>
    </div>
  );
}

/** Only the LAST point gets a visible dot — an emphasized endpoint (today's running total),
 *  not a dot on every session tick, which just adds noise to a line already showing the full
 *  shape. Recharts calls this once per data point and passes that point's own array index. */
function makeEndpointDot(color: string, lastIndex: number) {
  return function EndpointDot(props: { cx?: number; cy?: number; index?: number }) {
    const { cx, cy, index } = props;
    if (cx == null || cy == null || index !== lastIndex) return <g key={index} />;
    return <circle key={index} cx={cx} cy={cy} r={3.5} fill={color} stroke="none" />;
  };
}

export function NighthawkSessionPnlChart({ points }: { points: PnlCurvePoint[] }) {
  const last = points[points.length - 1];
  // Bull/bear tokens match .nh-deck's --dk-bull/--dk-bear (globals.css) — the same
  // win/loss palette used everywhere else on the desk, not a chart-local color.
  const color = (last?.cumulative_pct ?? 0) >= 0 ? "#00D9A3" : "#F0637C";
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="nhSessionPnlGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <ReferenceLine y={0} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
        <XAxis dataKey="ticker" tick={{ fill: "#9A9FAB", fontSize: 10 }} axisLine={false} tickLine={false} interval={0} />
        <YAxis hide domain={["auto", "auto"]} />
        <Tooltip content={<CurveTooltip />} cursor={{ stroke: "rgba(154,159,171,0.25)" }} />
        <Area
          type="monotone"
          dataKey="cumulative_pct"
          stroke={color}
          strokeWidth={2}
          fill="url(#nhSessionPnlGrad)"
          dot={makeEndpointDot(color, points.length - 1)}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export default NighthawkSessionPnlChart;
