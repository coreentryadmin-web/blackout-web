"use client";

import Link from "next/link";
import type {
  MeridianEarningsPrint,
  MeridianEventKind,
  MeridianTimelineItem,
} from "@/features/meridian/lib/meridian-types";
import { reactionQualifier } from "@/features/meridian/lib/meridian-reaction-display";

/**
 * The qualifier badge beside a displayed reaction — renders nothing for the common case.
 *
 * One component rather than three copies: the reaction is printed at three render sites and all
 * three omitted this, so a per-site fix would leave the fourth site free to omit it again.
 */
export function ReactionFlag({ print }: { print: MeridianEarningsPrint }) {
  const q = reactionQualifier(print);
  if (!q) return null;
  return (
    <span className="meridian-reaction-flag" title={q.title}>
      {q.mark}
    </span>
  );
}

export const KIND_THEME: Record<
  MeridianEventKind,
  { label: string; accent: string; glow: string; chip: string }
> = {
  macro: {
    label: "Macro",
    accent: "meridian-theme-macro",
    glow: "rgba(34, 211, 238, 0.35)",
    chip: "Macro",
  },
  earnings: {
    label: "Earnings",
    accent: "meridian-theme-earnings",
    glow: "rgba(56, 189, 248, 0.35)",
    chip: "Earnings",
  },
  fda: {
    label: "FDA",
    accent: "meridian-theme-fda",
    glow: "rgba(167, 139, 250, 0.35)",
    chip: "FDA",
  },
  opex: {
    label: "OpEx",
    accent: "meridian-theme-opex",
    glow: "rgba(52, 211, 153, 0.35)",
    chip: "OpEx",
  },
};

export function kindTheme(kind: MeridianEventKind | string) {
  return KIND_THEME[kind as MeridianEventKind] ?? KIND_THEME.macro;
}

type StatProps = {
  value: string | number;
  label: string;
  tone?: "cyan" | "amber" | "violet" | "emerald" | "rose";
  delay?: number;
};

export function MeridianStatCard({ value, label, tone = "cyan", delay = 0 }: StatProps) {
  return (
    <div
      className={`meridian-stat-card meridian-stat-tone-${tone}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="meridian-stat-card-glow" aria-hidden="true" />
      <span className="meridian-stat-card-value">{value}</span>
      <span className="meridian-stat-card-label">{label}</span>
    </div>
  );
}

type AnalyticsBannerProps = {
  label: string;
  headline: string;
  sub?: string | null;
  tone?: MeridianEventKind | "default";
  icon?: string;
};

export function MeridianAnalyticsBanner({
  label,
  headline,
  sub,
  tone = "default",
  icon = "◈",
}: AnalyticsBannerProps) {
  const theme = tone === "default" ? null : kindTheme(tone);
  return (
    <div
      className={`meridian-analytics-banner${theme ? ` ${theme.accent}` : ""}`}
    >
      <div className="meridian-analytics-banner-scan" aria-hidden="true" />
      <span className="meridian-analytics-banner-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="meridian-analytics-banner-body">
        <p className="meridian-analytics-banner-label">{label}</p>
        <p className="meridian-analytics-banner-headline">{headline}</p>
      </div>
      {/* The value moves to the RIGHT EDGE instead of stacking under the headline. These banners
          ran a short line of text down the left and left two thirds of the row blank; the
          readout is the thing a reader is looking for, so it gets the space and the weight. */}
      {sub && <p className="meridian-analytics-banner-sub">{sub}</p>}
    </div>
  );
}

type DataCardProps = {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
  tone?: MeridianEventKind;
  delay?: number;
};

export function MeridianDataCard({ label, children, wide, tone, delay = 0 }: DataCardProps) {
  const theme = tone ? kindTheme(tone) : null;
  return (
    <section
      className={`meridian-data-card${wide ? " meridian-data-card-wide" : ""}${theme ? ` ${theme.accent}` : ""}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <header className="meridian-data-card-head">
        <span className="meridian-data-card-dot" aria-hidden="true" />
        <h3 className="meridian-data-card-label">{label}</h3>
      </header>
      <div className="meridian-data-card-body">{children}</div>
    </section>
  );
}

type FilterProps = {
  id: string;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  tone?: string;
};

export function MeridianFilterPill({ label, count, active, onClick, tone }: FilterProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`meridian-filter-pill${active ? " is-active" : ""}${tone ? ` ${tone}` : ""}`}
      onClick={onClick}
    >
      <span className="meridian-filter-pill-label">{label}</span>
      {count != null && <span className="meridian-filter-pill-count">{count}</span>}
    </button>
  );
}

type TimelineRowProps = {
  item: MeridianTimelineItem;
  active: boolean;
  onBoard: boolean;
  index: number;
  onSelect: () => void;
};

export function MeridianTimelineRow({ item, active, onBoard, index, onSelect }: TimelineRowProps) {
  const theme = kindTheme(item.kind);
  return (
    <li className="meridian-timeline-item" style={{ animationDelay: `${Math.min(index * 40, 400)}ms` }}>
      <button
        type="button"
        className={`meridian-timeline-row ${theme.accent}${active ? " is-active" : ""}`}
        onClick={onSelect}
      >
        {active && <span className="meridian-timeline-row-beam" aria-hidden="true" />}
        <span className="meridian-timeline-row-top">
          <span className="meridian-timeline-kind">{theme.chip}</span>
          <span className={`meridian-timeline-impact impact-${item.impact}`}>
            {item.impact === "high" ? "High" : item.impact === "medium" ? "Med" : "Low"}
          </span>
          <span className="meridian-timeline-days">
            {item.days_until === 0 ? "Today" : `${item.days_until}d`}
          </span>
        </span>
        <span className="meridian-timeline-title">{item.title}</span>
        <span className="meridian-timeline-meta">
          {item.date}
          {item.time ? ` · ${item.time} ET` : ""}
          {item.kind === "earnings" && item.date_status === "confirmed" ? " · confirmed" : ""}
          {item.kind === "earnings" && item.date_status === "projected" ? " · projected" : ""}
          {item.kind === "earnings" && item.is_printed ? " · printed" : ""}
          {item.kind === "earnings" && item.importance != null && item.importance >= 4
            ? ` · imp ${item.importance}`
            : ""}
          {onBoard ? " · board" : ""}
        </span>
      </button>
    </li>
  );
}

type ActionDockProps = {
  item: MeridianTimelineItem;
  boardTickers: string[];
};

export function MeridianActionDock({ item, boardTickers }: ActionDockProps) {
  const ticker = item.ticker?.toUpperCase();
  const onBoard = ticker ? boardTickers.includes(ticker) : false;
  const theme = kindTheme(item.kind);

  return (
    <nav className={`meridian-action-dock ${theme.accent}`} aria-label="Cross-tool navigation">
      <p className="meridian-action-dock-label">Jump to desk</p>
      <p className="meridian-action-dock-hint">
        Thermal, HELIX, Vector, Night Hawk, and SPX previews render inline on Positioning when live
        data is available.
      </p>
      <div className="meridian-action-dock-row">
        {!ticker && (
          <>
            <Link href="/dashboard" className="meridian-dock-btn meridian-dock-btn-primary">
              SPX desk
            </Link>
            <Link href="/heatmap?ticker=SPX" className="meridian-dock-btn">
              Thermal · SPX
            </Link>
            <Link href="/flows?ticker=SPX" className="meridian-dock-btn">
              HELIX · SPX
            </Link>
          </>
        )}
        {ticker && (
          <>
            <Link href={`/vector?ticker=${encodeURIComponent(ticker)}`} className="meridian-dock-btn">
              Vector · {ticker}
            </Link>
            <Link href={`/heatmap?ticker=${encodeURIComponent(ticker)}`} className="meridian-dock-btn">
              Thermal · {ticker}
            </Link>
            <Link href={`/flows?ticker=${encodeURIComponent(ticker)}`} className="meridian-dock-btn">
              HELIX · {ticker}
            </Link>
            {onBoard && (
              <Link href="/nighthawk" className="meridian-dock-btn meridian-dock-btn-accent">
                Night Hawk · on board
              </Link>
            )}
          </>
        )}
      </div>
    </nav>
  );
}

export function MeridianShimmer({ lines = 3 }: { lines?: number }) {
  return (
    <div className="meridian-shimmer-block" aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="meridian-shimmer-line" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}

export function MeridianEmpty({ message }: { message: string }) {
  return (
    <div className="meridian-empty-state">
      <span className="meridian-empty-icon" aria-hidden="true">
        ◌
      </span>
      <p>{message}</p>
    </div>
  );
}

/**
 * One label→value row, label left and value hard right with a leader between them.
 *
 * The card lists were single strings ("EPS est 1.85"), which put the number mid-sentence in the
 * left third of a wide card and left the rest of the row empty. Splitting the pair lets the
 * values form a COLUMN — so they can be scanned down, compared, and set in tabular figures —
 * and gives the number the weight and colour it earns on a numbers desk.
 */
export function MeridianKV({
  label,
  value,
  tone,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Semantic direction, when the value has one. Never used for decoration. */
  tone?: "bull" | "bear" | "neutral";
}) {
  return (
    <li className="meridian-kv">
      <span className="meridian-kv-label">{label}</span>
      <span className="meridian-kv-leader" aria-hidden="true" />
      <span className={`meridian-kv-value${tone ? ` mv-${tone}` : ""}`}>{value}</span>
    </li>
  );
}
