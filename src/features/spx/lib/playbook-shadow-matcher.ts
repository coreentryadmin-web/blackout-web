/**
 * SPX Slayer — Playbook Shadow Matcher, Phase 1 (SHADOW MODE ONLY).
 *
 * Pure, code-computable approximation of PB-01/PB-02/PB-03's preconditions/triggers
 * (`playbook-registry.ts`, copied verbatim from
 * `docs/spx/SPX-Slayer-Playbook-Design-v1.docx` Section 6) against the fields that
 * ALREADY EXIST on `SpxDeskPayload` (`spx-desk.ts`) and `PlayTechnicals`
 * (`spx-play-technicals.ts`) today. Nothing here reads a database, calls an external
 * provider, or reads a bare `Date.now()`/`new Date()` — the caller passes `now`
 * explicitly (same discipline as `spx-signals-shadow.ts`'s `computeShadowFactors` and
 * `spx-signals-shadow-skew.ts`'s two factor functions) — so every function below is
 * fully unit-testable and structurally incapable of a side effect.
 *
 * INERTNESS GUARANTEE — this is SHADOW ONLY, exactly like every other file in this
 * `spx-signals-shadow*` family: nothing here is called by, or read back into,
 * `evaluateSpxPlay()` (`spx-play-engine.ts`), `computeSpxConfluence()` (`spx-signals.ts`),
 * or `evaluatePlayGates()` (`spx-play-gates.ts`). Proof, exactly like
 * `spx-signals-shadow-skew.ts`'s own module doc:
 *
 *   git grep playbook-shadow-matcher src/features/spx/lib/spx-play-engine.ts \
 *     src/features/spx/lib/spx-signals.ts src/features/spx/lib/spx-play-gates.ts
 *
 * returns nothing — the "this cannot touch the live BUY/WATCH/HOLD/SELL decision"
 * guarantee is visible by inspection, not just by test. The ONLY consumer of this
 * module is the logging wrapper in `spx-signal-log.ts` (`logPlaybookShadowMatch`),
 * which persists what each playbook WOULD have matched, fire-and-forget, next to the
 * real signal, for future evidence-gated promotion — the same
 * `bie/calibration.ts` `MIN_EVIDENCE = 10` "report first, a human ships the change"
 * philosophy `spx-signals-shadow.ts`'s module doc explains in full.
 *
 * ============================================================================
 * WHY THESE ARE APPROXIMATIONS, NOT LITERAL PRECONDITION/TRIGGER CHECKS
 * ============================================================================
 * The design doc's prose leans on state this codebase does not currently retain:
 *
 * 1. Duration/streak conditions ("below VWAP >=15m", "hold 2 consecutive 3m bars",
 *    "repeated rejections", "acceptance ... (2 closes)") need a rolling history of
 *    bars/ticks. `PlayTechnicals` (`spx-play-technicals.ts`) is a SINGLE-SNAPSHOT
 *    read — it recomputes fresh from Polygon minute bars on every call (or serves a
 *    <=30s cache) and does not expose the underlying bar array or any prior-tick
 *    state to a caller. Per this task's own scope, this file does NOT invent new
 *    stored state to check those durations — it substitutes the best available
 *    single-tick proxy and says so on each playbook's matcher function below.
 * 2. `EMA9` ("EMA9 curling toward VWAP", PB-01) does not exist anywhere in this
 *    codebase today — `SpxDeskPayload` carries `ema20`/`ema50`/`ema200` and
 *    `PlayTechnicals` carries `m5_ema20`; there is no 9-period EMA computed anywhere
 *    (grep confirms). PB-01's matcher below omits the EMA-curl check entirely rather
 *    than silently substituting a different-period EMA as if it were EMA9.
 * 3. "First 15-30m range defined" (PB-03, opening range) has no dedicated
 *    `or_high`/`or_low` field on the desk or technicals payload — this file
 *    approximates the opening range with `desk.hod`/`desk.lod` (today's running
 *    high/low), which is a defensible proxy ONLY early in the session (PB-03's own
 *    09:35-10:30 ET session window, gated below) since hod/lod cannot have diverged
 *    far from the true opening range in the first ~55 minutes of trading. Outside
 *    that window this proxy would degrade badly, which is exactly why
 *    `session_window_open` gates `trigger_fired` for every playbook here, not just
 *    an informational field.
 *
 * Because of (1), `precondition_match` and `trigger_fired` are each evaluated
 * independently from the CURRENT tick's fields — they are not guaranteed to reflect
 * a genuine "precondition held, then trigger fired" temporal sequence the way a
 * system with real bar history would. This is a known, deliberate Phase 1
 * simplification (see the task brief this file was built from), not a bug — the
 * whole point of shadow mode is to log this approximation next to real outcomes and
 * let evidence decide whether it's good enough before anything promotes it into a
 * gate.
 */
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import { PLAYBOOK_REGISTRY, type PlaybookId, type PlaybookSessionWindow } from "@/features/spx/lib/playbook-registry";
import { etClock, etMinutes } from "@/features/spx/lib/spx-play-session-time";
import { playStructureProximityPts } from "@/features/spx/lib/spx-play-config";

export type PlaybookDirectionVerdict = "long" | "short" | null;

export type PlaybookMatchVerdict = {
  playbook_id: PlaybookId;
  session_window_open: boolean;
  precondition_match: boolean;
  trigger_fired: boolean;
  direction: PlaybookDirectionVerdict;
  detail: string;
};

export type PlaybookShadowMatchResult = {
  verdicts: PlaybookMatchVerdict[];
  /** First registry-order playbook whose `trigger_fired` is true, or null if none did. */
  primary_playbook_id: PlaybookId | null;
};

/** True when `etMins` falls inside `[start, end)` — half-open, matching every other
 *  session-window helper in this codebase (`spx-play-session-guards.ts`). */
function isWithinSessionWindow(window: PlaybookSessionWindow, etMins: number): boolean {
  const start = etClock(window.startEtHour, window.startEtMin);
  const end = etClock(window.endEtHour, window.endEtMin);
  return etMins >= start && etMins < end;
}

/**
 * Net 0DTE flow sign — the closest existing desk field to the design doc's "flow skew
 * aligns" / "negative net flow spike" language for SPX 0DTE plays specifically (as
 * opposed to `tide_net`, which is a broader multi-DTE read). `null` when the feed
 * hasn't produced a reading, which callers must treat as "unknown," never as zero/flat.
 */
function flowDirection(desk: SpxDeskPayload): "bullish" | "bearish" | "neutral" | null {
  const net = desk.flow_0dte_net;
  if (net == null) return null;
  if (net > 0) return "bullish";
  if (net < 0) return "bearish";
  return "neutral";
}

/**
 * PB-01 VWAP Reclaim (long or short) — see `playbook-registry.ts` for the verbatim
 * design-doc text this approximates.
 *
 * Reclaim (long) and Reject-of-the-reclaim (short) are modeled as mirror images of the
 * SAME pattern using `PlayTechnicals.breakout.vwap_reclaim`/`vwap_lost` — both are
 * already buffer-guarded "clearly on one side of VWAP" reads (`spx-play-technicals.ts`),
 * the closest existing proxy for "closed back above/below VWAP." The EMA9-curl clause
 * in the design doc's preconditions is NOT modeled (see module doc, point 2) — no EMA9
 * field exists anywhere in this codebase to check it against.
 */
function matchPb01(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  etMins: number
): PlaybookMatchVerdict {
  const def = PLAYBOOK_REGISTRY[0];
  const windowOpen = isWithinSessionWindow(def.sessionWindow, etMins);
  const dataAvailable = technicals.available && desk.vwap != null;

  if (!dataAvailable) {
    return {
      playbook_id: def.id,
      session_window_open: windowOpen,
      precondition_match: false,
      trigger_fired: false,
      direction: null,
      detail: "VWAP or technicals unavailable — cannot evaluate PB-01",
    };
  }

  const flow = flowDirection(desk);
  // Long: was below VWAP (proxy for "below VWAP >=15m"), now clearly reclaimed with a
  // flow skew that agrees (bullish or unknown-but-not-bearish, since a flat/missing
  // flow reading should not by itself block an otherwise-valid reclaim).
  const longPrecondition = desk.above_vwap === false;
  const longTrigger = technicals.breakout.vwap_reclaim === true && flow !== "bearish";
  // Short: mirror — was above VWAP, now clearly lost it with an agreeing flow skew.
  const shortPrecondition = desk.above_vwap === true;
  const shortTrigger = technicals.breakout.vwap_lost === true && flow !== "bullish";

  if (windowOpen && longTrigger) {
    return {
      playbook_id: def.id,
      session_window_open: true,
      precondition_match: longPrecondition,
      trigger_fired: true,
      direction: "long",
      detail: `VWAP reclaim: m3_close ${technicals.m3_close ?? "n/a"} vs vwap ${desk.vwap}, flow ${flow ?? "unknown"}`,
    };
  }
  if (windowOpen && shortTrigger) {
    return {
      playbook_id: def.id,
      session_window_open: true,
      precondition_match: shortPrecondition,
      trigger_fired: true,
      direction: "short",
      detail: `VWAP lost (mirror reclaim): m3_close ${technicals.m3_close ?? "n/a"} vs vwap ${desk.vwap}, flow ${flow ?? "unknown"}`,
    };
  }

  return {
    playbook_id: def.id,
    session_window_open: windowOpen,
    precondition_match: longPrecondition || shortPrecondition,
    trigger_fired: false,
    direction: null,
    detail: `No VWAP reclaim/loss this tick (above_vwap=${desk.above_vwap}, flow=${flow ?? "unknown"})`,
  };
}

/**
 * PB-02 VWAP Reject (short primary) — see `playbook-registry.ts` for the verbatim
 * design-doc text this approximates.
 *
 * "Repeated rejections at VWAP band" (a streak) is approximated with a single-tick
 * proximity check (price within `playStructureProximityPts()` of VWAP, the same
 * existing "nearby a level" constant `spx-play-config.ts` already defines for
 * structure proximity — reused here rather than inventing a second magic number) —
 * see module doc point 1. Trigger uses `breakout.vwap_lost` (price clearly back below
 * VWAP by the MTF buffer) combined with a bearish 0DTE flow reading as the proxy for
 * "3m close rejection wick + negative net flow spike."
 */
function matchPb02(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  etMins: number
): PlaybookMatchVerdict {
  const def = PLAYBOOK_REGISTRY[1];
  const windowOpen = isWithinSessionWindow(def.sessionWindow, etMins);
  const dataAvailable = technicals.available && desk.vwap != null && desk.price > 0;

  if (!dataAvailable) {
    return {
      playbook_id: def.id,
      session_window_open: windowOpen,
      precondition_match: false,
      trigger_fired: false,
      direction: null,
      detail: "VWAP or technicals unavailable — cannot evaluate PB-02",
    };
  }

  const vwap = desk.vwap as number;
  const distanceFromVwap = vwap - desk.price; // positive = price below vwap (the reject side)
  const nearBandFromBelow =
    desk.above_vwap === false && distanceFromVwap >= 0 && distanceFromVwap <= playStructureProximityPts();
  const flow = flowDirection(desk);
  const triggerFired = windowOpen && technicals.breakout.vwap_lost === true && flow === "bearish";

  return {
    playbook_id: def.id,
    session_window_open: windowOpen,
    precondition_match: nearBandFromBelow,
    trigger_fired: triggerFired,
    direction: triggerFired ? "short" : null,
    detail: triggerFired
      ? `VWAP reject: price ${desk.price} lost vwap ${vwap}, flow ${flow}`
      : `No VWAP rejection this tick (near_band=${nearBandFromBelow}, above_vwap=${desk.above_vwap}, flow=${flow ?? "unknown"})`,
  };
}

/**
 * PB-03 Opening Range Breakout — see `playbook-registry.ts` for the verbatim
 * design-doc text this approximates.
 *
 * Uses `desk.hod`/`desk.lod` as the opening-range proxy (module doc point 3 — only
 * defensible inside PB-03's own 09:35-10:30 ET window, which `session_window_open`
 * already gates `trigger_fired` on). "GEX not pinning inside range" maps to
 * `desk.gamma_regime !== "mean_revert"` — `mean_revert` (spot above the gamma flip,
 * dealers net long gamma) is this codebase's existing label for the regime where
 * dealer hedging dampens moves back toward the flip (`gamma-desk.ts::gammaRegime`),
 * the closest existing concept to "pinning." `amplification` (spot below flip, dealers
 * net short gamma) or `unknown` (no flip data) both count as "not pinning" here.
 * "Spot clears flip level" maps directly to `desk.above_gamma_flip`.
 */
function matchPb03(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  etMins: number
): PlaybookMatchVerdict {
  const def = PLAYBOOK_REGISTRY[2];
  const windowOpen = isWithinSessionWindow(def.sessionWindow, etMins);
  const dataAvailable = technicals.available && desk.hod != null && desk.lod != null;

  if (!dataAvailable) {
    return {
      playbook_id: def.id,
      session_window_open: windowOpen,
      precondition_match: false,
      trigger_fired: false,
      direction: null,
      detail: "HOD/LOD or technicals unavailable — cannot evaluate PB-03",
    };
  }

  const notPinning = desk.gamma_regime !== "mean_revert";
  const preconditionMatch = notPinning;
  const flow = flowDirection(desk);
  // "Halt feed degraded" (design doc's own invalidation clause) suppresses trigger_fired
  // outright — the verdict shape this task specifies has no separate invalidation field,
  // so a degraded feed folds into "the trigger cannot be trusted right now" rather than
  // being silently ignored. See module doc's INERTNESS section — this only affects the
  // SHADOW verdict, never a real gate.
  const feedDegraded = desk.feed_stalled === true || desk.halt_channel_stale === true || (desk.active_halts?.length ?? 0) > 0;

  const longTrigger =
    windowOpen &&
    !feedDegraded &&
    technicals.breakout.hod_break === true &&
    desk.above_gamma_flip === true &&
    flow !== "bearish";
  const shortTrigger =
    windowOpen &&
    !feedDegraded &&
    technicals.breakout.lod_break === true &&
    desk.above_gamma_flip === false &&
    flow !== "bullish";

  if (longTrigger) {
    return {
      playbook_id: def.id,
      session_window_open: true,
      precondition_match: preconditionMatch,
      trigger_fired: true,
      direction: "long",
      detail: `ORB long: price ${desk.price} cleared hod ${desk.hod} + gamma flip, flow ${flow ?? "unknown"}`,
    };
  }
  if (shortTrigger) {
    return {
      playbook_id: def.id,
      session_window_open: true,
      precondition_match: preconditionMatch,
      trigger_fired: true,
      direction: "short",
      detail: `ORB short: price ${desk.price} broke lod ${desk.lod} + below gamma flip, flow ${flow ?? "unknown"}`,
    };
  }

  return {
    playbook_id: def.id,
    session_window_open: windowOpen,
    precondition_match: preconditionMatch,
    trigger_fired: false,
    direction: null,
    detail: feedDegraded
      ? "Halt/feed degraded — ORB trigger suppressed per PB-03 invalidation clause"
      : `No OR break this tick (gamma_regime=${desk.gamma_regime}, above_gamma_flip=${desk.above_gamma_flip})`,
  };
}

/**
 * Evaluate all 3 Phase-1 playbooks against the already-computed desk/technicals payload
 * and pick a deterministic primary. SHADOW ONLY — see module doc.
 *
 * @param now injectable clock (ms epoch, defaults to Date.now()) purely for deterministic
 *            tests — production call sites never pass this.
 */
export function matchPlaybooksShadow(
  desk: SpxDeskPayload,
  technicals: PlayTechnicals,
  now: number = Date.now()
): PlaybookShadowMatchResult {
  const etMins = etMinutes(new Date(now));
  const verdicts = [
    matchPb01(desk, technicals, etMins),
    matchPb02(desk, technicals, etMins),
    matchPb03(desk, technicals, etMins),
  ];

  // Deterministic tie-break: first registry-order playbook whose trigger fired. Registry
  // order (PB-01, PB-02, PB-03) is arbitrary today (no priority/A+ ranking exists yet —
  // see the design doc's own Section 13 "Open Design Decisions": "Which 3 playbooks are
  // true A+ trades?" is explicitly unresolved) but must be SOME fixed, reproducible rule
  // rather than e.g. "last one evaluated wins," so the same tick always logs the same
  // primary pick if re-evaluated.
  const primary = verdicts.find((v) => v.trigger_fired);

  return {
    verdicts,
    primary_playbook_id: primary ? primary.playbook_id : null,
  };
}
