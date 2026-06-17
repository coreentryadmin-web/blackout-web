"use client";

import { clsx } from "clsx";

export function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

export function WinRateRing({
  value,
  label,
  sub,
  tone = "bull",
  size = 120,
}: {
  value: number;
  label: string;
  sub?: string;
  tone?: "bull" | "bear" | "violet" | "cyan" | "amber";
  size?: number;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const stroke = Math.round(size * 0.08);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - clamped);

  return (
    <div className={clsx("admin-ring", `admin-ring-${tone}`)}>
      <svg width={size} height={size} className="admin-ring-svg">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="admin-ring-track"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="admin-ring-progress"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="admin-ring-center">
        <span className="admin-ring-value">{pct(clamped)}</span>
        <span className="admin-ring-label">{label}</span>
        {sub && <span className="admin-ring-sub">{sub}</span>}
      </div>
    </div>
  );
}

export function MegaStat({
  label,
  value,
  sub,
  tone = "neutral",
  trend,
  bar,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "bull" | "bear" | "violet" | "cyan" | "amber" | "neutral";
  trend?: "up" | "down" | "flat";
  bar?: number;
}) {
  return (
    <div className={clsx("admin-mega-stat", `admin-mega-stat-${tone}`)}>
      <div className="admin-mega-stat-glow" aria-hidden />
      <p className="admin-mega-stat-label">{label}</p>
      <div className="admin-mega-stat-row">
        <p className="admin-mega-stat-value">{value}</p>
        {trend && (
          <span className={clsx("admin-mega-trend", `admin-mega-trend-${trend}`)}>
            {trend === "up" ? "▲" : trend === "down" ? "▼" : "—"}
          </span>
        )}
      </div>
      {sub && <p className="admin-mega-stat-sub">{sub}</p>}
      {bar != null && (
        <div className="admin-mega-bar">
          <div className="admin-mega-bar-fill" style={{ width: `${Math.min(100, Math.max(0, bar))}%` }} />
        </div>
      )}
    </div>
  );
}

export function GlassPanel({
  title,
  children,
  className,
  accent = "bull",
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
  accent?: "bull" | "bear" | "violet" | "cyan" | "amber";
}) {
  return (
    <section className={clsx("admin-glass", `admin-glass-${accent}`, className)}>
      {title && <h3 className="admin-glass-title">{title}</h3>}
      {children}
    </section>
  );
}

export function LivePill({ label, active = true }: { label: string; active?: boolean }) {
  return (
    <span className={clsx("admin-live-pill", active && "admin-live-pill-on")}>
      <span className="admin-live-pill-dot" />
      {label}
    </span>
  );
}

export function ActionButton({
  children,
  onClick,
  disabled,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx("admin-action-btn", `admin-action-btn-${variant}`)}
    >
      {children}
    </button>
  );
}
