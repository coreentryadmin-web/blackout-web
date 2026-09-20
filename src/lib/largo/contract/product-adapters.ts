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

/**
 * NIGHT HAWK — committed 0DTE plays. Direction from what the desk actually took ON THE TICKER
 * ASKED ABOUT.
 *
 * IDENTITY FIX (Largo product contract, docs/audit/LARGO-PRODUCT-CONTRACT.md — "identity": every
 * product read must be about the ticker actually queried). `get_zerodte_plays` (the tool this
 * adapter reads, cross-product-read.ts's SOURCES) returns the WHOLE multi-ticker 0DTE board —
 * `input: () => ({})`, no ticker filter — because that tool answers "what is the 0DTE desk doing
 * today", not "what is it doing on ticker X". This adapter used to ignore that distinction
 * entirely: it counted calls/puts across EVERY committed play on the board (up to 10, regardless
 * of ticker) and reported the aggregate as if it were a read of the ONE ticker the cross-product
 * question was actually about — e.g. asking about TSLA (no 0DTE play today) could still return a
 * confident "bearish" vote sourced entirely from unrelated SPX/NVDA/QQQ plays. It then compounded
 * the mislabeling: the signal's own `ticker` field was read off `p.ticker`, a field the real board
 * payload never carries (there is no single ticker on a whole-board response), so in production
 * every nighthawk signal silently carried `ticker: ""` — the SAME identity gap the "ticker_class
 * hardcoded" bug fixed above for helix/vector, but never closed here because it manifests as an
 * always-empty string rather than an always-wrong constant.
 *
 * Fix: take the QUERIED ticker (same `(payload, queriedTicker)` shape spxContribution already
 * uses), filter the board's `plays` down to that ticker's own committed rows, and vote ONLY off
 * those. No committed play on that ticker is an honest, explained absence — never a borrowed
 * board-wide vote.
 *
 * NEUTRAL-STRUCTURE FIX (condor rows must never cast a directional vote). A committed 0DTE iron
 * condor (`condor.ts`) is a delta-neutral 4-leg structure SOLD for a credit — its own seed-bridge
 * comment (`buildCondorSetup`) says the row's `direction` field "carries the pin's nominal fade
 * side for provenance but is UNUSED by the neutral structure's gates/grader". This adapter used to
 * ignore that distinction: it read `play.option_type ?? play.side ?? play.direction` for EVERY
 * committed play, so a condor row (which carries no `option_type`/`side`, only that nominal
 * `direction`) fell through to the same calls/puts tally a real directional play uses, and cast a
 * bullish/bearish vote off a field its own engine documents as provenance-only. That is the exact
 * same "neutral evidence miscounted as directional" shape thermal's dealer-gamma fix (above) exists
 * to prevent — thermal already refuses to vote on gamma posture for this reason; a condor's nominal
 * fade side deserves the identical treatment. Condor rows are identified structurally
 * (`is_condor === true`, mirroring `zerodte-service.ts`'s own `entry_context.play_type === "CONDOR"`
 * check — plus the raw `play_type` field itself for a payload shape that hasn't gone through that
 * mapper) and excluded from the vote entirely; if every committed play on the queried ticker is a
 * condor, this reports an honest non-directional absence (mirroring `meridianContribution`'s
 * "sizes risk, does not point a direction" shape) rather than fabricating a directional signal.
 */
export function nighthawkContribution(payload: unknown, queriedTicker = ""): ProductContribution {
  const p = obj(payload);
  if (!p) return { product: "nighthawk", signal: null, missingReason: "night hawk board unavailable" };
  const ticker = canonicalTicker(queriedTicker);
  const allPlays = Array.isArray(p.plays) ? p.plays : Array.isArray(p.open) ? p.open : [];
  const plays = ticker
    ? allPlays.filter((raw) => {
        const play = obj(raw);
        return play != null && canonicalTicker(String(play.ticker ?? "")) === ticker;
      })
    : [];
  if (plays.length === 0) {
    return {
      product: "nighthawk",
      signal: null,
      missingReason: ticker
        ? `no committed 0DTE play on ${ticker} this session`
        : "no committed plays on the board this session",
    };
  }
  const isCondorPlay = (play: Record<string, unknown>) =>
    play.is_condor === true || String(play.play_type ?? "").toUpperCase() === "CONDOR";
  const directionalPlays = plays.filter((raw) => {
    const play = obj(raw);
    return play != null && !isCondorPlay(play);
  });
  const condorCount = plays.length - directionalPlays.length;
  if (directionalPlays.length === 0) {
    // Every committed play on this ticker is a neutral condor. Honest absence of DIRECTIONAL
    // evidence — never a vote borrowed off the condor's own provenance-only fade side.
    return {
      product: "nighthawk",
      signal: null,
      missingReason:
        `${condorCount} committed 0DTE iron condor${condorCount === 1 ? "" : "s"} on ${ticker} this ` +
        "session — a delta-neutral sold structure with no directional thesis, so night hawk casts no directional vote",
    };
  }
  let calls = 0;
  let puts = 0;
  const evidence: string[] = [];
  for (const raw of directionalPlays.slice(0, 10)) {
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
  if (condorCount > 0) {
    evidence.push(`${condorCount} committed iron condor${condorCount === 1 ? "" : "s"} on ${ticker} (neutral, excluded from this vote)`);
  }
  const direction: Direction = calls === puts ? "neutral" : calls > puts ? "bullish" : "bearish";
  return {
    product: "nighthawk",
    signal: {
      ticker,
      ticker_class: tickerClassFor(ticker),
      direction,
      evidence: evidence.length ? evidence : [`${calls} call-side / ${puts} put-side plays`],
      native: { play_count: directionalPlays.length, condor_count: condorCount },
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

/**
 * NIGHT HAWK SWINGS — the multi-day discovery/position lane, read via `get_swing_play_brief`
 * (`swing-play-brief-read.ts` -> `composeSwingPlayBrief`).
 *
 * Direction comes from the SAME `envelope.bias` the member-facing brief panel renders
 * (`biasFromDirection(play.direction)`, play-brief.ts) — never re-derived here, so this adapter
 * can never disagree with the brief a member would read for the same ticker.
 *
 * Found 2026-09-20 (Ask Largo standing mandate): `get_cross_product_read` — the ONLY tool that
 * answers "where do the desks disagree on <ticker>" — fanned out to Helix/Thermal/Vector/
 * Meridian/Night Hawk 0DTE/SPX Slayer but never to Night Hawk SWINGS, despite Swing being a real
 * directional, evidence-carrying product with its own tracked WATCH/OPEN positions and a Largo
 * tool (`get_swing_play_brief`) that had already been wired for single-ticker chat answers since
 * 2026-09-12 (see swing-play-brief-read.ts's own header). A member asking "what does the desk
 * think about NVDA" got a cross-product read that silently could never surface Swing's own stance
 * or disagree with it — an absence with no reason at all, the exact C3 violation the contract
 * exists to prevent, just one layer up (missing from the FAN-OUT, not missing a reason once
 * fanned out to). `swingPlayBriefForLargo` returning `available: false` (no open/watch/recently-
 * closed position on this ticker) is itself an honest, correctly-reasoned absence — that path is
 * unaffected; the bug was that Swing was never asked at all.
 */
export function swingContribution(payload: unknown, queriedTicker = ""): ProductContribution {
  const p = obj(payload);
  const ticker = canonicalTicker(queriedTicker);
  if (!p || p.available !== true) {
    const note = p && typeof p.note === "string" ? p.note : null;
    return {
      product: "swing",
      signal: null,
      missingReason: note ?? `no open, watch, or recently-closed swing position on ${ticker || "this ticker"}`,
    };
  }
  const envelope = obj(p.envelope);
  const bias = envelope && typeof envelope.bias === "string" ? envelope.bias : null;
  const direction: Direction = bias === "bullish" || bias === "bearish" ? bias : "neutral";
  const headline = envelope && typeof envelope.headline === "string" ? envelope.headline : null;
  const resolvedTicker = canonicalTicker(typeof p.ticker === "string" ? p.ticker : queriedTicker) || ticker;
  return {
    product: "swing",
    signal: {
      ticker: resolvedTicker,
      ticker_class: tickerClassFor(resolvedTicker),
      direction,
      evidence: headline ? [headline] : [`swing play-brief direction ${direction}`],
      native: {
        playId: p.playId ?? null,
        engine: p.engine ?? null,
      },
    },
  };
}
