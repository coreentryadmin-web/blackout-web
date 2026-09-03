// ADAPTERS — derive a contract `ProductSignal` from each product's CURRENT payload shape.
//
// WHY ADAPTERS RATHER THAN WAITING. The contract asks every lane to emit `ProductSignal` natively.
// Five lanes will get there at five different times, and an integration layer that cannot run until
// the last one lands is an integration layer nobody can test. These adapters read what each product
// already returns today, so the cross-product join works now. As lanes adopt the contract natively
// each adapter collapses to a pass-through — they are scaffolding with a planned demolition date,
// not a permanent translation layer.
//
// EVERY ADAPTER IS DEFENSIVE. Lane payloads are being actively rewritten by five agents tonight. An
// adapter that throws on an unexpected shape would take the whole cross-product read down with it,
// so each returns a `ProductContribution` with an explicit `missingReason` instead. Absence with a
// reason is the contract's C3, and it applies to this layer exactly as it applies to the products.

import type { ProductContribution } from "./cross-product";
import { canonicalTicker, type Direction, type TickerClass, type ProductSignal } from "./product-read";
import { canonicalTicker as classifyTicker } from "@/lib/largo/core/entities";

/** Read a possibly-missing number without letting a string "7705" or a null poison arithmetic. */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Derive `ticker_class` from the actual ticker rather than a per-product constant. Each adapter
 * below used to hardcode "equity" (helix) or "index" (vector/nighthawk) regardless of what ticker
 * was queried — correct only by coincidence for SPX-only test fixtures, silently wrong for any
 * other ticker (ask about TSLA: vector/nighthawk both asserted `ticker_class: "index"`). Falls back
 * to "equity" only when the ticker cannot be classified at all, matching core/entities.ts's own
 * default for an unrecognized symbol.
 */
function tickerClassFor(ticker: string): TickerClass {
  return classifyTicker(ticker)?.kind ?? "equity";
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Direction from a call-share percentage.
 *
 * The 45/55 deadband is deliberate. A 51% call share is not a bullish tape, and without a band the
 * join would manufacture disagreement out of noise — two products straddling 50% would read as a
 * genuine split when they are measuring the same balanced flow.
 */
export function directionFromCallPct(callPct: number | null): Direction | null {
  if (callPct === null) return null;
  if (callPct >= 55) return "bullish";
  if (callPct <= 45) return "bearish";
  return "neutral";
}

/**
 * HELIX — the tape.
 *
 * Direction comes from `session.direction` — the AGGRESSOR-AWARE read `directionFields`
 * (helix-tape-analytics.ts) already stamps onto this exact payload shape ("bullish" | "bearish" |
 * "mixed" | "undetermined") — not from re-deriving one out of `session.call_pct` here. Call share
 * alone cannot tell a bought call from a sold one, and the two read opposite directions: this
 * adapter used to run `directionFromCallPct(call_pct)` regardless of the `direction` field sitting
 * right next to it, so a session like `{ call_pct: 100, direction: "bearish" }` (100% call
 * premium, but every call SOLD — the real CG case this lane's own aggressor-read module
 * documents) reported `direction: "bullish"` here while the SAME object's own authoritative field
 * said the opposite. That fed the cross-product join with a fabricated agreement/disagreement.
 * Falls back to the call-share rule only when the payload doesn't carry `direction` at all (an
 * older/partial shape) — never when it does but reads `"undetermined"`, which is itself a real
 * "no measurable direction" answer, not an invitation to guess one from call share instead.
 */
export function helixContribution(payload: unknown): ProductContribution {
  const p = obj(payload);
  if (!p) return { product: "helix", signal: null, missingReason: "helix tape read unavailable" };
  if (p.empty_reason) {
    return { product: "helix", signal: null, missingReason: `helix tape empty: ${String(p.empty_reason)}` };
  }
  const session = obj(p.session);
  const callPct = num(session?.call_pct);
  const rawDirection = session?.direction;
  const direction: Direction | null =
    typeof rawDirection === "string"
      ? rawDirection === "bullish"
        ? "bullish"
        : rawDirection === "bearish"
          ? "bearish"
          : rawDirection === "mixed"
            ? "neutral"
            : null // "undetermined" (or an unrecognized value) — no measurable direction
      : directionFromCallPct(callPct);
  if (direction === null) {
    return { product: "helix", signal: null, missingReason: "helix tape has no measurable call/put skew" };
  }
  const evidence: string[] = [`session call share ${callPct}%`];
  const alertCount = num(session?.alert_count);
  if (alertCount !== null) evidence.push(`${alertCount} prints`);
  return {
    product: "helix",
    signal: {
      ticker: canonicalTicker(String(p.ticker ?? "")),
      ticker_class: tickerClassFor(String(p.ticker ?? "")),
      direction,
      evidence,
      native: { session, expiry_horizons: p.expiry_horizons ?? null },
    },
  };
}

/**
 * THERMAL — dealer gamma.
 *
 * Thermal contributes NO direction, on purpose. Dealer gamma is not a directional measurement:
 * short gamma amplifies a move in either direction, so folding it onto a bullish/bearish axis
 * asserts something the matrix never measured. That was a live P0 (#2422): a regex over the
 * regime prose matched the word "support" and reported `bullish` on a short-gamma book, 3 of 3
 * tickers inverted.
 *
 * So this returns a contribution with `signal: null` and the reason stated. That is not a gap —
 * it is the honest shape, and it means Thermal appears in `missing` with an explanation rather
 * than casting a vote it has no basis for. Thermal's real axis travels in the reason and is
 * available to the model separately as `volatility_regime`.
 */
export function thermalContribution(payload: unknown): ProductContribution {
  const p = obj(payload);
  const thermal = obj(p?.thermal);
  const posture = thermal?.gamma_posture ?? null;
  const vol = thermal?.volatility_regime ?? null;
  if (!p || !thermal || posture == null) {
    return { product: "thermal", signal: null, missingReason: "no dealer gamma posture available" };
  }
  return {
    product: "thermal",
    signal: null,
    missingReason:
      `dealer gamma is not a directional measurement — posture ${String(posture)} ` +
      `(${vol ? String(vol) : "vol regime unknown"}), so thermal casts no directional vote`,
  };
}

/**
 * VECTOR — the differential pulse.
 *
 * `has_baseline: false` is the ecosystem's canonical absence case: on the first read of a session
 * there is no previous snapshot to diff against, so an empty signal list means "no baseline yet",
 * NOT "the tape is quiet". Both are `[]`; only one is a finding. It is handled first and by name.
 */
export function vectorContribution(payload: unknown): ProductContribution {
  const p = obj(payload);
  if (!p) return { product: "vector", signal: null, missingReason: "vector pulse read unavailable" };
  if (p.has_baseline === false) {
    return {
      product: "vector",
      signal: null,
      missingReason: "no baseline yet this session — pulse is differential, so it has nothing to diff against",
    };
  }
  const signals = Array.isArray(p.signals) ? p.signals : Array.isArray(p.pulse) ? p.pulse : [];
  if (signals.length === 0) {
    return { product: "vector", signal: null, missingReason: "baseline present but no pulse signals fired" };
  }
  let bull = 0;
  let bear = 0;
  const evidence: string[] = [];
  for (const raw of signals.slice(0, 8)) {
    const s = obj(raw);
    const tone = String(s?.tone ?? "").toLowerCase();
    if (tone === "bullish") bull += 1;
    else if (tone === "bearish") bear += 1;
    const line = s?.line ?? s?.signal ?? s?.kind;
    if (line) evidence.push(String(line).slice(0, 140));
  }
  if (bull === 0 && bear === 0) {
    return { product: "vector", signal: null, missingReason: "pulse signals carry no directional tone" };
  }
  const direction: Direction = bull === bear ? "neutral" : bull > bear ? "bullish" : "bearish";
  return {
    product: "vector",
    signal: {
      ticker: canonicalTicker(String(p.ticker ?? "")),
      ticker_class: tickerClassFor(String(p.ticker ?? "")),
      direction,
      evidence: evidence.length ? evidence : [`${bull} bullish / ${bear} bearish pulse signals`],
      native: { has_baseline: p.has_baseline ?? null, signal_count: signals.length },
    },
  };
}

/** MERIDIAN — the earnings/catalyst calendar. Contributes only when an event is actually in range. */
export function meridianContribution(payload: unknown): ProductContribution {
  const p = obj(payload);
  if (!p) return { product: "meridian", signal: null, missingReason: "meridian read unavailable" };
  const events = Array.isArray(p.events) ? p.events : Array.isArray(p.earnings) ? p.earnings : [];
  if (events.length === 0) {
    return { product: "meridian", signal: null, missingReason: "no earnings or catalyst event in the window" };
  }
  // Meridian describes WHEN and HOW BIG, not which way — an expected move is symmetric by
  // construction. Reporting a direction off it would invent one, so it contributes context, not a vote.
  const first = obj(events[0]);
  const move = num(first?.expected_move_pct ?? first?.expected_move);
  return {
    product: "meridian",
    signal: null,
    missingReason:
      move !== null
        ? `earnings event in window with a symmetric expected move of ${move}% — sizes the risk, does not point a direction`
        : "earnings event in window, but no expected move to size it",
  };
}

/** NIGHT HAWK — committed 0DTE plays. Direction from what the desk actually took. */
export function nighthawkContribution(payload: unknown): ProductContribution {
  const p = obj(payload);
  if (!p) return { product: "nighthawk", signal: null, missingReason: "night hawk board unavailable" };
  const plays = Array.isArray(p.plays) ? p.plays : Array.isArray(p.open) ? p.open : [];
  if (plays.length === 0) {
    return { product: "nighthawk", signal: null, missingReason: "no committed plays on the board this session" };
  }
  let calls = 0;
  let puts = 0;
  const evidence: string[] = [];
  for (const raw of plays.slice(0, 10)) {
    const play = obj(raw);
    const side = String(play?.option_type ?? play?.side ?? play?.direction ?? "").toLowerCase();
    if (side.includes("call") || side === "long" || side === "bullish") calls += 1;
    else if (side.includes("put") || side === "short" || side === "bearish") puts += 1;
    const t = play?.ticker;
    if (t) evidence.push(`${String(t)} ${side || "unknown side"}`);
  }
  if (calls === 0 && puts === 0) {
    return { product: "nighthawk", signal: null, missingReason: "committed plays carry no readable side" };
  }
  const direction: Direction = calls === puts ? "neutral" : calls > puts ? "bullish" : "bearish";
  return {
    product: "nighthawk",
    signal: {
      ticker: canonicalTicker(String(p.ticker ?? "")),
      ticker_class: tickerClassFor(String(p.ticker ?? "")),
      direction,
      evidence: evidence.length ? evidence : [`${calls} call-side / ${puts} put-side plays`],
      native: { play_count: plays.length },
    },
  };
}

function spxDirectionFromPlay(raw: string | null | undefined): Direction | null {
  const d = String(raw ?? "").toLowerCase();
  if (d === "long" || d === "bullish") return "bullish";
  if (d === "short" || d === "bearish") return "bearish";
  return null;
}

/**
 * SPX SLAYER — the single-instrument play engine. SPX/SPXW only.
 *
 * Direction comes from the engine's committed stance (`direction` on the play payload, or the open
 * play's direction when live). SCANNING/WATCHING with no direction is an explained absence — not a
 * neutral vote — because the engine has not committed a stance yet.
 */
export function spxContribution(payload: unknown, queriedTicker = "SPX"): ProductContribution {
  const ticker = canonicalTicker(queriedTicker) || "SPX";
  if (ticker !== "SPX" && ticker !== "SPXW") {
    return {
      product: "spx",
      signal: null,
      missingReason: "SPX Slayer only tracks SPX/SPXW — no play-engine read for this ticker",
    };
  }

  const p = obj(payload);
  if (!p || p.available === false) {
    return { product: "spx", signal: null, missingReason: "SPX Slayer play engine unavailable" };
  }

  const direction =
    spxDirectionFromPlay(typeof p.direction === "string" ? p.direction : null) ??
    spxDirectionFromPlay(
      obj(p.open_play)?.direction != null ? String(obj(p.open_play)!.direction) : null
    );

  if (direction === null) {
    const phase = String(p.phase ?? p.action ?? "unknown");
    return {
      product: "spx",
      signal: null,
      missingReason: `SPX Slayer has no committed direction yet (phase ${phase})`,
    };
  }

  const evidence: string[] = [];
  if (p.headline) evidence.push(String(p.headline).slice(0, 140));
  if (p.grade) evidence.push(`grade ${String(p.grade)}`);
  if (p.phase) evidence.push(`phase ${String(p.phase)}`);
  if (p.action) evidence.push(`action ${String(p.action)}`);
  if (p.signal_committed === true) evidence.push("signal committed");

  return {
    product: "spx",
    signal: {
      ticker: "SPX",
      ticker_class: "index",
      direction,
      evidence: evidence.length ? evidence : [`SPX Slayer direction ${direction}`],
      native: {
        phase: p.phase ?? null,
        action: p.action ?? null,
        score: num(p.score),
        signal_committed: p.signal_committed ?? null,
      },
    },
  };
}
