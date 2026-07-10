"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-engine";
import type { LottoPlayPayload } from "@/features/spx/lib/spx-lotto-engine";
import type { PowerHourPlayPayload } from "@/features/spx/lib/spx-power-hour-engine";
import type { PlayConfirmationLayer } from "@/features/spx/hooks/useStablePlayConfirmations";
import type { PlaybookShadowPanel } from "@/features/spx/lib/playbook-shadow-panel";
import type { TradeAlertPlay } from "@/features/spx/lib/spx-trade-alert-plays";
import {
  buildPlayTerminalLines,
  buildPlaybookTerminalLines,
  playTerminalTitle,
  type PlayTerminalIcon,
  type PlayTerminalLine,
} from "@/features/spx/lib/spx-play-terminal-lines";

export type DeskTerminalTab = "playbook" | "play";

type Props = {
  activeTab: DeskTerminalTab;
  onTabChange: (tab: DeskTerminalTab) => void;
  selected: TradeAlertPlay | null;
  play: SpxPlayPayload | null;
  lotto: LottoPlayPayload | null;
  powerHour: PowerHourPlayPayload | null;
  playbookPanel: PlaybookShadowPanel | null | undefined;
  desk?: SpxDeskPayload;
  confirmationLayer: PlayConfirmationLayer | null;
  closedThesis?: string;
  sessionLive?: boolean;
  live?: boolean;
  asOf?: string | null;
};

const ICON_GLYPH: Record<PlayTerminalIcon, string> = {
  prompt: "❯",
  section: "◆",
  ok: "✓",
  no: "✕",
  vwap: "▲",
  flow: "◎",
  gamma: "⬡",
  level: "▸",
  news: "▪",
  trim: "✂",
  sell: "⏹",
  watch: "◉",
  dim: "·",
  pulse: "●",
};

function TerminalLine({ line }: { line: PlayTerminalLine }) {
  const indentPx = (line.indent ?? 0) * 12;
  return (
    <div
      className={clsx("spx-play-terminal-line", `spx-play-terminal-line--${line.tone}`)}
      style={indentPx ? { paddingLeft: indentPx } : undefined}
    >
      <span className={clsx("spx-play-terminal-glyph", `spx-play-terminal-glyph--${line.icon}`)} aria-hidden>
        {ICON_GLYPH[line.icon]}
      </span>
      <span className="spx-play-terminal-text">{line.text}</span>
    </div>
  );
}

function tabTitle(activeTab: DeskTerminalTab, selected: TradeAlertPlay | null): string {
  if (activeTab === "playbook") return "blackout — playbook validation";
  return playTerminalTitle(selected);
}

export function SpxDeskTerminal({
  activeTab,
  onTabChange,
  selected,
  play,
  lotto,
  powerHour,
  playbookPanel,
  desk,
  confirmationLayer,
  closedThesis,
  sessionLive = true,
  live,
  asOf,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const lines = useMemo(() => {
    if (activeTab === "playbook") {
      return buildPlaybookTerminalLines(playbookPanel, sessionLive);
    }
    return buildPlayTerminalLines({
      selected,
      play,
      lotto,
      powerHour,
      desk,
      confirmationLayer,
      closedThesis,
    });
  }, [
    activeTab,
    playbookPanel,
    sessionLive,
    selected,
    play,
    lotto,
    powerHour,
    desk,
    confirmationLayer,
    closedThesis,
  ]);

  const cmd =
    activeTab === "playbook" ? "playbook --shadow --validate" : "play --follow";

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, asOf, activeTab]);

  const timeLabel = asOf
    ? new Date(asOf).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })
    : null;

  const playTabLabel = selected ? selected.chip.label : "Play";

  return (
    <div className="spx-play-terminal-window" role="region" aria-label="Desk terminal">
      <div className="spx-play-terminal-titlebar">
        <div className="spx-play-terminal-traffic" aria-hidden>
          <span className="spx-play-terminal-dot spx-play-terminal-dot--close" />
          <span className="spx-play-terminal-dot spx-play-terminal-dot--min" />
          <span className="spx-play-terminal-dot spx-play-terminal-dot--max" />
        </div>
        <p className="spx-play-terminal-title">{tabTitle(activeTab, selected)}</p>
        <div className="spx-play-terminal-titlebar-meta">
          {live && <span className="spx-play-terminal-live">LIVE</span>}
          {timeLabel && <span className="spx-play-terminal-clock">{timeLabel}</span>}
        </div>
      </div>

      <div className="spx-play-terminal-tabs" role="tablist" aria-label="Terminal views">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "playbook"}
          className={clsx("spx-play-terminal-tab", activeTab === "playbook" && "spx-play-terminal-tab--active")}
          onClick={() => onTabChange("playbook")}
        >
          Playbook
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "play"}
          className={clsx("spx-play-terminal-tab", activeTab === "play" && "spx-play-terminal-tab--active")}
          onClick={() => onTabChange("play")}
        >
          {playTabLabel}
        </button>
      </div>

      <div
        ref={scrollRef}
        className="spx-play-terminal-body"
        role="tabpanel"
        aria-label={activeTab === "playbook" ? "Playbook validation" : "Selected play feed"}
      >
        <div className="spx-play-terminal-prompt-line">
          <span className="spx-play-terminal-user">member</span>
          <span className="spx-play-terminal-at">@</span>
          <span className="spx-play-terminal-host">blackout-desk</span>
          <span className="spx-play-terminal-path"> ~ </span>
          <span className="spx-play-terminal-cmd">{cmd}</span>
        </div>
        {lines.map((line, i) => (
          <TerminalLine key={`${activeTab}-${line.text}-${i}`} line={line} />
        ))}
        <div className="spx-play-terminal-cursor-line">
          <span className="spx-play-terminal-glyph spx-play-terminal-glyph--prompt" aria-hidden>
            ❯
          </span>
          <span className="spx-play-terminal-cursor" aria-hidden />
        </div>
      </div>
    </div>
  );
}
