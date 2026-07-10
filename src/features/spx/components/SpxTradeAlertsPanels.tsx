"use client";

import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-engine";
import type { LottoPlayPayload } from "@/features/spx/lib/spx-lotto-engine";
import type { PowerHourPlayPayload } from "@/features/spx/lib/spx-power-hour-engine";
import type { PlayConfirmationLayer } from "@/features/spx/hooks/useStablePlayConfirmations";
import type { TradeAlertPlay } from "@/features/spx/lib/spx-trade-alert-plays";
import { SpxPlayTerminal } from "./SpxPlayTerminal";

type Props = {
  panels: { open: TradeAlertPlay[]; watch: TradeAlertPlay[]; closed: TradeAlertPlay[] };
  play: SpxPlayPayload | null;
  lotto: LottoPlayPayload | null;
  powerHour: PowerHourPlayPayload | null;
  desk?: SpxDeskPayload;
  confirmationLayer: PlayConfirmationLayer | null;
  historyThesis: Map<string, string>;
  live?: boolean;
};

function allPlays(panels: Props["panels"]): TradeAlertPlay[] {
  return [...panels.open, ...panels.watch, ...panels.closed];
}

function SelectablePlayRow({
  item,
  selected,
  subtitle,
  onSelect,
}: {
  item: TradeAlertPlay;
  selected: boolean;
  subtitle?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={clsx(
        "spx-play-select-row",
        `spx-play-select-row--${item.chip.kind}`,
        selected && "spx-play-select-row--selected"
      )}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <span className="spx-play-select-kind">{item.chip.prefix}</span>
      <span className="spx-play-select-label">{item.chip.label}</span>
      {subtitle && <span className="spx-play-select-sub">{subtitle}</span>}
    </button>
  );
}

export function SpxTradeAlertsPanels({
  panels,
  play,
  lotto,
  powerHour,
  desk,
  confirmationLayer,
  historyThesis,
  live,
}: Props) {
  const plays = useMemo(() => allPlays(panels), [panels]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedId && plays.some((p) => p.id === selectedId)) return;
    setSelectedId(panels.open[0]?.id ?? panels.watch[0]?.id ?? panels.closed[0]?.id ?? null);
  }, [selectedId, plays, panels.open, panels.watch, panels.closed]);

  const selected = plays.find((p) => p.id === selectedId) ?? null;

  const asOf =
    play?.as_of ??
    (selected?.chip.kind === "lotto" ? null : null);

  const closedThesis = selected ? historyThesis.get(selected.id) : undefined;

  const stageHint = (item: TradeAlertPlay): string | undefined => {
    if (item.chip.column === "watch") return "WATCH";
    if (item.chip.column === "closed") return "CLOSED";
    if (item.chip.kind === "structure" && play) return play.action;
    if (item.chip.kind === "lotto" && lotto) return lotto.phase;
    if (item.chip.kind === "power" && powerHour) return powerHour.phase;
    return "OPEN";
  };

  const renderCol = (col: "open" | "watch" | "closed", items: TradeAlertPlay[], wide?: boolean) => (
    <section
      className={clsx(
        "spx-trade-alerts-panel-col",
        wide && "spx-trade-alerts-panel-col--open",
        col === "watch" && "spx-trade-alerts-panel-col--watch",
        col === "closed" && "spx-trade-alerts-panel-col--closed"
      )}
      aria-label={`${col} plays`}
    >
      <header className="spx-trade-alerts-panel-col-head">
        <h4>{col === "open" ? "Open" : col === "watch" ? "Watch" : "Closed"}</h4>
        <span className="spx-trade-alerts-panel-count">{items.length}</span>
      </header>
      <div className="spx-trade-alerts-panel-col-body">
        {items.length === 0 ? (
          <p className="spx-trade-alerts-panel-empty">
            {col === "open" ? "No open positions." : col === "watch" ? "Nothing armed." : "No closed plays."}
          </p>
        ) : (
          items.map((item) => (
            <SelectablePlayRow
              key={item.id}
              item={item}
              selected={selectedId === item.id}
              subtitle={stageHint(item)}
              onSelect={() => setSelectedId(item.id)}
            />
          ))
        )}
      </div>
    </section>
  );

  return (
    <div className="spx-trade-alerts-shell">
      <div className="spx-trade-alerts-panels spx-trade-alerts-panels--select">
        {renderCol("open", panels.open, true)}
        {renderCol("watch", panels.watch)}
        {renderCol("closed", panels.closed)}
      </div>

      <SpxPlayTerminal
        selected={selected}
        play={play}
        lotto={lotto}
        powerHour={powerHour}
        desk={desk}
        confirmationLayer={confirmationLayer}
        closedThesis={closedThesis}
        live={live}
        asOf={play?.as_of ?? desk?.polled_at ?? null}
      />
    </div>
  );
}
