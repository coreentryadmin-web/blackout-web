import { clsx } from "clsx";

export function BriefingScoreBar({
  label,
  value,
  max = 100,
  tone = "gold",
}: {
  label: string;
  value: number;
  max?: number;
  tone?: "gold" | "green" | "sky";
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="nh-v2-score-bar">
      <div className="nh-v2-score-bar-head">
        <span className="nh-v2-score-bar-label">{label}</span>
        <span className={clsx("nh-v2-score-bar-value", `nh-v2-score-bar-value--${tone}`)}>{value}</span>
      </div>
      <div className="nh-v2-score-bar-track" aria-hidden>
        <div
          className={clsx("nh-v2-score-bar-fill", `nh-v2-score-bar-fill--${tone}`)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
