/**
 * SYSTEM READS — what each product independently thinks about one instrument, side by side.
 *
 * THE QUESTION THIS ANSWERS is "where do systems disagree?", which is the one question a member
 * cannot answer by opening a tab. Every product on this desk already has an opinion; they are just
 * on five different pages, in five different vocabularies, and nothing has ever put them in one
 * column. Agreement across independent systems is the highest-value thing this platform knows and
 * the only thing it has never said out loud.
 *
 * THE HARD PART IS NOT THE LAYOUT, IT IS REFUSING TO INVENT THE NUMBERS. A stance strip is a
 * machine for fabrication: it wants every row filled, every bar populated, every system scored
 * 0-100 on one axis. Four rules stop that here, and every one of them costs rows:
 *
 *  1. A BAR REQUIRES A NATIVE QUANTITY. A system gets a numeric bar only when it already produces
 *     a real 0-100-able measurement of its own — Vector's play conviction, the tape's directional
 *     premium concentration. Nothing is normalised into a score to make the column look full. A
 *     system with an opinion but no number renders its opinion and no bar.
 *
 *  2. REGIME IS NOT DIRECTION. Spot above the gamma flip is a dealer-positioning state, not a
 *     bullish call. Mapping it onto a bull/bear axis would manufacture a directional vote out of a
 *     volatility regime and then count it in the agreement tally. Regime rows are typed
 *     `regime`, are excluded from agreement, and say what they actually are.
 *
 *  3. NO READ IS NOT NEUTRAL. A system that could not be reached, or whose sample is too thin to
 *     mean anything, returns `no-read` with the reason — never `neutral`, never 50. Neutral is a
 *     finding ("the tape is balanced"); no-read is an absence. Collapsing them tells a member the
 *     desk looked and saw nothing, when the desk did not look.
 *
 *  4. THE BASIS IS ALWAYS CARRIED. Every row states the literal quantity behind it, so a bar can
 *     be audited against the page it came from instead of taken on faith.
 *
 * PURE AND TOTAL: no IO, no clock, no throw. Callers fetch through the real production reads and
 * pass the results in.
 */

export type SystemStance = "bullish" | "bearish" | "neutral" | "no-read";

/** `directional` rows vote in the agreement tally; `regime` rows describe a state and never do. */
export type SystemReadKind = "directional" | "regime";

export type SystemRead = {
  /** Display name, matching what the member sees in the nav. */
  system: string;
  kind: SystemReadKind;
  stance: SystemStance;
  /** 0-100, and ONLY when the system natively produces one. Never a normalised stand-in. */
  strength: number | null;
  /** The literal quantity behind the row — what a member would check to disprove it. */
  basis: string;
  /** Present only on `no-read`: why the system has nothing to say. */
  reason?: string;
};

/** Below this, directional premium is balance rather than a side. */
const FLOW_NEUTRAL_BAND = 0.1;
/** Fewer prints than this and the net is one block trade, not a read. */
const FLOW_MIN_PRINTS = 10;

/**
 * HELIX — directional concentration of option premium on the tape.
 *
 * The quantity is `|net| / gross`: of all the premium that traded, what share ended up pointing one
 * way. That is a real, bounded, checkable number, unlike "flow score". Gross is the denominator on
 * purpose — net alone cannot distinguish $2M of one-sided flow from $2M net inside $200M of
 * two-way churn, and those are opposite readings of the same tape.
 */
export function helixFlowRead(input: {
  netPremium: number | null;
  grossPremium: number | null;
  printCount: number;
}): SystemRead {
  const { netPremium, grossPremium, printCount } = input;
  const base = { system: "HELIX", kind: "directional" as const };

  if (netPremium == null || grossPremium == null || !Number.isFinite(grossPremium) || grossPremium <= 0) {
    return { ...base, stance: "no-read", strength: null, basis: "—", reason: "no flow tape" };
  }
  if (printCount < FLOW_MIN_PRINTS) {
    return {
      ...base,
      stance: "no-read",
      strength: null,
      basis: `${printCount} ${printCount === 1 ? "print" : "prints"}`,
      // A handful of prints can net to a huge one-sided number and mean nothing.
      reason: `only ${printCount} prints`,
    };
  }

  const ratio = Math.abs(netPremium) / grossPremium;
  const stance: SystemStance = ratio < FLOW_NEUTRAL_BAND ? "neutral" : netPremium > 0 ? "bullish" : "bearish";
  return {
    ...base,
    stance,
    strength: Math.round(Math.min(1, ratio) * 100),
    basis: `net ${money(netPremium)} of ${money(grossPremium)} gross · ${printCount} prints`,
  };
}

/**
 * VECTOR — its OWN derived play, cited rather than re-scored.
 *
 * `conviction` is Vector's number, produced by the same code that renders the Vector page. Re-scoring
 * it here would put a second, quieter opinion on screen under the first one's name.
 */
export function vectorPlayRead(
  play: { bias?: string | null; grade?: string | null; conviction?: number | null } | null | undefined
): SystemRead {
  const base = { system: "VECTOR", kind: "directional" as const };
  const bias = String(play?.bias ?? "").toLowerCase();

  if (!play || !bias) {
    return { ...base, stance: "no-read", strength: null, basis: "—", reason: "no play derived" };
  }

  const stance: SystemStance = /bull|long|call/.test(bias)
    ? "bullish"
    : /bear|short|put/.test(bias)
      ? "bearish"
      : "neutral";
  const conviction =
    typeof play.conviction === "number" && Number.isFinite(play.conviction)
      ? Math.round(Math.max(0, Math.min(100, play.conviction)))
      : null;

  return {
    ...base,
    stance,
    // No conviction from Vector means no bar. A grade is not a score and must not be rendered as one.
    strength: conviction,
    basis: [play.grade, play.bias].filter(Boolean).join(" · ") || String(play.bias),
  };
}

/**
 * NIGHT HAWK — committed plays on this instrument, as a count, not a sentiment.
 *
 * Direction comes from the plays themselves. There is deliberately NO bar: a lane with one open
 * call is not "100% bullish", and mapping play count onto a 0-100 axis would say exactly that. The
 * count IS the read — a system with money on one side is a different claim from a system with a view.
 */
export function nightHawkRead(
  plays: ReadonlyArray<{ direction?: string | null; status?: string | null }> | null | undefined
): SystemRead {
  const base = { system: "NIGHT HAWK", kind: "directional" as const };
  if (!plays) return { ...base, stance: "no-read", strength: null, basis: "—", reason: "lane unavailable" };
  if (!plays.length) {
    return { ...base, stance: "no-read", strength: null, basis: "no plays", reason: "no plays on this name" };
  }

  let bull = 0;
  let bear = 0;
  for (const p of plays) {
    const d = String(p.direction ?? "").toLowerCase();
    if (/bull|long|call/.test(d)) bull++;
    else if (/bear|short|put/.test(d)) bear++;
  }

  const stance: SystemStance = bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral";
  const n = plays.length;
  return {
    ...base,
    stance,
    strength: null,
    basis: `${n} ${n === 1 ? "play" : "plays"}${bull || bear ? ` · ${bull}L/${bear}S` : ""}`,
  };
}

/** Night Hawk row reconciling evening edition, 0DTE board, and swing lane. */
export function nightHawkReconciledRead(
  state: {
    edition: ReadonlyArray<{ ticker: string; direction: string; conviction?: string | null; product: string }>;
    zerodte: ReadonlyArray<{ direction: string; status?: string | null; product: string }>;
    swing: ReadonlyArray<{ direction: string; product: string }>;
    forTicker: ReadonlyArray<{ direction: string; conviction?: string | null; product: string }>;
    consulted: { edition: boolean; zerodte: boolean; swing: boolean };
  },
  ticker: string | null
): SystemRead {
  const base = { system: "NIGHT HAWK", kind: "directional" as const };
  const plays = state.forTicker;

  if (!plays.length) {
    const consulted = state.consulted.edition || state.consulted.zerodte || state.consulted.swing;
    if (!consulted) {
      return { ...base, stance: "no-read", strength: null, basis: "—", reason: "lane unavailable" };
    }
    const editionHasTicker =
      ticker != null && state.edition.some((p) => p.ticker === ticker.toUpperCase());
    return {
      ...base,
      stance: "no-read",
      strength: null,
      basis: "no plays",
      reason: editionHasTicker
        ? "no plays on this name"
        : state.consulted.zerodte && !state.consulted.edition
          ? "no open plays on 0DTE board"
          : "no plays on this name",
    };
  }

  let bull = 0;
  let bear = 0;
  for (const p of plays) {
    const d = String(p.direction ?? "").toLowerCase();
    if (/bull|long|call/.test(d)) bull++;
    else if (/bear|short|put/.test(d)) bear++;
  }
  const stance: SystemStance = bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral";
  const src = plays[0]!.product;
  const conv = plays[0]?.conviction;
  const productLabel =
    src === "edition" ? "evening edition" : src === "zerodte" ? "0DTE board" : "swings lane";
  const n = plays.length;
  return {
    ...base,
    stance,
    strength: null,
    basis: `${n} ${n === 1 ? "play" : "plays"} · ${productLabel}${conv ? ` · conv ${conv}` : ""}${bull || bear ? ` · ${bull}L/${bear}S` : ""}`,
  };
}

/**
 * GAMMA REGIME — a state, never a vote.
 *
 * Spot above the gamma flip means dealers are net long gamma and hedging DAMPENS moves; below it
 * they amplify. That changes how to size and how far to trust a level — it does not say up or down,
 * and it is typed `regime` so nothing downstream can count it as if it did.
 */
export function gammaRegimeRead(input: { spot: number | null; gammaFlip: number | null }): SystemRead {
  const base = { system: "GAMMA", kind: "regime" as const };
  const { spot, gammaFlip } = input;
  if (spot == null || gammaFlip == null || !Number.isFinite(spot) || !Number.isFinite(gammaFlip)) {
    return { ...base, stance: "no-read", strength: null, basis: "—", reason: "no flip level" };
  }
  const above = spot >= gammaFlip;
  const pct = gammaFlip > 0 ? ((spot - gammaFlip) / gammaFlip) * 100 : 0;
  return {
    ...base,
    stance: "neutral",
    strength: null,
    basis: `${above ? "positive" : "negative"} gamma · spot ${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}% vs flip`,
  };
}

export type SystemAgreement = {
  /** Directional systems that actually returned a read. Regime and no-read rows are excluded. */
  voting: number;
  bullish: number;
  bearish: number;
  neutral: number;
  /** "aligned" | "split" | "insufficient" — the headline a member reads first. */
  verdict: "aligned" | "split" | "insufficient";
  /** The direction, when aligned. Null when split or insufficient — never a coin-flip. */
  direction: "bullish" | "bearish" | null;
};

/**
 * Tally agreement across the directional reads.
 *
 * ONE VOTE IS NOT AGREEMENT. "Aligned" needs at least two systems that both looked and both landed
 * on the same side; a single opinion with four absences beside it is the weakest state on the desk,
 * and calling it consensus would invert its meaning. Neutral reads count toward the sample (the
 * tape genuinely being balanced is evidence) but cannot make a side.
 */
export function agreementOf(reads: readonly SystemRead[]): SystemAgreement {
  const voting = reads.filter((r) => r.kind === "directional" && r.stance !== "no-read");
  const bullish = voting.filter((r) => r.stance === "bullish").length;
  const bearish = voting.filter((r) => r.stance === "bearish").length;
  const neutral = voting.filter((r) => r.stance === "neutral").length;

  if (voting.length < 2) {
    return { voting: voting.length, bullish, bearish, neutral, verdict: "insufficient", direction: null };
  }
  if (bullish >= 2 && bearish === 0) {
    return { voting: voting.length, bullish, bearish, neutral, verdict: "aligned", direction: "bullish" };
  }
  if (bearish >= 2 && bullish === 0) {
    return { voting: voting.length, bullish, bearish, neutral, verdict: "aligned", direction: "bearish" };
  }
  return { voting: voting.length, bullish, bearish, neutral, verdict: "split", direction: null };
}

/** Compact money for a basis string. Kept local so the pure module has no UI dependency. */
function money(n: number): string {
  const sign = n < 0 ? "−" : "+";
  const a = Math.abs(n);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`;
  return `${sign}$${a.toFixed(0)}`;
}
