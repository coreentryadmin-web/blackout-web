"use client";

import { useState } from "react";
import { clsx } from "clsx";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-engine";
import type { LottoPlayPayload } from "@/features/spx/lib/spx-lotto-engine";
import type { PowerHourPlayPayload } from "@/features/spx/lib/spx-power-hour-engine";
import type { PlayConfirmationLayer } from "@/features/spx/hooks/useStablePlayConfirmations";
import type { TradeAlertPlay, TradeStageId } from "@/features/spx/lib/spx-trade-alert-plays";
import { SpxOpenPlayStageCard } from "./SpxOpenPlayStageCard";

type Props = {
  panels: { open: TradeAlertPlay[]; watch: TradeAlertPlay[]; closed: TradeAlertPlay[] };
  play: SpxPlayPayload | null;
  lotto: LottoPlayPayload | null;
  powerHour: PowerHourPlayPayload | null;
  confirmationLayer: PlayConfirmationLayer | null;
  historyThesis: Map<string, string>;
};

function CompactPlayCard({ item, thesis }: { item: TradeAlertPlay; thesis?: string }) {
  return (
    <div className={clsx("spx-trade-panel-compact-card", `spx-trade-panel-compact-card--${item.chip.kind}`)}>
      <div className="spx-trade-panel-compact-head">
        <span className="spx-trade-panel-compact-kind">{item.chip.prefix}</span>
        <span className="spx-trade-panel-compact-label">{item.chip.label}</span>
      </div>
      {thesis && <p className="spx-trade-panel-compact-thesis">{thesis}</p>}
    </div>
  );
}

export function SpxTradeAlertsPanels({
  panels,
  play,
  lotto,
  powerHour,
  confirmationLayer,
  historyThesis,
}: Props) {
  const [expandedStages, setExpandedStages] = useState<Record<string, TradeStageId | null>>({});

  const setStage = (playId: string, stage: TradeStageId) => {
    setExpandedStages((prev) => ({
      ...prev,
      [playId]: prev[playId] === stage ? null : stage,
    }));
  };

  return (
    <div className="spx-trade-alerts-panels">
      <section className="spx-trade-alerts-panel-col spx-trade-alerts-panel-col--open" aria-label="Open plays">
        <header className="spx-trade-alerts-panel-col-head">
          <h4>Open</h4>
          <span className="spx-trade-alerts-panel-count">{panels.open.length}</span>
        </header>
        <div className="spx-trade-alerts-panel-col-body">
          {panels.open.length === 0 ? (
            <p className="spx-trade-alerts-panel-empty">No open positions — engine scanning.</p>
          ) : (
            panels.open.map((item) => (
              <SpxOpenPlayStageCard
                key={item.id}
                item={item}
                play={item.chip.kind === "structure" ? play : null}
                lotto={item.chip.kind === "lotto" ? lotto : null}
                powerHour={item.chip.kind === "power" ? powerHour : null}
                confirmationLayer={confirmationLayer}
                selectedStage={expandedStages[item.id] ?? null}
                onSelectStage={(stage) => setStage(item.id, stage)}
              />
            ))
          )}
        </div>
      </section>

      <section className="spx-trade-alerts-panel-col spx-trade-alerts-panel-col--watch" aria-label="Watch list">
        <header className="spx-trade-alerts-panel-col-head">
          <h4>Watch</h4>
          <span className="spx-trade-alerts-panel-count">{panels.watch.length}</span>
        </header>
        <div className="spx-trade-alerts-panel-col-body">
          {panels.watch.length === 0 ? (
            <p className="spx-trade-alerts-panel-empty">Nothing armed.</p>
          ) : (
            panels.watch.map((item) => (
              <CompactPlayCard
                key={item.id}
                item={item}
                thesis={
                  item.chip.kind === "structure"
                    ? play?.watch?.reason ?? play?.headline ?? undefined
                    : item.chip.kind === "lotto"
                      ? lotto?.headline
                      : powerHour?.headline
                }
              />
            ))
          )}
        </div>
      </section>

      <section className="spx-trade-alerts-panel-col spx-trade-alerts-panel-col--closed" aria-label="Closed plays">
        <header className="spx-trade-alerts-panel-col-head">
          <h4>Closed</h4>
          <span className="spx-trade-alerts-panel-count">{panels.closed.length}</span>
        </header>
        <div className="spx-trade-alerts-panel-col-body">
          {panels.closed.length === 0 ? (
            <p className="spx-trade-alerts-panel-empty">No closed plays yet today.</p>
          ) : (
            panels.closed.map((item) => (
              <CompactPlayCard
                key={item.id}
                item={item}
                thesis={historyThesis.get(item.id) ?? (item.chip.kind === "structure" ? play?.thesis : undefined)}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}
