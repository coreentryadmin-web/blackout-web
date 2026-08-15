import {
  normalizeVectorIntervalMinutes,
  type VectorTimeframeMinutes,
} from "@/features/vector/lib/vector-bar-timeframes";
import type { CandlestickBarInput, CandlestickDisplayBar } from "@/features/vector/lib/vector-candle-render";

/** Match Live Helix card flash duration. */
export const FLOW_CONFLUENCE_PULSE_MS = 2_000;
export const FLOW_CONFLUENCE_PULSE_INTERVAL_MS = 250;

export type FlowConfluenceTone = "bull" | "bear";

export type FlowConfluencePulse = {
  barTimeSec: number;
  tone: FlowConfluenceTone;
  startedAtMs: number;
};

const FLOW_PULSE_BULL_BORDER = "#d9f99d";
const FLOW_PULSE_BEAR_BORDER = "#fb7185";
const FLOW_PULSE_BULL_WICK = "#a3e635";
const FLOW_PULSE_BEAR_WICK = "#ff2d55";

/** Parse a Helix flow timestamp to unix seconds (SIP / alerted_at preferred). */
export function flowAlertTimeSec(alert: {
  alerted_at?: string | null;
  event_at?: string | null;
}): number | null {
  const raw = alert.alerted_at?.trim() || alert.event_at?.trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

/** Bucket a print time to the display bar key for the active chart interval. */
export function displayBarTimeForFlowPrint(
  printTimeSec: number,
  intervalMinutes: VectorTimeframeMinutes
): number {
  const interval = normalizeVectorIntervalMinutes(intervalMinutes);
  const bucketSec = Math.max(60, interval * 60);
  return Math.floor(printTimeSec / bucketSec) * bucketSec;
}

/** Resolve the bar time shown on chart for a flow print (exact bucket or last bar at/before print). */
export function resolveFlowPrintBarTime(
  printTimeSec: number,
  intervalMinutes: VectorTimeframeMinutes,
  displayBars: readonly { time: number }[]
): number | null {
  if (!Number.isFinite(printTimeSec) || !displayBars.length) return null;
  const bucket = displayBarTimeForFlowPrint(printTimeSec, intervalMinutes);
  for (const bar of displayBars) {
    if (bar.time === bucket) return bar.time;
  }
  let best: number | null = null;
  for (const bar of displayBars) {
    if (bar.time <= printTimeSec) best = bar.time;
    else break;
  }
  return best;
}

/** Alternating bright/dim border for a ~2s pulse (phase 0..1 toggles each interval tick). */
export function flowConfluencePulseIntensity(startedAtMs: number, nowMs: number): number {
  const elapsed = nowMs - startedAtMs;
  if (elapsed < 0 || elapsed >= FLOW_CONFLUENCE_PULSE_MS) return 0;
  const tick = Math.floor(elapsed / FLOW_CONFLUENCE_PULSE_INTERVAL_MS);
  return tick % 2 === 0 ? 1 : 0.45;
}

export function flowConfluenceBorderColors(
  tone: FlowConfluenceTone,
  intensity: number
): { borderColor: string; wickColor: string } {
  if (intensity <= 0) {
    return { borderColor: "", wickColor: "" };
  }
  const border = tone === "bull" ? FLOW_PULSE_BULL_BORDER : FLOW_PULSE_BEAR_BORDER;
  const wick = tone === "bull" ? FLOW_PULSE_BULL_WICK : FLOW_PULSE_BEAR_WICK;
  if (intensity >= 0.99) return { borderColor: border, wickColor: wick };
  return {
    borderColor: withAlphaHex(border, 0.55 + intensity * 0.45),
    wickColor: withAlphaHex(wick, 0.55 + intensity * 0.45),
  };
}

function withAlphaHex(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Apply active flow-confluence pulses on top of base candle display data. */
export function applyFlowConfluenceToCandles<T extends CandlestickBarInput>(
  bars: readonly CandlestickDisplayBar[],
  pulses: readonly FlowConfluencePulse[],
  nowMs: number
): CandlestickDisplayBar[] {
  if (!pulses.length) return bars as CandlestickDisplayBar[];
  const active = pulses.filter((p) => nowMs < p.startedAtMs + FLOW_CONFLUENCE_PULSE_MS);
  if (!active.length) return bars as CandlestickDisplayBar[];
  const byTime = new Map<number, FlowConfluencePulse>();
  for (const pulse of active) {
    byTime.set(pulse.barTimeSec, pulse);
  }
  return bars.map((bar) => {
    const pulse = byTime.get(bar.time);
    if (!pulse) return bar;
    const intensity = flowConfluencePulseIntensity(pulse.startedAtMs, nowMs);
    if (intensity <= 0) return bar;
    const { borderColor, wickColor } = flowConfluenceBorderColors(pulse.tone, intensity);
    return { ...bar, borderColor, wickColor, color: bar.color };
  });
}

export function toneFromFlowSide(optionType: string | undefined | null): FlowConfluenceTone {
  return optionType?.toUpperCase() === "CALL" ? "bull" : "bear";
}
