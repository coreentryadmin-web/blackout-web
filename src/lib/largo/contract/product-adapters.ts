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
import { canonicalTicker, type Direction, type ProductSignal } from "./product-read";

/** Read a possibly-missing number without letting a string "7705" or a null poison arithmetic. */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
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

/** HELIX — the tape. Direction from session call/put skew. */
export function helixContribution(payload: unknown): ProductContribution {
  const p = obj(payload);
  if (!p) return { product: "helix", signal: null, missingReason: "helix tape read unavailable" };
  if (p.empty_reason) {
    return { product: "helix", signal: null, missingReason: `helix tape empty: ${String(p.empty_reason)}` };
  }
  const session = obj(p.session);
  const callPct = num(session?.call_pct);
  const direction = directionFromCallPct(callPct);
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
      ticker_class: "equity",
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
      ticker_class: "index",
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
      ticker_class: "index",
      direction,
      evidence: evidence.length ? evidence : [`${calls} call-side / ${puts} put-side plays`],
      native: { play_count: plays.length },
    },
  };
}
