"use client";

import { clsx } from "clsx";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-engine";
import type { LottoPlayPayload } from "@/features/spx/lib/spx-lotto-engine";
import type { PowerHourPlayPayload } from "@/features/spx/lib/spx-power-hour-engine";
import type { PlayConfirmationLayer } from "@/features/spx/hooks/useStablePlayConfirmations";
import type { TradeAlertPlay, TradeStageId } from "@/features/spx/lib/spx-trade-alert-plays";
import { fmtPrice } from "@/lib/api";

type Props = {
  item: TradeAlertPlay;
  play: SpxPlayPayload | null;
  lotto: LottoPlayPayload | null;
  powerHour: PowerHourPlayPayload | null;
  confirmationLayer: PlayConfirmationLayer | null;
  selectedStage: TradeStageId | null;
  onSelectStage: (stage: TradeStageId) => void;
};

const STAGE_LABELS: Record<TradeStageId, string> = {
  hold: "Hold",
  trim: "Trim",
  sell: "Sell",
};

function stageIndex(stages: TradeStageId[], stage: TradeStageId): number {
  return stages.indexOf(stage);
}

function stageStatus(
  stages: TradeStageId[],
  activeStage: TradeStageId,
  stage: TradeStageId,
  trimDone: boolean
): "done" | "active" | "upcoming" {
  const activeIdx = stageIndex(stages, activeStage);
  const idx = stageIndex(stages, stage);
  if (idx < 0) return "upcoming";
  if (stage === "trim" && trimDone && activeIdx >= stageIndex(stages, "trim")) return "done";
  if (idx < activeIdx) return "done";
  if (idx === activeIdx) return "active";
  return "upcoming";
}

function FactorList({ factors }: { factors: SpxPlayPayload["factors"] }) {
  if (!factors.length) {
    return <p className="spx-stage-detail-empty">Factors populate as the engine scores the tape.</p>;
  }
  return (
    <ul className="spx-stage-detail-factors">
      {factors.slice(0, 10).map((f) => (
        <li key={`${f.label}-${f.detail}`}>
          <span className={clsx(f.weight > 0 && "text-bull", f.weight < 0 && "text-bear")}>{f.label}</span>
          <span className="text-sky-300/80">{f.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function StructureStageDetail({
  stage,
  play,
  confirmationLayer,
}: {
  stage: TradeStageId;
  play: SpxPlayPayload;
  confirmationLayer: PlayConfirmationLayer | null;
}) {
  const open = play.open_play;

  if (stage === "hold") {
    return (
      <div className="spx-stage-detail-body">
        <p className="spx-stage-detail-headline">{play.headline}</p>
        <p className="spx-stage-detail-thesis">{play.thesis}</p>
        {open && (
          <p className="spx-stage-detail-meta">
            Entry {fmtPrice(open.entry_price)}
            {open.mfe_pts ? ` · MFE +${open.mfe_pts.toFixed(1)} pts` : ""}
            {open.option_label ? ` · ${open.option_label}` : ""}
          </p>
        )}
        <FactorList factors={play.factors} />
        {confirmationLayer && play.action === "HOLD" && (
          <ul className="spx-stage-detail-checks">
            {confirmationLayer.confirmations.checks.slice(0, 6).map((c) => (
              <li key={c.label} className={c.passed ? "text-bull" : "text-bear"}>
                {c.label}: {c.detail}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (stage === "trim") {
    const mfe = open?.mfe_pts ?? 0;
    const target = open?.target ?? play.levels.target;
    const progress =
      target != null && open?.entry_price != null
        ? Math.min(1, Math.max(0, mfe / Math.abs(target - open.entry_price)))
        : null;
    return (
      <div className="spx-stage-detail-body">
        <p className="spx-stage-detail-headline">
          {play.action === "TRIM" ? play.headline : "Trim zone — bank partial, trail runner"}
        </p>
        <p className="spx-stage-detail-thesis">
          {play.action === "TRIM"
            ? play.thesis
            : open?.trim_done
              ? "Partial banked — runner on trail."
              : `Triggers near +12 pts MFE with ~70% progress to target${progress != null ? ` (${Math.round(progress * 100)}%)` : ""}.`}
        </p>
        {open && (
          <p className="spx-stage-detail-meta">
            MFE +{mfe.toFixed(1)} pts
            {open.trim_done ? " · trim logged" : " · trim pending"}
          </p>
        )}
        <FactorList factors={play.factors.filter((f) => /target|mfe|trail|progress|trim/i.test(f.detail + f.label))} />
        {!play.factors.length && <FactorList factors={play.factors} />}
      </div>
    );
  }

  return (
    <div className="spx-stage-detail-body">
      <p className="spx-stage-detail-headline">
        {play.action === "SELL" ? play.headline : "Exit criteria — stop, target, session flat"}
      </p>
      <p className="spx-stage-detail-thesis">
        {play.action === "SELL"
          ? play.thesis
          : play.levels.invalidation || "Stop, target hit, thesis break, or session close flattens 0DTE."}
      </p>
      <div className="spx-stage-detail-levels">
        <div>
          <span>Stop</span>
          <strong>{fmtPrice(open?.stop ?? play.levels.stop)}</strong>
        </div>
        <div>
          <span>Target</span>
          <strong>{fmtPrice(open?.target ?? play.levels.target)}</strong>
        </div>
      </div>
      <FactorList factors={play.factors.filter((f) => /stop|target|invalid|session|theta|trail/i.test(f.detail + f.label))} />
    </div>
  );
}

function LottoStageDetail({ stage, lotto }: { stage: TradeStageId; lotto: LottoPlayPayload }) {
  if (stage === "sell") {
    return (
      <div className="spx-stage-detail-body">
        <p className="spx-stage-detail-headline">{lotto.headline}</p>
        <p className="spx-stage-detail-thesis">{lotto.thesis}</p>
        <p className="spx-stage-detail-meta">{lotto.status_message}</p>
      </div>
    );
  }
  return (
    <div className="spx-stage-detail-body">
      <p className="spx-stage-detail-headline">{lotto.headline}</p>
      <p className="spx-stage-detail-thesis">{lotto.thesis}</p>
      {lotto.catalyst_summary && <p className="spx-stage-detail-meta">{lotto.catalyst_summary}</p>}
      {lotto.invalidation && <p className="spx-stage-detail-meta">Invalidation: {lotto.invalidation}</p>}
    </div>
  );
}

function PowerStageDetail({ stage, power }: { stage: TradeStageId; power: PowerHourPlayPayload }) {
  if (stage === "sell") {
    return (
      <div className="spx-stage-detail-body">
        <p className="spx-stage-detail-headline">{power.headline}</p>
        <p className="spx-stage-detail-thesis">{power.thesis ?? power.status_message}</p>
      </div>
    );
  }
  return (
    <div className="spx-stage-detail-body">
      <p className="spx-stage-detail-headline">{power.headline}</p>
      <p className="spx-stage-detail-thesis">{power.thesis ?? power.status_message}</p>
      {power.pnl_pts != null && <p className="spx-stage-detail-meta">PnL {power.pnl_pts >= 0 ? "+" : ""}{power.pnl_pts.toFixed(1)} pts</p>}
    </div>
  );
}

export function SpxOpenPlayStageCard({
  item,
  play,
  lotto,
  powerHour,
  confirmationLayer,
  selectedStage,
  onSelectStage,
}: Props) {
  const { chip, stages, activeStage, trimDone } = item;
  const expanded = selectedStage ?? activeStage;

  return (
    <article className={clsx("spx-open-play-card", `spx-open-play-card--${chip.kind}`)}>
      <header className="spx-open-play-card-head">
        <span className="spx-open-play-card-kind">{chip.prefix ?? chip.kind}</span>
        <span className="spx-open-play-card-label">{chip.label}</span>
      </header>

      <div className="spx-open-play-stage-rail" role="group" aria-label="Trade management stages">
        {stages.map((stage, idx) => {
          const status = stageStatus(stages, activeStage, stage, trimDone);
          const isSell = stage === "sell";
          return (
            <div key={stage} className="spx-open-play-stage-segment-wrap">
              {idx > 0 && <span className="spx-open-play-stage-connector" aria-hidden />}
              <button
                type="button"
                className={clsx(
                  "spx-open-play-stage-btn",
                  status === "active" && "spx-open-play-stage-btn--active",
                  status === "done" && "spx-open-play-stage-btn--done",
                  expanded === stage && "spx-open-play-stage-btn--expanded",
                  isSell && "spx-open-play-stage-btn--sell"
                )}
                onClick={() => onSelectStage(stage)}
                aria-pressed={expanded === stage}
              >
                {isSell && <span className="spx-open-play-stage-x" aria-hidden>✕</span>}
                {STAGE_LABELS[stage]}
              </button>
            </div>
          );
        })}
      </div>

      <div className="spx-open-play-stage-detail">
        {chip.kind === "structure" && play && (
          <StructureStageDetail stage={expanded} play={play} confirmationLayer={confirmationLayer} />
        )}
        {chip.kind === "lotto" && lotto && <LottoStageDetail stage={expanded} lotto={lotto} />}
        {chip.kind === "power" && powerHour && <PowerStageDetail stage={expanded} power={powerHour} />}
      </div>
    </article>
  );
}
