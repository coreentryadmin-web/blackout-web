/** Shared recharts custom-dot factory — only the LAST point in a series gets a visible dot (an
 *  emphasized endpoint), not one on every tick, which reads as noise on a line already drawing
 *  the full shape. Used by every Night Hawk area chart (NighthawkSessionPnlChart,
 *  PlayMarkHistoryChart) so the "one dot at the end" treatment stays a single implementation,
 *  not two copies that can drift. Recharts calls this once per data point and passes that
 *  point's own array index. */
export function makeEndpointDot(color: string, lastIndex: number) {
  return function EndpointDot(props: { cx?: number; cy?: number; index?: number }) {
    const { cx, cy, index } = props;
    if (cx == null || cy == null || index !== lastIndex) return <g key={index} />;
    return <circle key={index} cx={cx} cy={cy} r={3.5} fill={color} stroke="none" />;
  };
}
