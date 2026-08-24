"use client";

import { VectorDteToggle } from "@/features/vector/components/VectorDteToggle";

import { VectorLensToggle } from "@/features/vector/components/VectorLensToggle";
import { VectorBeadRailToggle } from "@/features/vector/components/VectorBeadRailToggle";
import { VectorNodesToggle } from "@/features/vector/components/VectorNodesToggle";
import { VectorVolumeModeToggle } from "@/features/vector/components/VectorVolumeModeToggle";
import { VectorDarkPoolToggle } from "@/features/vector/components/VectorDarkPoolToggle";
import { VectorReplayControls } from "@/features/vector/components/VectorReplayControls";
import { VectorTimeframeSelect } from "@/features/vector/components/VectorTimeframeSelect";
import { VectorIndicatorMenu } from "@/features/vector/components/VectorIndicatorMenu";
import {
  VectorDrawToolsMenu,
  type VectorDrawToolsProps,
} from "@/features/vector/components/VectorDrawToolbar";
import type { VectorWallLens } from "@/features/vector/lib/vector-wall-history";
import type { VectorTimeframeMinutes } from "@/features/vector/lib/vector-bar-timeframes";
import type { VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import type { VectorIndicatorId, VectorOpeningRangeMinutes } from "@/features/vector/lib/vector-indicators-config";
import type { VectorNodeDensity } from "@/features/vector/lib/vector-node-density";
import type { VectorVolumeMode } from "@/features/vector/lib/vector-volume-render";

type Props = {
  interval: VectorTimeframeMinutes;
  onInterval: (minutes: VectorTimeframeMinutes) => void;
  timeframeDisabled?: boolean;
  lens: VectorWallLens;
  vexAvailable: boolean;
  onLens: (lens: VectorWallLens) => void;
  dteHorizon: VectorDteHorizon;
  onDteHorizon: (h: VectorDteHorizon) => void;
  dteAvailable: boolean;
  gexAsOf?: number | null;
  vexAsOf?: number | null;
  liveSession?: boolean;
  replayMode: boolean;
  playing: boolean;
  canReplay: boolean;
  cursorIndex: number;
  stepCount: number;
  clockLabel: string;
  speed: number;
  loop: boolean;
  onToggleReplay: () => void;
  onTogglePlay: () => void;
  onScrub: (index: number) => void;
  onSpeed: (speed: number) => void;
  onStep: (delta: number) => void;
  onJumpOpen: () => void;
  onJumpClose: () => void;
  onToggleLoop: () => void;
  indicators: Set<VectorIndicatorId>;
  onToggleIndicator: (id: VectorIndicatorId) => void;
  onClearIndicators: () => void;
  /** Bars currently shown (at the active timeframe) — drives the MA "not enough bars" annotation. */
  barCount: number;
  /** Selected opening-range window (5m/15m/30m/60m) and its setter — drives the indicator menu's
   *  "Opening range (Nm)" label + preset control (2026-08-05 audit finding #7). */
  openingRangeMinutes: VectorOpeningRangeMinutes;
  onOpeningRangeMinutes: (minutes: VectorOpeningRangeMinutes) => void;
  /** Compact page title/ticker cluster, rendered at the far LEFT of the toolbar row (so the header
   *  and the timeframe/indicator controls share one line instead of a tall separate header block). */
  leadSlot?: React.ReactNode;
  /** Host-desk slot rendered immediately LEFT of the Replay controls (2026-07-14). */
  replayLeadSlot?: React.ReactNode;
  /** Freshness/status chip, rendered at the far RIGHT of the toolbar row, aligned with the title. */
  trailSlot?: React.ReactNode;
  /** Compare command bar owns TF/DTE/lens — hide them in each pane toolbar. */
  hideLinkedControls?: boolean;
  /** Compare grid pane — one slim row (indicators + replay only). */
  comparePane?: boolean;
  /** Compare linked mode — replay transport lives in the command bar. */
  hideReplayControls?: boolean;
  /** Member drawing tools — consolidated under one Tools dropdown. */
  drawTools?: VectorDrawToolsProps;
  /** NODES control — wall/bead rows per side. "auto" follows the timeframe (today's behaviour). */
  nodeDensity: VectorNodeDensity;
  onNodeDensity: (density: VectorNodeDensity) => void;
  /** What "auto" resolves to right now, so the AUTO chip can show a real count. */
  nodeAutoCount: number;
  /** Volume sub-pane paint mode (RVOL / pressure / direction). Hidden when volume pane omitted. */
  volumeMode?: VectorVolumeMode;
  onVolumeMode?: (mode: VectorVolumeMode) => void;
  hideVolumePane?: boolean;
  darkPoolWallsEnabled?: boolean;
  onDarkPoolWalls?: (enabled: boolean) => void;
};

/** Single compact toolbar — timeframe left, replay + lens right. */
export function VectorToolbar(props: Props) {
  const {
    interval,
    onInterval,
    timeframeDisabled,
    lens,
    vexAvailable,
    onLens,
    dteHorizon,
    onDteHorizon,
    dteAvailable,
    gexAsOf,
    vexAsOf,
    liveSession,
    replayMode,
    playing,
    canReplay,
    cursorIndex,
    stepCount,
    clockLabel,
    speed,
    loop,
    onToggleReplay,
    onTogglePlay,
    onScrub,
    onSpeed,
    onStep,
    onJumpOpen,
    onJumpClose,
    onToggleLoop,
    indicators,
    onToggleIndicator,
    onClearIndicators,
    barCount,
    openingRangeMinutes,
    onOpeningRangeMinutes,
    leadSlot,
    trailSlot,
    replayLeadSlot,
    hideLinkedControls = false,
    comparePane = false,
    hideReplayControls = false,
    drawTools,
    nodeDensity,
    onNodeDensity,
    nodeAutoCount,
    volumeMode = "relative",
    onVolumeMode,
    hideVolumePane = false,
    darkPoolWallsEnabled = false,
    onDarkPoolWalls,
  } = props;

  const drawMenu = drawTools ? <VectorDrawToolsMenu {...drawTools} /> : null;

  if (comparePane) {
    return (
      <div
        className="vector-toolbar vector-toolbar--compare-pane ios-compact-toolbar mb-1"
        role="group"
        aria-label="Chart controls"
      >
        <div className="vector-toolbar-compare-row">
          <VectorIndicatorMenu
            enabled={indicators}
            onToggle={onToggleIndicator}
            onClear={onClearIndicators}
            barCount={barCount}
            openingRangeMinutes={openingRangeMinutes}
            onOpeningRangeMinutes={onOpeningRangeMinutes}
          />
          <VectorBeadRailToggle enabled={indicators} onToggle={onToggleIndicator} lens={lens} />
          {/* NODES was absent from this branch only — a compare pane is where row count matters MOST
              (four charts, quarter the height each) and it was the one place a member could not
              change it. testids off: four panes would otherwise emit the same id four times. */}
          <VectorNodesToggle
            value={nodeDensity}
            onChange={onNodeDensity}
            autoCount={nodeAutoCount}
            exposeTestIds={false}
          />
          {drawMenu}
          {replayLeadSlot}
          {!hideReplayControls ? (
            <VectorReplayControls
              replayMode={replayMode}
              playing={playing}
              canReplay={canReplay}
              cursorIndex={cursorIndex}
              stepCount={stepCount}
              clockLabel={clockLabel}
              speed={speed}
              loop={loop}
              onToggleReplay={onToggleReplay}
              onTogglePlay={onTogglePlay}
              onScrub={onScrub}
              onSpeed={onSpeed}
              onStep={onStep}
              onJumpOpen={onJumpOpen}
              onJumpClose={onJumpClose}
              onToggleLoop={onToggleLoop}
            />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="vector-toolbar ios-compact-toolbar mb-2" role="group" aria-label="Chart timeframe">
      <div className="vector-toolbar-row-primary ios-compact-scroll-row">
        {leadSlot}
        {!hideLinkedControls ? (
          <VectorTimeframeSelect
            interval={interval}
            onInterval={onInterval}
            disabled={timeframeDisabled}
            exposeTestIds={false}
            idSuffix="-compact"
          />
        ) : null}
        <VectorIndicatorMenu
          enabled={indicators}
          onToggle={onToggleIndicator}
          onClear={onClearIndicators}
          barCount={barCount}
          openingRangeMinutes={openingRangeMinutes}
          onOpeningRangeMinutes={onOpeningRangeMinutes}
        />
        {drawMenu}
        {replayLeadSlot}
        <VectorReplayControls
          replayMode={replayMode}
          playing={playing}
          canReplay={canReplay}
          cursorIndex={cursorIndex}
          stepCount={stepCount}
          clockLabel={clockLabel}
          speed={speed}
          loop={loop}
          onToggleReplay={onToggleReplay}
          onTogglePlay={onTogglePlay}
          onScrub={onScrub}
          onSpeed={onSpeed}
          onStep={onStep}
          onJumpOpen={onJumpOpen}
          onJumpClose={onJumpClose}
          onToggleLoop={onToggleLoop}
        />
      </div>
      <div className="vector-toolbar-row-secondary ios-compact-scroll-row">
        {!hideLinkedControls ? (
          <VectorLensToggle
            lens={lens}
            vexAvailable={vexAvailable}
            onLens={onLens}
            gexAsOf={gexAsOf}
            vexAsOf={vexAsOf}
            liveSession={liveSession}
            exposeTestIds={false}
          />
        ) : null}
        {!hideLinkedControls ? (
          <VectorDteToggle
            ladderOnly={lens === "vex"}
            horizon={dteHorizon}
            onHorizon={onDteHorizon}
            available={dteAvailable}
            disabled={replayMode}
          />
        ) : null}
        <VectorBeadRailToggle
          enabled={indicators}
          onToggle={onToggleIndicator}
          lens={lens}
          exposeTestIds={false}
        />
        <VectorNodesToggle
          value={nodeDensity}
          onChange={onNodeDensity}
          autoCount={nodeAutoCount}
          exposeTestIds={false}
        />
        {!hideVolumePane && onVolumeMode ? (
          <VectorVolumeModeToggle value={volumeMode} onChange={onVolumeMode} exposeTestIds={false} />
        ) : null}
        {onDarkPoolWalls ? (
          <VectorDarkPoolToggle
            enabled={darkPoolWallsEnabled}
            onChange={onDarkPoolWalls}
            exposeTestIds={false}
          />
        ) : null}
        {trailSlot}
      </div>

      {/* Desktop — single aligned control bar */}
      <div className="vector-toolbar-desk">
        <div className="vector-toolbar-desk-left">{leadSlot}</div>
        <div className="vector-toolbar-desk-mid">
          {!hideLinkedControls ? (
            <VectorTimeframeSelect interval={interval} onInterval={onInterval} disabled={timeframeDisabled} />
          ) : null}
          <VectorIndicatorMenu
            enabled={indicators}
            onToggle={onToggleIndicator}
            onClear={onClearIndicators}
            barCount={barCount}
            openingRangeMinutes={openingRangeMinutes}
            onOpeningRangeMinutes={onOpeningRangeMinutes}
          />
          {drawMenu}
        </div>
        <div className="vector-toolbar-desk-spacer" aria-hidden="true" />
        <div className="vector-toolbar-desk-right">
          {replayLeadSlot}
          <VectorReplayControls
            replayMode={replayMode}
            playing={playing}
            canReplay={canReplay}
            cursorIndex={cursorIndex}
            stepCount={stepCount}
            clockLabel={clockLabel}
            speed={speed}
            loop={loop}
            onToggleReplay={onToggleReplay}
            onTogglePlay={onTogglePlay}
            onScrub={onScrub}
            onSpeed={onSpeed}
            onStep={onStep}
            onJumpOpen={onJumpOpen}
            onJumpClose={onJumpClose}
            onToggleLoop={onToggleLoop}
          />
          {!hideLinkedControls ? (
            <VectorLensToggle
              lens={lens}
              vexAvailable={vexAvailable}
              onLens={onLens}
              gexAsOf={gexAsOf}
              vexAsOf={vexAsOf}
              liveSession={liveSession}
            />
          ) : null}
          {!hideLinkedControls ? (
            <VectorDteToggle
              ladderOnly={lens === "vex"}
              horizon={dteHorizon}
              onHorizon={onDteHorizon}
              available={dteAvailable}
              disabled={replayMode}
            />
          ) : null}
          <VectorBeadRailToggle enabled={indicators} onToggle={onToggleIndicator} lens={lens} />
          <VectorNodesToggle value={nodeDensity} onChange={onNodeDensity} autoCount={nodeAutoCount} />
          {!hideVolumePane && onVolumeMode ? (
            <VectorVolumeModeToggle value={volumeMode} onChange={onVolumeMode} />
          ) : null}
          {onDarkPoolWalls ? (
            <VectorDarkPoolToggle enabled={darkPoolWallsEnabled} onChange={onDarkPoolWalls} />
          ) : null}
          {trailSlot}
        </div>
      </div>
    </div>
  );
}
