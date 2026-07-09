"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { SpxPlayPayload, SpxPlayAction } from "@/features/spx/lib/spx-play-engine";
import { useSpxPlay } from "@/features/spx/hooks/useSpxPlay";
import { useSpxLotto } from "@/features/spx/hooks/useSpxLotto";
import { useSpxPowerHour } from "@/features/spx/hooks/useSpxPowerHour";
import { useStablePlayConfirmations, type PlayConfirmationLayer } from "@/features/spx/hooks/useStablePlayConfirmations";
import { SpxLiveSpotPrice } from "./SpxLiveSpotPrice";
import { Badge, Kicker } from "@/components/ui";
import { fmtPrice } from "@/lib/api";
import type { LottoPlayPayload } from "@/features/spx/lib/spx-lotto-engine";
import type { PowerHourPlayPayload } from "@/features/spx/lib/spx-power-hour-engine";
import { isLottoPollWindow, isPowerHourWindow } from "@/features/spx/lib/spx-play-session-guards";
import {
  lottoPanelEmptyCopy,
  lottoPanelLoadingCopy,
  lottoPanelOffHoursCopy,
} from "@/features/spx/lib/spx-lotto-copy";

type Props = {
  desk?: SpxDeskPayload;
  live?: boolean;
  refreshing?: boolean;
  sessionActive?: boolean;
};

type PlayKind = "structure" | "lotto" | "power";
type PlayTab = "open" | "watch" | "closed";
type PlayFilter = "all" | PlayKind;

function filterMatches(kind: PlayKind, filter: PlayFilter): boolean {
  return filter === "all" || filter === kind;
}

function lottoIsOpen(lotto: LottoPlayPayload | null): boolean {
  return lotto != null && (lotto.phase === "BUY" || lotto.phase === "HOLD");
}

function lottoIsWatch(lotto: LottoPlayPayload | null): boolean {
  return lotto != null && lotto.phase === "WATCH";
}

function lottoIsClosed(lotto: LottoPlayPayload | null): boolean {
  return lotto != null && (lotto.phase === "SELL" || lotto.phase === "INVALID");
}

function powerIsOpen(powerHour: PowerHourPlayPayload | null): boolean {
  return powerHour != null && powerHour.phase === "HOLD";
}

function powerIsWatch(powerHour: PowerHourPlayPayload | null): boolean {
  return powerHour != null && powerHour.phase === "WATCH";
}

function powerIsClosed(powerHour: PowerHourPlayPayload | null): boolean {
  return powerHour != null && powerHour.phase === "SELL";
}

function PlayTypeBadge({ kind }: { kind: PlayKind }) {
  const label = kind === "structure" ? "STRUCTURE" : kind === "lotto" ? "LOTTO" : "POWER";
  return (
    <span
      className={clsx(
        "spx-play-type-badge",
        kind === "structure" && "spx-play-type-badge-structure",
        kind === "lotto" && "spx-play-type-badge-lotto",
        kind === "power" && "spx-play-type-badge-power"
      )}
    >
      {label}
    </span>
  );
}

function PlaySurfaceToolbar({
  tab,
  onTabChange,
  filter,
  onFilterChange,
  counts,
}: {
  tab: PlayTab;
  onTabChange: (t: PlayTab) => void;
  filter: PlayFilter;
  onFilterChange: (f: PlayFilter) => void;
  counts: { open: number; watch: number; closed: number };
}) {
  const tabs: { id: PlayTab; label: string; count: number }[] = [
    { id: "open", label: "Open", count: counts.open },
    { id: "watch", label: "Watch", count: counts.watch },
    { id: "closed", label: "Closed", count: counts.closed },
  ];
  const filters: { id: PlayFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "structure", label: "Structure" },
    { id: "lotto", label: "Lotto" },
    { id: "power", label: "Power" },
  ];

  return (
    <div className="spx-play-surface-toolbar">
      <div className="spx-play-surface-tabs" role="tablist" aria-label="Play state">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={clsx("spx-play-surface-tab", tab === t.id && "spx-play-surface-tab-active")}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
            {t.count > 0 && <span className="spx-play-surface-tab-count">{t.count}</span>}
          </button>
        ))}
      </div>
      <div className="spx-play-surface-filters" role="group" aria-label="Play type filter">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            className={clsx("spx-play-surface-filter", filter === f.id && "spx-play-surface-filter-active")}
            onClick={() => onFilterChange(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function playDeskAlert(type: "buy" | "watch") {
  try {
    const AudioCtx = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (type === "buy") {
      // Two-tone ascending beep for BUY
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
      // Second tone
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.frequency.value = 880;
      gain2.gain.setValueAtTime(0.2, ctx.currentTime + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
      osc2.start(ctx.currentTime + 0.15);
      osc2.stop(ctx.currentTime + 0.55);
    } else {
      // Single soft tone for WATCH
      osc.frequency.value = 440;
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch {
    // Audio API unavailable (SSR, permissions)
  }
}

type HistoryRow = SpxPlayPayload & { id: string };

function actionLabel(action: SpxPlayAction, direction: SpxPlayPayload["direction"]): string {
  switch (action) {
    case "BUY":
      return direction === "short" ? "BUY PUT" : "BUY CALL";
    case "SELL":
      return "SELL";
    case "HOLD":
      return "HOLD";
    case "TRIM":
      return "TRIM";
    case "WATCHING":
      return "WATCH";
    default:
      return "SCANNING";
  }
}

function historyClass(action: SpxPlayAction): string {
  switch (action) {
    case "BUY":
      return "spx-history-buy-call";
    case "SELL":
      return "spx-history-sell";
    case "HOLD":
    case "TRIM":
      return "spx-history-hold";
    default:
      return "spx-history-wait";
  }
}

function scoreClass(action: SpxPlayAction, score: number): string {
  if (action === "BUY") return score >= 0 ? "text-bull" : "text-bear";
  if (action === "SELL") return "text-bear";
  if (action === "HOLD" || action === "TRIM" || action === "WATCHING") return "text-orange-400";
  return "text-sky-300";
}

function isPlayIdeaLine(line: string): boolean {
  return (
    line.startsWith("I like ") ||
    line.startsWith("Leaning ") ||
    line.startsWith("Tape's mixed") ||
    line.includes(" could be the play") ||
    line.includes(" is the play")
  );
}

function isDeskOfflineCopy(text: string | undefined): boolean {
  if (!text) return false;
  return (
    text.startsWith("Desk offline") ||
    text.includes("resumes 6:30 AM PT") ||
    text.includes("Session closed")
  );
}

function playId(p: SpxPlayPayload): string {
  return `${p.action}|${p.direction}|${p.confidence}|${Math.round(p.score)}|${p.headline}`;
}

function hasOpenPlay(play: SpxPlayPayload): boolean {
  return Boolean(
    play.open_play ||
      play.phase === "OPEN" ||
      play.action === "BUY" ||
      play.action === "HOLD" ||
      play.action === "TRIM" ||
      play.action === "SELL"
  );
}

function hasWatchPlay(play: SpxPlayPayload): boolean {
  return Boolean(play.watch?.active || play.action === "WATCHING" || play.phase === "WATCHING");
}

function openBoxTone(play: SpxPlayPayload): string {
  if (play.action === "SELL") return "spx-trade-open-box-sell";
  if (play.direction === "short") return "spx-trade-open-box-put";
  if (hasOpenPlay(play)) return "spx-trade-open-box-active";
  return "";
}

function WatchConfirmations({
  layer,
  refreshing,
  play,
}: {
  layer: PlayConfirmationLayer;
  refreshing: boolean;
  play: SpxPlayPayload;
}) {
  const checkStrings = new Set(layer.confirmations.checks.map((c) => `${c.label}: ${c.detail}`));
  const ideaShown = Boolean(layer.gates.play_idea);
  const seen = new Set<string>();
  const ideaBases = new Set<string>();
  const visibleBlocks = layer.gates.blocks.filter((b) => {
    if (!b || b === layer.gates.play_idea) return false;
    if (checkStrings.has(b)) return false;
    if (seen.has(b)) return false;
    seen.add(b);
    if (isPlayIdeaLine(b)) {
      if (ideaShown) return false;
      const base = b.split(" · ")[0];
      if (ideaBases.has(base)) return false;
      ideaBases.add(base);
    }
    return true;
  });

  return (
    <div className={clsx("spx-trade-watch-confirmations", refreshing && "spx-trade-confirmations-refreshing")}>
      <p className="spx-trade-watch-confirmations-title">
        Setup checks {layer.confirmations.passed_count}/{layer.confirmations.total}
        {refreshing && <span className="spx-trade-watch-updating"> · updating</span>}
      </p>
      {layer.confirmations.checks.map((c) => (
        <p key={c.label} className={c.passed ? "spx-trade-confirmation-pass" : "spx-trade-confirmation-fail"}>
          {c.passed ? "✓" : "✗"} {c.label}: {c.detail}
        </p>
      ))}
      {layer.technicals && (
        <p className="spx-trade-confirmation-meta">
          5m {layer.technicals.m5_trend} · RSI {layer.technicals.m5_rsi?.toFixed(0) ?? "—"} · 3m{" "}
          {layer.technicals.m3_close?.toFixed(2) ?? "—"}
          {layer.technicals.mtf_summary ? ` · ${layer.technicals.mtf_summary}` : ""}
        </p>
      )}
      {layer.gates.play_idea && <p className="spx-trade-idea-line">{layer.gates.play_idea}</p>}
      {layer.gates.warnings.map((w) => (
        <p key={w} className="spx-trade-confirmation-meta text-gold/90">
          ⚠ {w}
        </p>
      ))}
      {visibleBlocks.map((b) =>
        isPlayIdeaLine(b) ? (
          <p key={b} className="spx-trade-idea-line">
            {b}
          </p>
        ) : (
          <p key={b} className="spx-trade-block-warn">
            ⛔ {b}
          </p>
        )
      )}
      {play.claude && play.action === "BUY" && (
        <p className="spx-trade-confirmation-meta text-emerald-300/80">
          Claude {play.claude.source} · {play.claude.verdict}
        </p>
      )}
    </div>
  );
}

function OpenPlayBox({ play }: { play: SpxPlayPayload }) {
  const active = hasOpenPlay(play);
  const open = play.open_play;

  return (
    <div className={clsx("spx-trade-play-box spx-trade-open-box", active && openBoxTone(play))}>
      <div className="spx-trade-play-box-header">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="spx-trade-play-box-kicker">Current open play</p>
          <PlayTypeBadge kind="structure" />
        </div>
        {active ? (
          <span className={clsx("spx-trade-play-box-badge", scoreClass(play.action, play.score))}>
            {actionLabel(play.action, play.direction)}
          </span>
        ) : (
          <span className="spx-trade-play-box-badge spx-trade-play-box-badge-idle">NONE</span>
        )}
      </div>

      {!active ? (
        <p className="spx-trade-play-box-empty">No active position — engine is scanning for an A+ entry.</p>
      ) : (
        <div className="spx-trade-play-box-body">
          {play.action === "BUY" && !play.signal_committed && !open && (
            <p className="spx-trade-play-box-note">Signal only — awaiting engine commit</p>
          )}
          <p className="spx-trade-play-box-headline">{play.headline}</p>
          {open && (
            <p className="spx-trade-play-box-meta">
              Open {open.direction} @ {fmtPrice(open.entry_price)}
              {open.option_label ? ` · ${open.option_label}` : ""}
              {open.mfe_pts ? ` · MFE +${open.mfe_pts.toFixed(1)} pts` : ""}
            </p>
          )}
          {play.option_ticket && play.action === "BUY" && (
            <p className="spx-trade-option-ticket">
              {play.option_ticket.contract_label} · ${play.option_ticket.premium_range}
              {play.option_ticket.delta != null ? ` · Δ ${Math.abs(play.option_ticket.delta).toFixed(2)}` : ""}
            </p>
          )}
          <p
            className={clsx(
              "spx-trade-play-box-thesis",
              (play.session_phase === "closed" || isDeskOfflineCopy(play.thesis)) && "spx-desk-offline-line"
            )}
          >
            {play.thesis}
          </p>
          {play.grade && (
            <p className="spx-trade-grade-line">
              Grade {play.grade}
              {open ? ` · opened ${new Date(open.opened_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}
            </p>
          )}
          {(play.levels.entry != null || open) && play.action !== "WATCHING" && play.action !== "SCANNING" && (
            <div className="spx-trade-alert-levels mt-3 grid grid-cols-3 gap-3">
              <div>
                <p className="spx-trade-alert-score-label">Entry</p>
                <p className={clsx("spx-level-value", scoreClass(play.action, play.score))}>
                  {fmtPrice(open?.entry_price ?? play.levels.entry)}
                </p>
              </div>
              <div>
                <p className="spx-trade-alert-score-label">Stop</p>
                <p className="spx-level-value text-bear tabular-nums">
                  {play.levels.stop != null || open?.stop != null
                    ? fmtPrice(open?.stop ?? play.levels.stop)
                    : "—"}
                </p>
              </div>
              <div>
                <p className="spx-trade-alert-score-label">Target</p>
                <p className="spx-level-value text-bull tabular-nums">
                  {play.levels.target != null || open?.target != null
                    ? fmtPrice(open?.target ?? play.levels.target)
                    : "—"}
                </p>
              </div>
            </div>
          )}
          {play.levels.invalidation && play.phase === "OPEN" && (
            <p className="spx-trade-play-box-note mt-2">Invalidation: {play.levels.invalidation}</p>
          )}
          <div className="spx-trade-play-box-score-row">
            <span className="spx-trade-alert-score-label">Score</span>
            <span className={clsx("spx-trade-play-box-score", scoreClass(play.action, play.score))}>
              {play.score > 0 ? "+" : ""}
              {play.score}
            </span>
            <span className="spx-trade-alert-conf-pct">{play.confidence}% conf</span>
          </div>
        </div>
      )}
    </div>
  );
}

function WatchPlayBox({
  play,
  confirmationLayer,
  refreshing,
}: {
  play: SpxPlayPayload;
  confirmationLayer: PlayConfirmationLayer | null;
  refreshing: boolean;
}) {
  const active = hasWatchPlay(play);
  const showConfirmations =
    Boolean(confirmationLayer) &&
    (play.action === "WATCHING" || play.action === "BUY" || (!play && refreshing));

  return (
    <div className={clsx("spx-trade-play-box spx-trade-watch-box", active && "spx-trade-watch-box-active")}>
      <div className="spx-trade-play-box-header">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="spx-trade-play-box-kicker">Armed setup</p>
          <PlayTypeBadge kind="structure" />
        </div>
        {active ? (
          <span className="spx-trade-play-box-badge spx-trade-play-box-badge-watch">WATCH</span>
        ) : (
          <span className="spx-trade-play-box-badge spx-trade-play-box-badge-idle">IDLE</span>
        )}
      </div>

      {!active ? (
        <p className="spx-trade-play-box-empty">
          {play.idle_message ?? play.headline ?? "No setup on watch — waiting for grade + level alignment."}
        </p>
      ) : (
        <div className="spx-trade-play-box-body">
          <p className="spx-trade-play-box-headline">{play.headline}</p>
          {play.watch?.reason && <p className="spx-trade-play-box-thesis">{play.watch.reason}</p>}
          {play.watch?.since && (
            <p className="spx-trade-play-box-meta">
              Since{" "}
              {new Date(play.watch.since).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              {play.watch.promote_ready ? " · promote ready" : ""}
            </p>
          )}
          {play.thesis && play.thesis !== play.headline && (
            <p className="spx-trade-play-box-thesis">{play.thesis}</p>
          )}
          {play.grade && (
            <p className="spx-trade-grade-line">
              Grade {play.grade}
              {play.watch?.active ? " · watch active" : ""}
            </p>
          )}
          {showConfirmations && confirmationLayer && (
            <WatchConfirmations layer={confirmationLayer} refreshing={refreshing} play={play} />
          )}
        </div>
      )}
    </div>
  );
}

function ConfluenceFactorsPanel({
  factors,
  updating,
}: {
  factors: SpxPlayPayload["factors"];
  updating: boolean;
}) {
  return (
    <div className="spx-trade-confluence">
      <div className="spx-trade-confluence-header">
        <p className="spx-trade-confluence-title">Confluence factors</p>
        {updating && <span className="spx-trade-watch-updating">updating</span>}
      </div>
      {factors.length === 0 ? (
        <p className="spx-trade-play-box-empty">Factors populate when the engine scores the tape.</p>
      ) : (
        <ul className="spx-desk-list spx-trade-confluence-list">
          {factors.slice(0, 12).map((f) => (
            <li key={`${f.label}-${f.detail}`} className="spx-desk-list-row spx-trade-confluence-row">
              <span
                className={clsx(
                  "spx-trade-confluence-label",
                  f.weight > 0 ? "text-bull" : f.weight < 0 ? "text-bear" : "text-sky-300"
                )}
              >
                {f.label}
              </span>
              <span className="spx-trade-confluence-detail">{f.detail}</span>
              <span
                className={clsx(
                  "spx-trade-confluence-weight",
                  f.weight > 0 ? "text-bull" : f.weight < 0 ? "text-bear" : "text-cyan-400"
                )}
              >
                {f.weight > 0 ? "+" : ""}
                {f.weight}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LottoPlayCard({
  lotto,
  lottoLoading,
  lottoRefreshing,
  surface,
}: {
  lotto: LottoPlayPayload | null;
  lottoLoading: boolean;
  lottoRefreshing: boolean;
  surface: PlayTab;
}) {
  const inWindow = isLottoPollWindow();
  const active =
    surface === "open"
      ? lottoIsOpen(lotto)
      : surface === "watch"
        ? lottoIsWatch(lotto)
        : lottoIsClosed(lotto);

  const boxTone = clsx(
    "spx-trade-play-box spx-trade-play-box-lotto",
    active && surface === "open" && "spx-trade-play-box-lotto-open",
    active && surface === "watch" && "spx-trade-watch-box-active",
    active && surface === "closed" && "spx-trade-play-box-lotto-closed"
  );

  if (lotto && lotto.phase !== "NONE" && active) {
    return (
      <div className={boxTone}>
        <div className="spx-trade-play-box-header">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="spx-trade-play-box-kicker">{lotto.status_label}</p>
            <PlayTypeBadge kind="lotto" />
          </div>
          <span className="spx-trade-play-box-badge spx-trade-play-box-badge-lotto">
            {lotto.phase}
          </span>
        </div>
        <div className="spx-trade-play-box-body">
          <p className="spx-trade-play-box-headline">{lotto.headline}</p>
          {lotto.thesis && lotto.thesis !== lotto.headline && (
            <p className="spx-trade-play-box-thesis">{lotto.thesis}</p>
          )}
          {lotto.contract_label && (
            <p className="spx-lotto-play-contract">
              {lotto.direction === "long" ? "CALL" : "PUT"} · Strike {lotto.strike}
              {lotto.premium_estimate ? ` · ${lotto.premium_estimate}` : ""}
            </p>
          )}
          {lotto.target_price != null && lotto.entry_zone != null && (
            <p className="spx-lotto-play-contract">
              Target: +{lotto.target_pts} pts · Zone: {lotto.entry_zone.toFixed(0)}
            </p>
          )}
          {lotto.entry_trigger && lotto.phase === "WATCH" && (
            <p className="spx-lotto-play-contract">Trigger: {lotto.entry_trigger}</p>
          )}
          {lotto.open_anchor_price != null && lotto.phase === "WATCH" && (
            <p className="spx-lotto-play-anchor">
              Open anchor: {lotto.open_anchor_price.toFixed(2)} (9:30 cash print)
            </p>
          )}
          {lotto.invalidation && (lotto.phase === "WATCH" || lotto.phase === "HOLD") && (
            <p className="spx-lotto-play-invalidation">Invalidation: {lotto.invalidation}</p>
          )}
          {lotto.catalyst_summary && lotto.phase === "WATCH" && (
            <p className="spx-lotto-play-flow">Intel: {lotto.catalyst_summary}</p>
          )}
          {lotto.flow_summary && <p className="spx-lotto-play-flow">Flow: {lotto.flow_summary}</p>}
          {lotto.sizing_note && <p className="spx-lotto-play-sizing">{lotto.sizing_note}</p>}
          {lotto.spread_pct != null && (
            <p className="spx-lotto-play-spread">Spread: {lotto.spread_pct.toFixed(0)}% (lotto cap)</p>
          )}
          <p className="spx-lotto-play-footnote">
            {lotto.status_message}
            {lottoRefreshing && " · live"}
          </p>
        </div>
      </div>
    );
  }

  if (surface === "watch" && inWindow) {
    const copy = lottoLoading
      ? lottoPanelLoadingCopy()
      : lottoPanelEmptyCopy(lotto?.headline);
    return (
      <div className={clsx(boxTone, "spx-trade-play-box-muted")}>
        <div className="spx-trade-play-box-header">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="spx-trade-play-box-kicker">{copy.kicker}</p>
            <PlayTypeBadge kind="lotto" />
          </div>
          <span className="spx-trade-play-box-badge spx-trade-play-box-badge-idle">IDLE</span>
        </div>
        <p className="spx-trade-play-box-headline">{copy.headline}</p>
        <p className="spx-trade-play-box-thesis">{copy.thesis}</p>
        {lottoRefreshing && !lottoLoading && (
          <p className="spx-lotto-play-footnote">{copy.footnote ?? "Scanning…"}</p>
        )}
      </div>
    );
  }

  if (surface === "watch" && !inWindow) {
    const offHours = lottoPanelOffHoursCopy();
    return (
      <div className={clsx(boxTone, "spx-trade-play-box-muted")}>
        <div className="spx-trade-play-box-header">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="spx-trade-play-box-kicker">{offHours.kicker}</p>
            <PlayTypeBadge kind="lotto" />
          </div>
          <span className="spx-trade-play-box-badge spx-trade-play-box-badge-idle">OFF</span>
        </div>
        <p className="spx-trade-play-box-headline">{offHours.headline}</p>
        <p className="spx-trade-play-box-thesis">{offHours.thesis}</p>
      </div>
    );
  }

  return null;
}

function PowerHourPlayCard({
  powerHour,
  powerHourLoading,
  powerHourRefreshing,
  surface,
}: {
  powerHour: PowerHourPlayPayload | null;
  powerHourLoading: boolean;
  powerHourRefreshing: boolean;
  surface: PlayTab;
}) {
  const inWindow = isPowerHourWindow();
  const showDock =
    inWindow || (powerHour != null && (powerHour.phase === "WATCH" || powerHour.phase === "HOLD"));
  const active =
    surface === "open"
      ? powerIsOpen(powerHour)
      : surface === "watch"
        ? powerIsWatch(powerHour)
        : powerIsClosed(powerHour);

  if (!showDock && !powerHourLoading && surface === "watch") return null;
  if (!showDock && !powerHourLoading && surface !== "watch") return null;

  const boxTone = clsx(
    "spx-trade-play-box spx-trade-play-box-power",
    active && surface === "open" && "spx-trade-play-box-power-open",
    active && surface === "watch" && "spx-trade-watch-box-active",
    active && surface === "closed" && "spx-trade-play-box-power-closed"
  );

  if (powerHour && powerHour.phase !== "NONE" && active) {
    return (
      <div className={boxTone}>
        <div className="spx-trade-play-box-header">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="spx-trade-play-box-kicker">Power hour · {powerHour.phase}</p>
            <PlayTypeBadge kind="power" />
          </div>
          <span className="spx-trade-play-box-badge spx-trade-play-box-badge-power">{powerHour.phase}</span>
        </div>
        <div className="spx-trade-play-box-body">
          <p className="spx-trade-play-box-headline">{powerHour.headline}</p>
          {powerHour.thesis && powerHour.thesis !== powerHour.headline && (
            <p className="spx-trade-play-box-thesis">{powerHour.thesis}</p>
          )}
          {powerHour.contract_label && (
            <p className="spx-lotto-play-contract">
              {powerHour.direction === "long" ? "CALL" : "PUT"} · {powerHour.contract_label}
            </p>
          )}
          {powerHour.target_price != null && (
            <p className="spx-lotto-play-contract">
              Target +{powerHour.target_pts} pts · Stop −{powerHour.stop_pts} pts
            </p>
          )}
          {powerHour.pnl_pts != null && powerHour.phase === "HOLD" && (
            <p className="spx-lotto-play-contract">
              Live PnL: {powerHour.pnl_pts >= 0 ? "+" : ""}
              {powerHour.pnl_pts.toFixed(1)} pts
            </p>
          )}
          {powerHour.sizing_note && <p className="spx-lotto-play-sizing">{powerHour.sizing_note}</p>}
          <p className="spx-lotto-play-footnote">
            {powerHour.status_message}
            {powerHourRefreshing && " · live"}
          </p>
        </div>
      </div>
    );
  }

  if (surface === "watch" && inWindow) {
    return (
      <div className={clsx(boxTone, "spx-trade-play-box-muted")}>
        <div className="spx-trade-play-box-header">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="spx-trade-play-box-kicker">Power hour</p>
            <PlayTypeBadge kind="power" />
          </div>
          <span className="spx-trade-play-box-badge spx-trade-play-box-badge-idle">IDLE</span>
        </div>
        <p className="spx-trade-play-box-headline">
          {powerHourLoading ? "Scanning closing momentum…" : "No power-hour setup armed yet."}
        </p>
        <p className="spx-trade-play-box-thesis">Near-money 0DTE momentum window · 2:45–3:15 PM ET.</p>
      </div>
    );
  }

  return null;
}

function PlaySurfaceEmpty({ tab, filter }: { tab: PlayTab; filter: PlayFilter }) {
  const filterLabel =
    filter === "all" ? "" : filter === "structure" ? " structure" : filter === "lotto" ? " lotto" : " power-hour";
  const copy =
    tab === "open"
      ? `No${filterLabel} open position — engine is scanning.`
      : tab === "watch"
        ? `No${filterLabel} setup armed — waiting for alignment.`
        : `No recent${filterLabel} closed plays in this session.`;
  return <p className="spx-trade-play-box-empty py-4 text-center">{copy}</p>;
}

export function SpxTradeAlerts({ desk, live, refreshing, sessionActive = true }: Props) {
  const { play, playRefreshing } = useSpxPlay(sessionActive);
  const { lotto, lottoLoading, lottoRefreshing } = useSpxLotto();
  const { powerHour, powerHourLoading, powerHourRefreshing } = useSpxPowerHour();
  const confirmationLayer = useStablePlayConfirmations(play);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [playTab, setPlayTab] = useState<PlayTab>("open");
  const [playFilter, setPlayFilter] = useState<PlayFilter>("all");
  const lastIdRef = useRef<string>("");
  const prevActionRef = useRef<string | null>(null);

  useEffect(() => {
    const action = play?.action;
    const prev = prevActionRef.current;
    prevActionRef.current = action ?? null;

    if (!action || !prev) return;
    if (action === "BUY" && prev !== "BUY" && play?.signal_committed) {
      playDeskAlert("buy");
    } else if (action === "WATCHING" && prev === "SCANNING") {
      playDeskAlert("watch");
    }
  }, [play?.action, play?.signal_committed]);

  useEffect(() => {
    if (!play || play.action === "SCANNING") return;
    const id = playId(play);
    if (id === lastIdRef.current) return;
    lastIdRef.current = id;
    setHistory((prev) => [{ ...play, id: `${id}|${Date.now()}` }, ...prev].slice(0, 24));
  }, [play]);

  const show = play != null && live && sessionActive;

  const panelRefreshing = Boolean(
    (refreshing || playRefreshing) && play && play.action !== "SCANNING"
  );

  const showConfirmationPanel =
    Boolean(confirmationLayer) &&
    (play?.action === "WATCHING" ||
      play?.action === "BUY" ||
      (!play && playRefreshing));

  const structureOpen = Boolean(play && hasOpenPlay(play));
  const structureWatch = Boolean(play && hasWatchPlay(play) && !structureOpen);
  const structureClosed = history.length > 1;

  const tabCounts = {
    open:
      (structureOpen ? 1 : 0) +
      (lottoIsOpen(lotto) ? 1 : 0) +
      (powerIsOpen(powerHour) ? 1 : 0),
    watch:
      (structureWatch ? 1 : 0) +
      (lottoIsWatch(lotto) ? 1 : 0) +
      (powerIsWatch(powerHour) ? 1 : 0),
    closed:
      (structureClosed ? history.length - 1 : 0) +
      (lottoIsClosed(lotto) ? 1 : 0) +
      (powerIsClosed(powerHour) ? 1 : 0),
  };

  function renderPlaySurface(): ReactNode {
    if (!play) return null;
    const items: ReactNode[] = [];

    if (playTab === "open") {
      if (filterMatches("structure", playFilter)) {
        items.push(<OpenPlayBox key="structure-open" play={play} />);
      }
      if (filterMatches("lotto", playFilter) && lottoIsOpen(lotto)) {
        items.push(
          <LottoPlayCard
            key="lotto-open"
            lotto={lotto}
            lottoLoading={lottoLoading}
            lottoRefreshing={lottoRefreshing}
            surface="open"
          />
        );
      }
      if (filterMatches("power", playFilter) && powerIsOpen(powerHour)) {
        items.push(
          <PowerHourPlayCard
            key="power-open"
            powerHour={powerHour}
            powerHourLoading={powerHourLoading}
            powerHourRefreshing={powerHourRefreshing}
            surface="open"
          />
        );
      }
    }

    if (playTab === "watch") {
      if (filterMatches("structure", playFilter)) {
        items.push(
          <WatchPlayBox
            key="structure-watch"
            play={play}
            confirmationLayer={showConfirmationPanel ? confirmationLayer : null}
            refreshing={playRefreshing}
          />
        );
      }
      if (filterMatches("lotto", playFilter)) {
        items.push(
          <LottoPlayCard
            key="lotto-watch"
            lotto={lotto}
            lottoLoading={lottoLoading}
            lottoRefreshing={lottoRefreshing}
            surface="watch"
          />
        );
      }
      if (filterMatches("power", playFilter)) {
        items.push(
          <PowerHourPlayCard
            key="power-watch"
            powerHour={powerHour}
            powerHourLoading={powerHourLoading}
            powerHourRefreshing={powerHourRefreshing}
            surface="watch"
          />
        );
      }
    }

    if (playTab === "closed") {
      if (filterMatches("structure", playFilter) && history.length > 1) {
        items.push(
          <div key="structure-closed" className="spx-trade-closed-log">
            <p className="spx-trade-closed-log-title">Structure play log</p>
            <ul className="spx-desk-list max-h-[220px] overflow-y-auto">
              {history.slice(1, 12).map((row) => (
                <li key={row.id} className="spx-desk-list-row text-xs md:text-sm">
                  <span className={clsx("spx-trade-alert-history-action", historyClass(row.action))}>
                    {actionLabel(row.action, row.direction)}
                  </span>
                  <span className="font-mono text-cyan-400 shrink-0">
                    {new Date(row.as_of).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                  <span className="font-mono text-sky-200 truncate">{row.headline}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      }
      if (filterMatches("lotto", playFilter) && lottoIsClosed(lotto)) {
        items.push(
          <LottoPlayCard
            key="lotto-closed"
            lotto={lotto}
            lottoLoading={lottoLoading}
            lottoRefreshing={lottoRefreshing}
            surface="closed"
          />
        );
      }
      if (filterMatches("power", playFilter) && powerIsClosed(powerHour)) {
        items.push(
          <PowerHourPlayCard
            key="power-closed"
            powerHour={powerHour}
            powerHourLoading={powerHourLoading}
            powerHourRefreshing={powerHourRefreshing}
            surface="closed"
          />
        );
      }
    }

    if (items.length === 0) {
      return <PlaySurfaceEmpty tab={playTab} filter={playFilter} />;
    }
    return items;
  }

  const showConfluence =
    play != null &&
    playTab !== "closed" &&
    filterMatches("structure", playFilter) &&
    play.factors.length > 0;

  return (
    <section
      className={clsx(
        "spx-trade-alerts-panel spx-sniper-panel",
        panelRefreshing && "spx-desk-panel-refreshing"
      )}
    >
      <div className="spx-sniper-panel-content">
      <SpxLiveSpotPrice desk={desk} live={live} size="panel" className="spx-play-engine-spot mb-4 hide-in-ios-app" />
      <header className="spx-trade-alerts-header">
        <div className="min-w-0">
          <Kicker className="mb-1">PLAY ENGINE</Kicker>
          <h3 className="t-label text-[15px] uppercase leading-tight text-white">Trade Alerts</h3>
        </div>
        <Badge tone={live ? "bull" : "neutral"} dot={live} className="shrink-0">
          {live ? "LIVE" : "OFFLINE"}
        </Badge>
      </header>

      <div className="spx-sniper-panel-body spx-trade-alerts-stack">
      {!show ? (
        sessionActive && live ? (
          <p className="spx-desk-offline-line font-mono py-8 text-center">
            Scanning — no open play
          </p>
        ) : (
          <div className="spx-desk-closed">
            <Kicker className="spx-desk-closed-kicker">0DTE WINDOW CLOSED</Kicker>
            <h4 className="spx-desk-closed-headline">MARKET CLOSED</h4>
            <p className="spx-desk-closed-sub">
              Desk re-arms at{" "}
              <span className="spx-desk-closed-time">6:30 AM PT</span>
            </p>
          </div>
        )
      ) : (
        <>
          <PlaySurfaceToolbar
            tab={playTab}
            onTabChange={setPlayTab}
            filter={playFilter}
            onFilterChange={setPlayFilter}
            counts={tabCounts}
          />
          <div className="spx-play-surface-stack">{renderPlaySurface()}</div>
          {showConfluence && (
            <ConfluenceFactorsPanel factors={play.factors} updating={panelRefreshing} />
          )}
          <p className="spx-trade-educational-note">
            Educational. Not advice. Every trade is your own decision.
          </p>
        </>
      )}
      </div>
      </div>
    </section>
  );
}
