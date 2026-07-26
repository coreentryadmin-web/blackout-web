// BLACKOUT — SPX PULSE ENGINE (2026-07-26).
//
// The SPX-side detector that feeds the ⚡ PULSE rail (SpxPulseRail) that replaces Largo on
// the SPX Slayer desk. It is the SPX→Pulse ADAPTER the task called for: rather than invent a
// second desk normalizer, it consumes the SAME `SpxVoiceSnapshot` the Largo brain already
// derives from the merged desk (voiceSnapshotFromDesk) — so every event is RTH-real, grounded
// in the exact numbers members see — plus three inputs the voice snapshot doesn't carry
// (macro calendar, EOD pin forecast, the ET session clock).
//
// It emits the SHARED, widened `PulseSignal` type from vector-pulse.ts with a SEVERITY TIER,
// a MAGNITUDE payload, an IMPLICATION line, and a one-line WHY. Pure + deterministic (no
// Date.now, no I/O) exactly like the Largo brain and the Vector engine — the rail owns the
// clock, cooldown, rate-cap and dedup. The Vector Pulse engine imports NONE of this, so
// Vector's feed is untouched.
//
// Taxonomy (fire threshold → suppress rule, per kind):
//   TIER 1  regime-flip   γ-flip cross confirmed beyond a hysteresis band  → band blocks flip-flop
//           wall-break    spot breaks a king wall AND holds N bars beyond   → resets if spot returns
//           macro-window  econ catalyst enters T-15m / release / reaction   → one event per phase
//   TIER 2  magnet-shift  γ center-of-mass moves ≥ X pts or crosses spot    → per-(kind,level) dedup
//           pin-shift     EOD pin forecast moves ≥ X pts                     → min-step gate
//           wall-build    a wall's |notional| grows/shrinks ≥ Y%            → noise-floor + top-2/tick
//           vol-regime    VIX crosses a level or term structure flips        → transition-only
//   TIER 3  flow-print    a LARGE aggressive sweep from the flow tape        → premium floor + id dedup
//           session-phase open-drive end / charm / power-hour boundaries     → one event per boundary
//           play-state    a desk play arms / fires / closes                  → lifecycle transition

import type { SpxVoiceSnapshot } from "@/lib/bie/spx-live-voice";
import { fmtLevel } from "@/lib/bie/spx-live-voice";
import type { PulseSignal, PulseMagnitude, PulseSignalTone } from "@/features/vector/lib/vector-pulse";
import type { MacroEvent } from "@/lib/providers/macro-events";
import { parseMacroEventTime } from "@/features/spx/lib/spx-macro-window";
import type { SpxFlowBrief } from "@/features/spx/lib/spx-desk";

// ---------------------------------------------------------------------------
// Fire thresholds — exported so the tests assert against the SAME constants.
// ---------------------------------------------------------------------------

/** Regime flip only confirms once spot is this many index points BEYOND the γ-flip — a
 *  straddle-the-line tape inside the band can't produce a flip-flop stream. */
export const SPX_REGIME_HYSTERESIS_PTS = 3;
/** A king wall must be broken and HELD this many consecutive snapshots to fire a wall-break. */
export const SPX_WALL_BREAK_HOLD_BARS = 3;
/** γ center-of-mass must move at least this many points (or cross spot) to fire a magnet shift. */
export const SPX_MAGNET_SHIFT_MIN_PTS = 10;
/** EOD pin forecast must step at least this many points (≈ one SPX strike) to fire a pin shift. */
export const SPX_PIN_SHIFT_MIN_PTS = 5;
/** |net_gex| must change by at least this fraction to fire a wall build/dissolve. */
export const SPX_WALL_DELTA_PCT = 0.35;
/** Ignore wall lifecycle on nodes smaller than this ($ gamma) — noise floor. */
export const SPX_WALL_MIN_ABS = 250_000;
/** Max wall build/dissolve events per tick (most material first) — the rail is a signal, not a ledger. */
export const SPX_WALL_LIFECYCLE_PER_TICK = 2;
/** VIX level crossing that flips the vol regime read. */
export const SPX_VIX_LEVEL = 20;
/** A sweep must carry at least this premium to headline as a Tier-3 flow anomaly. */
export const SPX_SWEEP_MIN_PREMIUM = 1_000_000;
/** Minutes before a macro release that the T-15m pre-window opens. */
export const SPX_MACRO_PRE_MIN = 15;
/** Minutes after a macro release the "release" phase covers before it becomes "reaction". */
export const SPX_MACRO_RELEASE_MIN = 2;
/** Minutes after a macro release the "reaction" phase stays live. */
export const SPX_MACRO_REACTION_MIN = 30;

// ET minute-of-day session-phase boundaries (RTH is 9:30–16:00 ET).
const OPEN_DRIVE_END_MIN = 10 * 60; // 10:00 — opening-range set, open drive resolves
const CHARM_WINDOW_MIN = 14 * 60; // 14:00 — charm/vanna drift window opens
const POWER_HOUR_MIN = 15 * 60; // 15:00 — power hour / final pin push

// ---------------------------------------------------------------------------
// Snapshot — the diffable SPX state at one tick.
// ---------------------------------------------------------------------------

export type SpxWall = { strike: number; netGex: number; kind: "support" | "resistance" };

export type SpxPinInput = {
  /** Snapped pin strike (real pins sit on a strike). */
  pin: number | null;
  /** Confidence 0..1 the close lands inside the band. */
  pinPct: number | null;
  /** [low, high] pin confidence interval. */
  pinBand: [number, number] | null;
};

export type SpxMacroPhase = {
  event: string;
  phase: "pre" | "release" | "reaction";
} | null;

export type SpxPlayInput = {
  action: string | null;
  direction: "long" | "short" | null;
  open_play: { direction: "long" | "short"; entry_price: number | null } | null;
  contractLabel?: string | null;
} | null;

export type SpxPulseSnapshot = {
  at: number;
  price: number | null;
  gammaFlip: number | null;
  /** price >= flip; null when either side is unknown. */
  aboveFlip: boolean | null;
  kingCall: { strike: number; netGex: number } | null;
  kingPut: { strike: number; netGex: number } | null;
  walls: SpxWall[];
  /** |net_gex|-weighted centre-of-mass strike across the ladder, or null when no walls. */
  magnetStrike: number | null;
  vix: number | null;
  /** VIX term structure word from the desk (contango / backwardation / flat). */
  vixTermStructure: string | null;
  pin: SpxPinInput;
  /** Active macro-release phase (from the calendar + ET clock), or null. */
  macroPhase: SpxMacroPhase;
  /** ET minute-of-day for session-phase boundary detection. */
  etMinute: number | null;
  gexStale: boolean;
  feedStalled: boolean;
};

function num(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

/** ET minute-of-day (0–1439) for a Date — DST-safe via Intl, pure. */
export function etMinuteOfDay(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return (h % 24) * 60 + m;
}

/** |net_gex|-weighted centre-of-mass strike — the dealer-hedging gravity centre. */
export function gammaCenterOfMass(walls: SpxWall[]): number | null {
  let wsum = 0;
  let acc = 0;
  for (const w of walls) {
    const abs = Math.abs(w.netGex);
    if (!(abs > 0)) continue;
    wsum += abs;
    acc += w.strike * abs;
  }
  return wsum > 0 ? acc / wsum : null;
}

/**
 * Resolve the single most-relevant macro-release phase for the current ET minute. Precise
 * (HH:MM) releases get tight windows; a date-only (imprecise) row is NOT given a fake clock
 * — it is skipped here (the pre-open E2E gate + macro block already widen protection for
 * those; the Pulse rail does not fabricate a release minute). Highest-impact, nearest-to-now
 * event wins. Pure — the ET minute + today's YMD are injected by the caller.
 */
export function resolveMacroPhase(
  events: MacroEvent[],
  etMinute: number,
  todayYmd: string
): SpxMacroPhase {
  let best: { event: string; phase: "pre" | "release" | "reaction"; dist: number } | null = null;
  for (const ev of events ?? []) {
    if (!ev?.time || !ev?.event) continue;
    const impact = (ev.impact ?? "").toLowerCase();
    if (impact && !impact.includes("high") && !impact.includes("med")) continue;
    const parsed = parseMacroEventTime(ev.time, todayYmd);
    if (!parsed || !parsed.precise) continue; // never invent a clock for a date-only row
    const t = parsed.minutes;
    let phase: "pre" | "release" | "reaction" | null = null;
    if (etMinute >= t - SPX_MACRO_PRE_MIN && etMinute < t) phase = "pre";
    else if (etMinute >= t && etMinute <= t + SPX_MACRO_RELEASE_MIN) phase = "release";
    else if (etMinute > t + SPX_MACRO_RELEASE_MIN && etMinute <= t + SPX_MACRO_REACTION_MIN) phase = "reaction";
    if (!phase) continue;
    const dist = Math.abs(etMinute - t);
    if (!best || dist < best.dist) best = { event: ev.event, phase, dist };
  }
  return best ? { event: best.event, phase: best.phase } : null;
}

export function buildSpxPulseSnapshot(input: {
  voice: SpxVoiceSnapshot;
  pin?: SpxPinInput;
  macroEvents?: MacroEvent[];
  etMinute?: number | null;
  todayYmd?: string;
  vixTermStructure?: string | null;
}): SpxPulseSnapshot {
  const v = input.voice;
  const walls: SpxWall[] = v.walls.map((w) => ({ strike: w.strike, netGex: w.netGex, kind: w.kind }));
  const etMinute = input.etMinute ?? null;
  const macroPhase =
    etMinute != null && input.macroEvents?.length && input.todayYmd
      ? resolveMacroPhase(input.macroEvents, etMinute, input.todayYmd)
      : null;

  return {
    at: v.at,
    price: v.price,
    gammaFlip: v.gammaFlip,
    aboveFlip: v.aboveFlip,
    kingCall: v.kingCall,
    kingPut: v.kingPut,
    walls,
    magnetStrike: gammaCenterOfMass(walls),
    vix: v.vix,
    vixTermStructure: input.vixTermStructure ?? null,
    pin: input.pin ?? { pin: null, pinPct: null, pinBand: null },
    macroPhase,
    etMinute,
    gexStale: v.gexStale,
    feedStalled: v.feedStalled,
  };
}

// ---------------------------------------------------------------------------
// Magnitude + implication helpers.
// ---------------------------------------------------------------------------

function fmtPts(v: number): string {
  const r = Math.round(v);
  return `${r >= 0 ? "+" : "−"}${Math.abs(r)} pt${Math.abs(r) === 1 ? "" : "s"}`;
}

/** $ gamma-notional short-form, signed: -$1.8B, +$640M, +$12M. */
export function fmtNotional(v: number): string {
  const sign = v >= 0 ? "+" : "−";
  const a = Math.abs(v);
  if (a >= 1_000_000_000) return `${sign}$${(a / 1_000_000_000).toFixed(1)}B`;
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(0)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(0)}K`;
  return `${sign}$${Math.round(a)}`;
}

function mag(unit: PulseMagnitude["unit"], value: number, label: string): PulseMagnitude {
  return { unit, value, label };
}

// ---------------------------------------------------------------------------
// Detector — diff two consecutive snapshots, emit only transitions.
// Pure: same inputs → same events. Caller owns cooldown/rate-cap/dedup.
// ---------------------------------------------------------------------------

const MAX_SIGNALS_PER_TICK = 8;

function sig(s: PulseSignal): PulseSignal {
  return s;
}

export function detectSpxPulseSignals(
  prev: SpxPulseSnapshot | null,
  next: SpxPulseSnapshot
): PulseSignal[] {
  if (!prev) return [];
  const at = next.at;
  const out: PulseSignal[] = [];

  // ── TIER 1: regime flip (hysteresis band) ──────────────────────────────
  if (
    prev.aboveFlip != null &&
    next.aboveFlip != null &&
    prev.aboveFlip !== next.aboveFlip &&
    next.gammaFlip != null &&
    next.price != null &&
    Math.abs(next.price - next.gammaFlip) >= SPX_REGIME_HYSTERESIS_PTS // confirmed, not straddling
  ) {
    const down = !next.aboveFlip;
    out.push(
      sig({
        key: `spx-regime:${down ? "short" : "long"}:${Math.round(next.gammaFlip)}`,
        kind: "regime-flip",
        tier: 1,
        tone: down ? "bear" : "bull",
        at,
        level: next.gammaFlip,
        line: down
          ? `Crossed γ-flip ${fmtLevel(next.gammaFlip)} DOWN — SHORT GAMMA`
          : `Crossed γ-flip ${fmtLevel(next.gammaFlip)} UP — LONG GAMMA`,
        implication: down
          ? "dealers now amplify moves — trade momentum, respect breaks"
          : "dealers now dampen moves — fade extremes, expect a pin",
        magnitude: [mag("points", next.price - next.gammaFlip, `${fmtPts(next.price - next.gammaFlip)} thru flip`)],
        why: `Spot ${fmtLevel(next.price)} confirmed ${Math.abs(Math.round(next.price - next.gammaFlip))} pts beyond the γ-flip (≥${SPX_REGIME_HYSTERESIS_PTS} pt hysteresis band), so the sign of dealer gamma flipped.`,
      })
    );
  }

  // ── TIER 2: gamma magnet shift (centre of mass) ────────────────────────
  if (prev.magnetStrike != null && next.magnetStrike != null && next.price != null) {
    const deltaPts = next.magnetStrike - prev.magnetStrike;
    const crossedSpot =
      (prev.magnetStrike <= next.price && next.magnetStrike > next.price) ||
      (prev.magnetStrike >= next.price && next.magnetStrike < next.price);
    if (Math.abs(deltaPts) >= SPX_MAGNET_SHIFT_MIN_PTS || crossedSpot) {
      const up = deltaPts >= 0;
      const aboveSpot = next.magnetStrike >= next.price;
      out.push(
        sig({
          key: `spx-magnet:${Math.round(next.magnetStrike)}`,
          kind: "magnet-shift",
          tier: 2,
          tone: up ? "bull" : "bear",
          at,
          level: next.magnetStrike,
          line: crossedSpot
            ? `Gamma magnet crossed spot → ${fmtLevel(next.magnetStrike)}`
            : `Gamma magnet shifted ${up ? "up" : "down"} → ${fmtLevel(next.magnetStrike)}`,
          implication: aboveSpot
            ? "hedging gravity now pulls spot up into the magnet"
            : "hedging gravity now pulls spot down into the magnet",
          magnitude: [mag("points", deltaPts, `${fmtPts(deltaPts)} Δ`)],
          why: `The |net-gamma|-weighted centre of the wall ladder moved from ${fmtLevel(prev.magnetStrike)} to ${fmtLevel(next.magnetStrike)}${crossedSpot ? `, crossing spot ${fmtLevel(next.price)}` : ""}.`,
        })
      );
    }
  }

  // ── TIER 2: pin shift (EOD forecast stepped) ───────────────────────────
  if (
    prev.pin.pin != null &&
    next.pin.pin != null &&
    Math.abs(next.pin.pin - prev.pin.pin) >= SPX_PIN_SHIFT_MIN_PTS
  ) {
    const up = next.pin.pin > prev.pin.pin;
    const pct = next.pin.pinPct != null ? Math.round(next.pin.pinPct * 100) : null;
    const band =
      next.pin.pinBand != null ? `${fmtLevel(next.pin.pinBand[0])}–${fmtLevel(next.pin.pinBand[1])}` : null;
    out.push(
      sig({
        key: `spx-pin:${Math.round(next.pin.pin)}`,
        kind: "pin-shift",
        tier: 2,
        tone: up ? "bull" : "bear",
        at,
        level: next.pin.pin,
        line: `EOD pin ${fmtLevel(prev.pin.pin)} → ${fmtLevel(next.pin.pin)}`,
        implication: up
          ? "close-drift target stepped up — magnet is higher now"
          : "close-drift target stepped down — magnet is lower now",
        magnitude: [
          mag("points", next.pin.pin - prev.pin.pin, `${fmtPts(next.pin.pin - prev.pin.pin)} Δ`),
          ...(pct != null ? [mag("percent", pct, `${pct}% conf`)] : []),
        ],
        why: `The EOD pin forecast re-solved from ${fmtLevel(prev.pin.pin)} to ${fmtLevel(next.pin.pin)}${band ? ` (CI ${band})` : ""}${pct != null ? ` at ${pct}% confidence` : ""}.`,
      })
    );
  }

  // ── TIER 2: wall build / dissolve (notional trajectory) ────────────────
  const prevByKey = new Map(prev.walls.map((w) => [`${w.kind}:${Math.round(w.strike)}`, w]));
  const lifecycle: Array<{ mag: number; s: PulseSignal }> = [];
  for (const w of next.walls) {
    const p = prevByKey.get(`${w.kind}:${Math.round(w.strike)}`);
    if (!p) continue;
    const before = Math.abs(p.netGex);
    const after = Math.abs(w.netGex);
    if (Math.max(before, after) < SPX_WALL_MIN_ABS) continue; // both sub-floor → noise
    const notionalDelta = w.netGex - p.netGex;
    // A % is only meaningful off a RELIABLE base (≥ floor). Off a sub-floor base a wall that
    // formed from ~nothing is still material and fires — but shows the notional-Δ chip only,
    // never a 29,999,900%-off-a-base-of-1 artifact.
    const baseReliable = before >= SPX_WALL_MIN_ABS;
    const change = baseReliable ? (after - before) / before : Number.NaN;
    const fires = baseReliable ? Math.abs(change) >= SPX_WALL_DELTA_PCT : true; // sub-floor→material = a build
    if (!fires) continue;
    const grew = after >= before;
    const pctChip = baseReliable ? [mag("percent", Math.round(change * 100), `${grew ? "+" : ""}${Math.round(change * 100)}%`)] : [];
    const pctPhrase = baseReliable ? ` ${Math.abs(Math.round(change * 100))}%` : "";
    const label = `${fmtLevel(w.strike)}${w.kind === "support" ? "P" : "C"}`;
    if (grew) {
      lifecycle.push({
        mag: Math.abs(notionalDelta),
        s: sig({
          key: `spx-wall-build:${w.kind}:${Math.round(w.strike)}`,
          kind: "wall-build",
          tier: 2,
          tone: w.kind === "support" ? "bull" : "bear",
          at,
          level: w.strike,
          line: `${label} wall building fast`,
          implication: w.kind === "support" ? "new support hardening below" : "cap hardening overhead",
          magnitude: [mag("notional", notionalDelta, `${fmtNotional(notionalDelta)} γ`), ...pctChip],
          why: `|net gamma| at ${label} grew${pctPhrase} (${fmtNotional(before)}→${fmtNotional(after)}) between polls.`,
        }),
      });
    } else {
      lifecycle.push({
        mag: Math.abs(notionalDelta),
        s: sig({
          key: `spx-wall-dissolve:${w.kind}:${Math.round(w.strike)}`,
          kind: "wall-build",
          tier: 2,
          tone: w.kind === "support" ? "bear" : "bull",
          at,
          level: w.strike,
          line: `${label} wall dissolving`,
          implication: w.kind === "support" ? "support thinning — floor less reliable" : "upside cap weakening",
          magnitude: [mag("notional", notionalDelta, `${fmtNotional(notionalDelta)} γ`), ...pctChip],
          why: `|net gamma| at ${label} shrank${pctPhrase} (${fmtNotional(before)}→${fmtNotional(after)}) between polls.`,
        }),
      });
    }
  }
  lifecycle.sort((a, b) => b.mag - a.mag);
  for (const l of lifecycle.slice(0, SPX_WALL_LIFECYCLE_PER_TICK)) out.push(l.s);

  // ── TIER 2: vol regime (VIX level cross OR term-structure flip) ─────────
  if (prev.vix != null && next.vix != null) {
    if (prev.vix < SPX_VIX_LEVEL && next.vix >= SPX_VIX_LEVEL) {
      out.push(
        sig({
          key: `spx-vix:above${SPX_VIX_LEVEL}`,
          kind: "vol-regime",
          tier: 2,
          tone: "warn",
          at,
          level: SPX_VIX_LEVEL,
          line: `VIX ${next.vix.toFixed(1)} through ${SPX_VIX_LEVEL}`,
          implication: "vol expanding — cut size, widen stops",
          magnitude: [mag("points", next.vix - prev.vix, `Δ ${(next.vix - prev.vix).toFixed(1)} vol`)],
          why: `VIX crossed the ${SPX_VIX_LEVEL} regime line upward (${prev.vix.toFixed(1)}→${next.vix.toFixed(1)}).`,
        })
      );
    } else if (prev.vix >= SPX_VIX_LEVEL && next.vix < SPX_VIX_LEVEL) {
      out.push(
        sig({
          key: `spx-vix:below${SPX_VIX_LEVEL}`,
          kind: "vol-regime",
          tier: 2,
          tone: "info",
          at,
          level: SPX_VIX_LEVEL,
          line: `VIX ${next.vix.toFixed(1)} back under ${SPX_VIX_LEVEL}`,
          implication: "vol cooling — mean-reversion friendlier",
          magnitude: [mag("points", next.vix - prev.vix, `Δ ${(next.vix - prev.vix).toFixed(1)} vol`)],
          why: `VIX fell back under the ${SPX_VIX_LEVEL} line (${prev.vix.toFixed(1)}→${next.vix.toFixed(1)}).`,
        })
      );
    }
  }
  if (
    prev.vixTermStructure &&
    next.vixTermStructure &&
    normalizeTerm(prev.vixTermStructure) !== normalizeTerm(next.vixTermStructure) &&
    normalizeTerm(next.vixTermStructure) !== "flat"
  ) {
    const backwardation = normalizeTerm(next.vixTermStructure) === "backwardation";
    out.push(
      sig({
        key: `spx-vixterm:${normalizeTerm(next.vixTermStructure)}`,
        kind: "vol-regime",
        tier: 2,
        tone: backwardation ? "bear" : "info",
        at,
        line: `VIX term flipped ${backwardation ? "backwardation" : "contango"}`,
        implication: backwardation
          ? "near-term fear bid — hedging demand, momentum bias"
          : "term normalized — near-term calm restored",
        why: `The VIX term structure crossed from ${normalizeTerm(prev.vixTermStructure)} to ${normalizeTerm(next.vixTermStructure)}.`,
      })
    );
  }

  // ── TIER 1: macro window (phase transition) ────────────────────────────
  const prevPhase = prev.macroPhase;
  const nextPhase = next.macroPhase;
  if (nextPhase && (!prevPhase || prevPhase.event !== nextPhase.event || prevPhase.phase !== nextPhase.phase)) {
    const label =
      nextPhase.phase === "pre"
        ? `T-${SPX_MACRO_PRE_MIN}m to ${nextPhase.event}`
        : nextPhase.phase === "release"
          ? `${nextPhase.event} RELEASING`
          : `${nextPhase.event} reaction window`;
    out.push(
      sig({
        key: `spx-macro:${nextPhase.event}:${nextPhase.phase}`,
        kind: "macro-window",
        tier: 1,
        tone: "warn",
        at,
        line: label,
        implication:
          nextPhase.phase === "pre"
            ? "flatten / size down into the print — headline risk"
            : nextPhase.phase === "release"
              ? "data out — first move is often a fake, wait for the reaction"
              : "reaction tape — let the range set before pressing",
        why: `Macro calendar: ${nextPhase.event} is in its ${nextPhase.phase} window at the current ET session minute.`,
      })
    );
  }

  // ── TIER 3: session phase (ET boundary crossed) ────────────────────────
  if (prev.etMinute != null && next.etMinute != null && next.etMinute > prev.etMinute) {
    const crossed = (b: number) => prev.etMinute! < b && next.etMinute! >= b;
    if (crossed(OPEN_DRIVE_END_MIN)) {
      out.push(
        sig({
          key: "spx-phase:open-drive-end",
          kind: "session-phase",
          tier: 3,
          tone: "info",
          at,
          line: "Opening drive resolved (10:00 ET)",
          implication: "opening range is set — OR breaks now carry",
          why: "The first 30 minutes closed; the opening range is fixed for the session.",
        })
      );
    }
    if (crossed(CHARM_WINDOW_MIN)) {
      out.push(
        sig({
          key: "spx-phase:charm",
          kind: "session-phase",
          tier: 3,
          tone: "info",
          at,
          line: "Charm/vanna window open (14:00 ET)",
          implication: "dealer decay hedging begins — pin drift accelerates",
          why: "After 14:00 ET, 0DTE charm/vanna hedging pulls spot toward the dominant magnet.",
        })
      );
    }
    if (crossed(POWER_HOUR_MIN)) {
      out.push(
        sig({
          key: "spx-phase:power-hour",
          kind: "session-phase",
          tier: 3,
          tone: "info",
          at,
          line: "Power hour (15:00 ET)",
          implication: "final positioning — pin push or trend resolution",
          why: "The last hour concentrates 0DTE gamma unwind and end-of-day rebalancing.",
        })
      );
    }
  }

  return out.slice(0, MAX_SIGNALS_PER_TICK);
}

function normalizeTerm(s: string): "contango" | "backwardation" | "flat" {
  const t = s.toLowerCase();
  if (t.includes("backward")) return "backwardation";
  if (t.includes("contango")) return "contango";
  return "flat";
}

// ---------------------------------------------------------------------------
// Wall break — needs a hold counter across snapshots, so it is a THREADED pure
// tracker (feed it snapshots in order; it fires only after N held bars, resets
// if spot returns to the defended side). Kept separate from the stateless
// diff detector so both stay independently unit-testable.
// ---------------------------------------------------------------------------

export type WallBreakTracker = {
  /** side:strike → { bars held beyond, the wall it belongs to }. */
  holds: Record<string, { strike: number; kind: "support" | "resistance"; bars: number }>;
};

export function emptyWallBreakTracker(): WallBreakTracker {
  return { holds: {} };
}

/**
 * Advance the wall-break tracker by one snapshot. A king wall counts as "broken" when spot is
 * on the wrong side of it (spot above a resistance king, or below a support king). We count
 * consecutive snapshots the break holds; at exactly `holdBars` we fire ONCE. If spot returns
 * to the defended side the counter resets, so a first-touch wick doesn't fire (that is what
 * the existing "proximity" first-touch kind is for). Pure: (tracker, snap) → (tracker, breaks).
 */
export function advanceWallBreakTracker(
  tracker: WallBreakTracker,
  snap: SpxPulseSnapshot,
  holdBars = SPX_WALL_BREAK_HOLD_BARS
): { tracker: WallBreakTracker; breaks: PulseSignal[] } {
  const price = num(snap.price);
  const breaks: PulseSignal[] = [];
  const holds: WallBreakTracker["holds"] = {};

  const kings: Array<{ strike: number; netGex: number; kind: "support" | "resistance" }> = [];
  if (snap.kingCall) kings.push({ ...snap.kingCall, kind: "resistance" });
  if (snap.kingPut) kings.push({ ...snap.kingPut, kind: "support" });

  for (const k of kings) {
    if (price == null || snap.gexStale) continue; // no live spot / stale walls → don't count
    const key = `${k.kind}:${Math.round(k.strike)}`;
    const broken = k.kind === "resistance" ? price > k.strike : price < k.strike;
    if (!broken) continue; // reset: entry not carried forward
    const prevBars = tracker.holds[key]?.bars ?? 0;
    const bars = prevBars + 1;
    holds[key] = { strike: k.strike, kind: k.kind, bars };
    if (bars === holdBars) {
      const up = k.kind === "resistance";
      const tone: PulseSignalTone = up ? "bull" : "bear";
      breaks.push({
        key: `spx-wall-break:${key}`,
        kind: "wall-break",
        tier: 1,
        tone,
        at: snap.at,
        level: k.strike,
        line: up
          ? `Broke & held ${fmtLevel(k.strike)} call wall`
          : `Broke & held ${fmtLevel(k.strike)} put wall`,
        implication: up
          ? "dealer short-gamma chase above — squeeze fuel, press strength"
          : "support gone — hedging accelerates the drop, press weakness",
        magnitude: [
          mag("points", price - k.strike, `${fmtPts(price - k.strike)} beyond`),
          mag("notional", k.netGex, `${fmtNotional(k.netGex)} γ`),
        ],
        why: `Spot held ${up ? "above" : "below"} the ${fmtLevel(k.strike)} king ${up ? "call" : "put"} wall for ${holdBars} consecutive polls — a confirmed break, not a first-touch wick.`,
      });
    }
  }

  return { tracker: { holds }, breaks };
}

// ---------------------------------------------------------------------------
// TIER 3: sweep / flow anomaly — headline only LARGE aggressive sweeps.
// ---------------------------------------------------------------------------

function fmtPremium(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${(n / 1_000).toFixed(0)}K`;
}

/**
 * Convert a large aggressive sweep from the SPX flow tape to a Tier-3 flow-print signal.
 * Returns null for anything below the premium floor or not a sweep — the rail headlines
 * conviction prints, not the whole tape.
 */
export function sweepToPulseSignal(brief: SpxFlowBrief, fallbackNow: number): PulseSignal | null {
  if (!brief.has_sweep) return null;
  if (num(brief.premium) == null || brief.premium < SPX_SWEEP_MIN_PREMIUM) return null;
  const isCall = brief.option_type?.toLowerCase() === "call";
  const dir = (brief.direction ?? "").toLowerCase();
  const bought = dir.includes("buy") || dir.includes("ask");
  const bullish = (isCall && bought) || (!isCall && !bought);
  const tone: PulseSignalTone = bullish ? "bull" : "bear";
  const contracts = num(brief.trade_count);
  // Timestamp the sweep from when it actually printed, not when we first observed it — else a
  // pre-existing tape brief would flash minutes-old as "now" on the first tick. `now` is only
  // the fallback when the brief carries no parseable print time.
  const printedAt = brief.alerted_at ? Date.parse(brief.alerted_at) : NaN;
  const at = Number.isFinite(printedAt) ? printedAt : fallbackNow;
  return {
    key: `spx-sweep:${brief.strike}:${brief.expiry}:${Math.round(at / 1000)}`,
    kind: "flow-print",
    tier: 3,
    tone,
    at,
    level: num(brief.strike),
    line: `${fmtPremium(brief.premium)} sweep ${fmtLevel(brief.strike)}${isCall ? "C" : "P"} ${brief.expiry}`,
    implication: bullish ? "aggressive bullish sweep — buyers lifting offers" : "aggressive bearish sweep — sellers hitting bids",
    magnitude: [
      mag("premium", brief.premium, fmtPremium(brief.premium)),
      ...(contracts != null ? [mag("contracts", contracts, `${contracts} legs`)] : []),
    ],
    why: `A single ${brief.has_sweep ? "multi-exchange sweep" : "order"} paid ${fmtPremium(brief.premium)} of ${brief.direction} on the ${fmtLevel(brief.strike)}${isCall ? "C" : "P"} — above the ${fmtPremium(SPX_SWEEP_MIN_PREMIUM)} conviction floor.`,
  };
}

// ---------------------------------------------------------------------------
// TIER 3: play lifecycle — arms / fires / closes.
// ---------------------------------------------------------------------------

export function detectSpxPlaySignals(
  prev: SpxPlayInput,
  next: SpxPlayInput,
  at: number,
  /** Seed silently on the FIRST observation (page mount / rail-toggle remount resets the
   *  caller's ref to null). Without this an already-OPEN play would emit a false "FIRED"/
   *  "ARMED" stamped `now` — presenting a minutes-old fill as fresh. Matches the snapshot
   *  detector's `if (!prev) return []` seed-don't-fire discipline. Pass a real `prev` (even
   *  an empty scanning slice) only when you WANT the transition graded. */
  hasPrevObservation = true
): PulseSignal[] {
  if (!hasPrevObservation) return []; // first observation: seed, emit nothing
  if (!next) return [];
  const events: PulseSignal[] = [];

  const wasArmed = prev?.action === "BUY" && !prev?.open_play;
  const isArmed = next.action === "BUY" && !next.open_play;
  if (!wasArmed && isArmed) {
    const long = next.direction !== "short";
    events.push({
      key: `spx-play-armed:${long ? "long" : "short"}`,
      kind: "play-state",
      tier: 3,
      tone: long ? "bull" : "bear",
      at,
      line: `Play ARMED — ${long ? "LONG" : "SHORT"} setup triggered`,
      implication: "engine wants the entry — watch for the fire",
      why: "The SPX play engine moved to BUY without an open position — a setup armed.",
    });
  }

  if (!prev?.open_play && next.open_play) {
    const op = next.open_play;
    const long = op.direction !== "short";
    const label = next.contractLabel ? ` — ${next.contractLabel}` : "";
    events.push({
      key: `spx-play-fired:${long ? "long" : "short"}:${op.entry_price != null ? Math.round(op.entry_price) : "x"}`,
      kind: "play-state",
      tier: 3,
      tone: long ? "bull" : "bear",
      at,
      line: `Play FIRED — ${long ? "LONG" : "SHORT"}${op.entry_price != null ? ` from ${fmtLevel(op.entry_price)}` : ""}${label}`,
      implication: "position live — manage to the plan",
      why: "The play engine opened a position from the armed setup.",
    });
  }

  if (prev?.open_play && !next.open_play) {
    const op = prev.open_play;
    const long = op.direction !== "short";
    events.push({
      key: `spx-play-closed:${long ? "long" : "short"}:${op.entry_price != null ? Math.round(op.entry_price) : "x"}`,
      kind: "play-state",
      tier: 3,
      tone: "info",
      at,
      line: `Play CLOSED — ${long ? "LONG" : "SHORT"} done, back to scanning`,
      implication: "flat — reset and wait for the next setup",
      why: "The open position closed; the engine returned to scanning.",
    });
  }

  return events;
}

/** Max signals kept in the SPX Pulse feed. */
export const SPX_PULSE_FEED_MAX = 60;

/** Kinds that pin to the top of the rail (Tier-1, regime-defining). */
export const SPX_PULSE_PINNED_KINDS: ReadonlySet<PulseSignal["kind"]> = new Set([
  "regime-flip",
  "wall-break",
  "macro-window",
]);
