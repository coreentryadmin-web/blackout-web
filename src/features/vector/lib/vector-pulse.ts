/**
 * Vector Pulse — pure logic layer for the live signal feed that replaces the desk terminal.
 *
 * Architecture follows the SPX Live Voice pattern exactly: snapshot → diff → cooldown dedup.
 * The chart's existing callbacks (regime, proximity, magnet, wall integrity, wall events)
 * provide the structured data; this module detects TRANSITIONS across consecutive ticks and
 * emits keyed signals for the UI feed. Pure, deterministic, no I/O, no Date.now().
 *
 * Signal kinds (priority order):
 *  1. play-state     — 0DTE play phase change (SCANNING→WATCHING→OPEN) — SPX only
 *  2. regime-flip    — gamma posture change (long↔short↔transition)
 *  3. wall-structure — wall shift/build/fade/break events (passthrough from VectorChart)
 *  4. proximity      — spot approaching/testing/at a key level, or leaving proximity
 *  5. magnet-shift   — dealer hedging center of mass crossed spot
 *  6. integrity      — wall confidence tier changed (firm↔moderate↔thin)
 *  7. flow-print     — large options flow print (sweeps, blocks, dark pool)
 */

import type { VectorRegime, VectorRegimePosture } from "./vector-regime";
import type { WallProximity, WallProximitySide } from "./vector-wall-proximity";
import type { GammaMagnet, GammaMagnetPull } from "./vector-gamma-magnet";
import type { WallIntegrity, WallIntegrityTier } from "./vector-wall-integrity";
import type { VectorWallEvent } from "./vector-wall-events";
import type { FlowAlert } from "@/lib/api";

// ---------------------------------------------------------------------------
// Signal — the unit of the live event feed
// ---------------------------------------------------------------------------

export type PulseSignalTone = "bull" | "bear" | "warn" | "info";

export type PulseSignalKind =
  | "play-state"
  | "regime-flip"
  | "proximity"
  | "magnet-shift"
  | "integrity"
  | "wall-structure"
  | "flow-print"
  // ── SPX Pulse taxonomy (2026-07-26, additive) — never emitted by the Vector engine,
  //    only by src/features/spx/lib/spx-pulse.ts. Declared here so the SEVERITY tier map
  //    and PulseSignal type stay a single source of truth across both surfaces. ──
  | "wall-break"
  | "macro-window"
  | "pin-shift"
  | "wall-build"
  | "vol-regime"
  | "session-phase";

/**
 * Curation severity (2026-07-26). Tier 1 = regime-defining (pinned, never rate-capped);
 * Tier 2 = structural; Tier 3 = contextual. Additive: the Vector render ignores it, the
 * SPX rail pins/streams by it.
 */
export type PulseSeverityTier = 1 | 2 | 3;

export type PulseMagnitudeUnit = "points" | "notional" | "percent" | "contracts" | "premium";

/**
 * A quantified magnitude payload for a signal — the "how much" behind the "what". `value`
 * is signed where a direction is meaningful (Δpts, Δnotional); `label` is the pre-formatted
 * mono chip the rail renders verbatim so the display math lives with the number.
 */
export type PulseMagnitude = {
  unit: PulseMagnitudeUnit;
  value: number;
  label: string;
};

export type PulseSignal = {
  key: string;
  kind: PulseSignalKind;
  tone: PulseSignalTone;
  line: string;
  at: number;
  // ── Optional enrichment (2026-07-26). All additive: existing Vector-emitted signals
  //    omit them and render exactly as before. ──
  /** Severity tier — defaults (when absent) to the kind's TIER_BY_KIND entry. */
  tier?: PulseSeverityTier;
  /** One or more quantified magnitudes (γ-notional Δ, points, %, contracts). */
  magnitude?: PulseMagnitude[];
  /** The trade implication — "dealers now amplify moves". Dim second line on the row. */
  implication?: string;
  /** One-line WHY revealed under the expand chevron. */
  why?: string;
  /** Numeric level this signal is anchored to (strike/price) — powers (kind, level) dedup. */
  level?: number | null;
};

// ---------------------------------------------------------------------------
// Snapshot — the diffable state at one tick
// ---------------------------------------------------------------------------

export type PulseSnapshot = {
  at: number;
  regimePosture: VectorRegimePosture;
  proximityStrike: number | null;
  proximitySide: WallProximitySide | null;
  proximityNearness: "near" | "testing" | "at" | null;
  magnetPull: GammaMagnetPull | null;
  magnetStrike: number | null;
  callIntegrityTier: WallIntegrityTier | null;
  putIntegrityTier: WallIntegrityTier | null;
  wallEventCount: number;
};

export function buildPulseSnapshot(input: {
  at: number;
  regime: VectorRegime;
  proximity: WallProximity | null;
  magnet: GammaMagnet | null;
  wallIntegrity: { call: WallIntegrity | null; put: WallIntegrity | null };
  wallEventCount: number;
}): PulseSnapshot {
  return {
    at: input.at,
    regimePosture: input.regime.posture,
    proximityStrike: input.proximity?.strike ?? null,
    proximitySide: input.proximity?.side ?? null,
    proximityNearness: input.proximity?.nearness ?? null,
    magnetPull: input.magnet?.pull ?? null,
    magnetStrike: input.magnet?.strike ?? null,
    callIntegrityTier: input.wallIntegrity.call?.tier ?? null,
    putIntegrityTier: input.wallIntegrity.put?.tier ?? null,
    wallEventCount: input.wallEventCount,
  };
}

// ---------------------------------------------------------------------------
// Transition detector
// ---------------------------------------------------------------------------

const MAX_SIGNALS_PER_TICK = 6;

function fmtLevel(v: number): string {
  return Math.round(v).toLocaleString("en-US");
}

function nearnessRank(n: "near" | "testing" | "at"): number {
  return n === "near" ? 1 : n === "testing" ? 2 : 3;
}

function tierRank(t: WallIntegrityTier): number {
  return t === "thin" ? 1 : t === "moderate" ? 2 : 3;
}

export function detectPulseSignals(
  prev: PulseSnapshot | null,
  next: PulseSnapshot
): PulseSignal[] {
  if (!prev) return [];
  const at = next.at;
  const signals: PulseSignal[] = [];

  // 1) Regime flip — the highest-priority signal.
  if (
    prev.regimePosture !== next.regimePosture &&
    next.regimePosture !== "unknown"
  ) {
    const tone: PulseSignalTone =
      next.regimePosture === "long"
        ? "bull"
        : next.regimePosture === "short"
          ? "bear"
          : "warn";

    const desc =
      next.regimePosture === "long"
        ? "LONG GAMMA — dealers dampen moves, fade extremes"
        : next.regimePosture === "short"
          ? "SHORT GAMMA — dealers amplify moves, trade momentum"
          : "AT GAMMA FLIP — regime undecided, sharpest moves here";

    signals.push({
      key: `regime:${prev.regimePosture}->${next.regimePosture}`,
      kind: "regime-flip",
      tone,
      at,
      line: `⚡ regime flipped → ${desc}`,
    });
  }

  // 2) Proximity — new level entered or nearness escalated. "near" is deliberately silent (2026-08-05
  //    signal-quality pass): it's the lowest-conviction tier and fires on every minor drift toward
  //    ANY level, which was the single biggest source of feed noise members complained about. Only
  //    "testing"/"at" — genuinely actionable proximity — reaches the feed. The old "spot moved to
  //    open space" clear message is also gone: it announced an absence of information, never a fact
  //    worth a member's attention, so it was pure filler.
  if (
    next.proximityNearness &&
    next.proximityNearness !== "near" &&
    next.proximityStrike != null
  ) {
    const sideLabel =
      next.proximitySide === "flip"
        ? "gamma flip"
        : next.proximitySide === "call"
          ? "call wall"
          : "put wall";

    const levelChanged =
      !prev.proximityStrike ||
      prev.proximitySide !== next.proximitySide ||
      Math.abs((prev.proximityStrike ?? 0) - next.proximityStrike) > 1;

    if (levelChanged) {
      signals.push({
        key: `prox:enter:${next.proximitySide}:${Math.round(next.proximityStrike)}`,
        kind: "proximity",
        tone: next.proximityNearness === "at" ? "warn" : "info",
        at,
        line: `🎯 approaching ${sideLabel} ${fmtLevel(next.proximityStrike)} — ${next.proximityNearness}`,
      });
    } else if (
      prev.proximityNearness &&
      nearnessRank(next.proximityNearness) > nearnessRank(prev.proximityNearness)
    ) {
      const verb = next.proximityNearness === "at" ? "AT" : "TESTING";
      signals.push({
        key: `prox:${next.proximityNearness}:${next.proximitySide}:${Math.round(next.proximityStrike)}`,
        kind: "proximity",
        tone: next.proximityNearness === "at" ? "warn" : "info",
        at,
        line: `🔥 ${verb} ${sideLabel} ${fmtLevel(next.proximityStrike)} — ${next.proximitySide === "flip" ? "cross flips the regime" : "dealers defending this level"}`,
      });
    }
  }

  // 3) Magnet pull direction change.
  if (
    prev.magnetPull &&
    next.magnetPull &&
    prev.magnetPull !== next.magnetPull &&
    next.magnetStrike != null
  ) {
    signals.push({
      key: `magnet:${prev.magnetPull}->${next.magnetPull}`,
      kind: "magnet-shift",
      tone: next.magnetPull === "up" ? "bull" : next.magnetPull === "down" ? "bear" : "info",
      at,
      line: `🧲 gamma center of mass shifted ${next.magnetPull === "up" ? "above" : next.magnetPull === "down" ? "below" : "onto"} spot (${fmtLevel(next.magnetStrike)})`,
    });
  }

  // 4) Wall integrity tier changes — only the DEGRADED direction is worth an alert (2026-08-05):
  //    a wall "weakening" changes what a member should trust; a wall "strengthening" is an
  //    affirmation of the status quo, not new information to act on, and was pure noise.
  for (const side of ["call", "put"] as const) {
    const prevTier = side === "call" ? prev.callIntegrityTier : prev.putIntegrityTier;
    const nextTier = side === "call" ? next.callIntegrityTier : next.putIntegrityTier;
    if (prevTier && nextTier && prevTier !== nextTier && tierRank(nextTier) < tierRank(prevTier)) {
      signals.push({
        key: `integrity:${side}:${nextTier}`,
        kind: "integrity",
        tone: "warn",
        at,
        line: `⚠️ ${side} wall confidence ${prevTier} → ${nextTier} — weakening, don't over-trust`,
      });
    }
  }

  return signals.slice(0, MAX_SIGNALS_PER_TICK);
}

// ---------------------------------------------------------------------------
// Cooldown dedup — same discipline as SPX Live Voice filterFreshVoiceEvents
// ---------------------------------------------------------------------------

const DEFAULT_COOLDOWN_MS = 4 * 60 * 1000;

export function filterFreshPulseSignals(
  signals: PulseSignal[],
  seenAtByKey: Record<string, number>,
  nowMs: number,
  cooldownMs = DEFAULT_COOLDOWN_MS
): { fresh: PulseSignal[]; seen: Record<string, number> } {
  const seen: Record<string, number> = {};
  for (const [k, t] of Object.entries(seenAtByKey)) {
    if (nowMs - t < cooldownMs * 4) seen[k] = t;
  }
  const fresh: PulseSignal[] = [];
  for (const signal of signals) {
    const last = seen[signal.key];
    if (last != null && nowMs - last < cooldownMs) continue;
    seen[signal.key] = nowMs;
    fresh.push(signal);
  }
  return { fresh, seen };
}

// ---------------------------------------------------------------------------
// Wall event → PulseSignal conversion
// ---------------------------------------------------------------------------

export function wallEventToPulseSignal(ev: VectorWallEvent): PulseSignal {
  const tone: PulseSignalTone =
    ev.severity === "warn"
      ? "warn"
      : ev.kind.startsWith("call_wall") || ev.kind === "spot_broke_put"
        ? "bull"
        : ev.kind.startsWith("put_wall") || ev.kind === "spot_broke_call"
          ? "bear"
          : ev.kind === "spot_crossed_flip"
            ? "warn"
            : "info";

  return {
    key: `wall:${ev.kind}:${ev.time}`,
    kind: "wall-structure",
    tone,
    line: ev.message,
    at: ev.time * 1000,
  };
}

// ---------------------------------------------------------------------------
// Play state → PulseSignal (0DTE play engine transitions)
// ---------------------------------------------------------------------------

export type PlayPhase = "SCANNING" | "WATCHING" | "OPEN";

export type PlayStateSnapshot = {
  phase: PlayPhase;
  direction: string | null;
  grade: string;
  headline: string;
  score: number;
  optionLabel: string | null;
};

export function detectPlayStateSignals(
  prev: PlayStateSnapshot | null,
  next: PlayStateSnapshot,
  at: number
): PulseSignal[] {
  if (!prev) return [];
  if (prev.phase === next.phase) return [];

  const signals: PulseSignal[] = [];

  if (next.phase === "OPEN") {
    const dir = next.direction === "long" ? "CALLS" : "PUTS";
    const label = next.optionLabel ? ` — ${next.optionLabel}` : "";
    signals.push({
      key: `play:open:${at}`,
      kind: "play-state",
      tone: next.direction === "long" ? "bull" : "bear",
      at,
      line: `🎯 PLAY OPENED ${dir} (${next.grade})${label}`,
    });
  } else if (prev.phase === "OPEN") {
    signals.push({
      key: `play:close:${at}`,
      kind: "play-state",
      tone: "info",
      at,
      line: "⏹ play closed — back to scanning",
    });
  } else if (next.phase === "WATCHING" && prev.phase === "SCANNING") {
    const dir = next.direction === "long" ? "long" : next.direction === "short" ? "short" : "—";
    signals.push({
      key: `play:watch:${at}`,
      kind: "play-state",
      tone: "warn",
      at,
      line: `👁 WATCHING ${dir} setup (${next.grade}, score ${next.score}) — ${next.headline}`,
    });
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Flow alert → PulseSignal (large options prints from Helix)
// ---------------------------------------------------------------------------

// Aligned to the app-wide WHALE_PREMIUM bar (Helix's TickerDrawer/HelixFlowTable use the same
// $1M floor for "whale" prints) rather than a bespoke Pulse-only number (2026-08-05 signal-quality
// pass) — the old $500K floor let through a volume of routine prints members didn't consider
// noteworthy relative to what the rest of the app already calls "big".
const FLOW_MIN_PREMIUM = 1_000_000;

function fmtPremium(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${(n / 1_000).toFixed(0)}K`;
}

export function flowAlertToPulseSignal(flow: FlowAlert, at: number): PulseSignal | null {
  if (flow.premium < FLOW_MIN_PREMIUM) return null;

  const dir = flow.direction?.toLowerCase() ?? "";
  const isBullish = (flow.option_type === "call" && dir.includes("buy")) ||
    (flow.option_type === "put" && dir.includes("sell"));
  const isBearish = (flow.option_type === "put" && dir.includes("buy")) ||
    (flow.option_type === "call" && dir.includes("sell"));

  // A print that's neither clearly bullish nor bearish (route/side ambiguous) can't be acted on —
  // drop it rather than surface an "INFO" row a member has to parse and then discard themselves.
  if (!isBullish && !isBearish) return null;

  const tone: PulseSignalTone = isBullish ? "bull" : "bear";

  const route = flow.route ? ` [${flow.route}]` : "";
  const gex = flow.gex_proximity ? ` · ${flow.gex_proximity.replace(/_/g, " ")}` : "";

  return {
    key: `flow:${flow.alert_id ?? `${flow.ticker}:${flow.strike}:${flow.expiry}:${at}`}`,
    kind: "flow-print",
    tone,
    at,
    line: `💰 ${fmtPremium(flow.premium)} ${flow.ticker} ${flow.strike}${flow.option_type === "call" ? "C" : "P"} ${flow.expiry} ${dir}${route}${gex}`,
  };
}

/** Filter flows to only those above the noise floor. */
export function isSignificantFlow(flow: FlowAlert): boolean {
  return flow.premium >= FLOW_MIN_PREMIUM;
}

/** Max signals kept in the feed — older ones pruned to bound memory. */
export const PULSE_FEED_MAX = 50;

// ---------------------------------------------------------------------------
// Severity tiers + curation primitives (2026-07-26, shared with the SPX engine).
// All pure + additive — the Vector render path never calls them, so Vector's
// existing behaviour is byte-for-byte unchanged.
// ---------------------------------------------------------------------------

/** Default severity per kind. `tier` on a signal overrides this when present. */
export const TIER_BY_KIND: Record<PulseSignalKind, PulseSeverityTier> = {
  // Tier 1 — regime-defining, pinned, never rate-capped.
  "regime-flip": 1,
  "wall-break": 1,
  "macro-window": 1,
  // Tier 2 — structural.
  "magnet-shift": 2,
  "pin-shift": 2,
  "wall-build": 2,
  "vol-regime": 2,
  "integrity": 2,
  "wall-structure": 2,
  // Tier 3 — contextual.
  "flow-print": 3,
  "session-phase": 3,
  "play-state": 3,
  "proximity": 3,
};

export function severityTierForKind(kind: PulseSignalKind): PulseSeverityTier {
  return TIER_BY_KIND[kind] ?? 3;
}

/** Effective tier of a signal — its explicit `tier`, else the kind default. */
export function signalTier(sig: PulseSignal): PulseSeverityTier {
  return sig.tier ?? severityTierForKind(sig.kind);
}

/**
 * (kind, level) dedup within a window. Two signals of the same kind anchored to the same
 * rounded level inside `windowMs` collapse to one — e.g. a wall that builds, ticks, and
 * builds again at 7,530 prints once. Level falls back to the signal `key` when no numeric
 * `level` is set, so keyed-but-levelless signals still dedup on identity. Pure.
 */
export function dedupeByKindLevel(
  signals: PulseSignal[],
  seenAtByKindLevel: Record<string, number>,
  nowMs: number,
  windowMs = 90 * 1000
): { kept: PulseSignal[]; seen: Record<string, number> } {
  const seen: Record<string, number> = {};
  for (const [k, t] of Object.entries(seenAtByKindLevel)) {
    if (nowMs - t < windowMs * 4) seen[k] = t;
  }
  const kept: PulseSignal[] = [];
  for (const sig of signals) {
    const levelKey = sig.level != null ? `${Math.round(sig.level)}` : sig.key;
    const composite = `${sig.kind}:${levelKey}`;
    const last = seen[composite];
    if (last != null && nowMs - last < windowMs) continue;
    seen[composite] = nowMs;
    kept.push(sig);
  }
  return { kept, seen };
}

/** Default global cap — no more than this many NON-tier-1 signals per rolling minute. */
export const DEFAULT_RATE_CAP_PER_MIN = 6;

/**
 * Global rate cap (≤N NON-tier-1/min). Tier-1 signals (regime-defining) ALWAYS pass — a wall
 * break or γ-flip is never suppressed for volume, and does NOT consume the lower-tier budget.
 * Lower-tier signals fill the remaining budget highest-severity-then-newest first; the
 * overflow is dropped (it will re-fire on its next transition if still live). `recentEmitTimes`
 * is the ledger of recent NON-tier-1 emit times. Pure: returns the emitted set and the pruned
 * ledger for the next call.
 */
export function applyGlobalRateCap(
  candidates: PulseSignal[],
  recentEmitTimes: number[],
  nowMs: number,
  opts?: { maxPerMin?: number; windowMs?: number }
): { emitted: PulseSignal[]; recent: number[] } {
  const windowMs = opts?.windowMs ?? 60 * 1000;
  const maxPerMin = opts?.maxPerMin ?? DEFAULT_RATE_CAP_PER_MIN;
  const recent = recentEmitTimes.filter((t) => nowMs - t < windowMs);

  // Tier-1 first (bypass), then tier asc + newest first for the budgeted remainder.
  const ordered = [...candidates].sort((a, b) => {
    const ta = signalTier(a);
    const tb = signalTier(b);
    if (ta !== tb) return ta - tb;
    return b.at - a.at;
  });

  const emitted: PulseSignal[] = [];
  for (const sig of ordered) {
    if (signalTier(sig) === 1) {
      emitted.push(sig); // regime-defining — never rate-capped, never consumes the budget
      continue;
    }
    if (recent.length >= maxPerMin) continue; // non-tier-1 budget spent — drop the overflow
    emitted.push(sig);
    recent.push(nowMs);
  }
  // Emit in chronological order (newest-first is applied by the feed, not here).
  emitted.sort((a, b) => a.at - b.at);
  return { emitted, recent };
}
