/**
 * The editorial layer for the gamma-levels research pages.
 *
 * WHY THIS IS A MODULE AND NOT JSX. Generated prose is where a correct statistic turns into a
 * false claim. "The call wall held 80% of the time" is a different sentence from "held on 4 of the
 * 5 sessions that tested it", and only the second is true when the window is thin. Every sentence
 * on these pages is produced here, from the payload, under test — so a page can never assert
 * something the data does not support, and the assertions are checkable without rendering React.
 *
 * The rules it enforces:
 *   - A rate is never stated without the denominator it came from.
 *   - A null rate produces an ABSENCE sentence, never a zero.
 *   - Nothing is described as a prediction. These are measurements of what already happened.
 */

import type { GammaLevelsResearch, WallStat } from "./gamma-levels-core";

/** Prices for reading. Strikes and index levels do not need four decimals, and floats arrive long. */
export function formatLevel(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const decimals = abs >= 100 ? 0 : abs >= 1 ? 2 : 4;
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** A rate as a whole-number percent. Callers must have already established the rate is non-null. */
export function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** "2026-08-19" → "August 19, 2026". Dates on a public page should read as dates. */
export function formatSessionLabel(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
}

/**
 * One sentence about a wall's measured behaviour, or an honest absence.
 *
 * `tested` is always stated. A hold rate over 3 sessions and one over 40 are different facts and
 * must not read the same — which they do the moment the denominator is dropped.
 */
export function wallSentence(stat: WallStat, label: "call wall" | "put wall", ticker: string): string {
  if (stat.holdRate === null || stat.tested === 0) {
    return `Over this window, price never came close enough to ${ticker}'s ${label} to test it. There is no hold rate to report — an untested level is not a strong one, it is simply an unmeasured one.`;
  }
  const verb = label === "call wall" ? "capped the session high" : "held the session low";
  return `On the ${stat.tested} ${stat.tested === 1 ? "session" : "sessions"} where price actually reached ${ticker}'s ${label}, it ${verb} ${stat.held} ${stat.held === 1 ? "time" : "times"} — ${formatRate(stat.holdRate)}.`;
}

/** The regime read: which side of the gamma flip this name has been closing on. */
export function flipSentence(research: GammaLevelsResearch): string {
  const { sessions, closedAbove, aboveRate } = research.flip;
  if (aboveRate === null || sessions === 0) {
    return `No gamma flip level was recorded for ${research.ticker} across this window, so there is no regime split to report.`;
  }
  const below = sessions - closedAbove;
  if (aboveRate >= 0.7) {
    return `${research.ticker} closed above its gamma flip on ${closedAbove} of ${sessions} sessions (${formatRate(aboveRate)}) — persistently on the long-gamma side, where dealer hedging leans against moves rather than with them.`;
  }
  if (aboveRate <= 0.3) {
    return `${research.ticker} closed below its gamma flip on ${below} of ${sessions} sessions (${formatRate(1 - aboveRate)}) — persistently on the short-gamma side, where dealer hedging amplifies moves instead of damping them.`;
  }
  return `${research.ticker} closed above its gamma flip on ${closedAbove} of ${sessions} sessions and below it on ${below} — a window with no settled regime, which is itself the read.`;
}

/** The "sticky levels" paragraph — the recurring strikes, or a plain statement that there were none. */
export function recurringSentence(research: GammaLevelsResearch): string {
  const calls = research.recurringCallWalls;
  const puts = research.recurringPutWalls;
  if (calls.length === 0 && puts.length === 0) {
    return `No single strike repeated as a wall across this window — ${research.ticker}'s dealer positioning moved with price rather than concentrating at a fixed level.`;
  }
  const parts: string[] = [];
  if (calls.length > 0) {
    const top = calls[0];
    parts.push(`${formatLevel(top.strike)} acted as the call wall on ${top.sessions} separate sessions`);
  }
  if (puts.length > 0) {
    const top = puts[0];
    parts.push(`${formatLevel(top.strike)} acted as the put wall on ${top.sessions}`);
  }
  return `The levels that kept coming back: ${parts.join(", and ")}. A strike that reappears across sessions is one where open interest has genuinely accumulated, not one that happened to sit nearest spot on a single day.`;
}

/** Coverage, stated plainly. A window is not the same thing as the sessions inside it. */
export function coverageSentence(research: GammaLevelsResearch): string {
  const { requested, covered, missing } = research.coverage;
  if (covered === 0) return `No sessions in the requested window carried recorded wall data.`;
  const base = `Measured across ${covered} of the last ${requested} trading sessions`;
  if (missing.length === 0) return `${base} — full coverage.`;
  const noBar = missing.filter((m) => m.reason === "no_bar").length;
  const noSamples = missing.filter((m) => m.reason === "no_samples").length;
  const noWalls = missing.filter((m) => m.reason === "no_walls").length;
  const why = [
    noSamples > 0 ? `${noSamples} with no recorded positioning` : null,
    noBar > 0 ? `${noBar} with no price bar` : null,
    noWalls > 0 ? `${noWalls} where no wall formed` : null,
  ].filter(Boolean);
  return `${base}. The remaining ${missing.length} ${missing.length === 1 ? "session is" : "sessions are"} excluded: ${why.join(", ")}.`;
}

export type PageCopy = {
  metaTitle: string;
  metaDescription: string;
  h1: string;
  standfirst: string;
};

/**
 * Title and description.
 *
 * The window dates are IN the description rather than the title: a title that changes daily
 * churns the search snapshot for no gain, while a description that states its window keeps the
 * page honest about being an archive rather than a live read.
 */
export function pageCopy(research: GammaLevelsResearch): PageCopy {
  const t = research.ticker;
  const covered = research.coverage.covered;
  const window = research.window;
  const range = window
    ? `${formatSessionLabel(window.from)} to ${formatSessionLabel(window.to)}`
    : "the recorded window";

  return {
    metaTitle: `${t} Gamma Levels: Call Wall, Put Wall & Gamma Flip History | BlackOut`,
    metaDescription: `Where ${t}'s dealer call wall, put wall and gamma flip actually sat over the last ${covered} trading sessions — and how often price respected each one. Measured from our own recorded positioning, ${range}.`,
    h1: `${t} Dealer Gamma Levels — ${covered}-Session History`,
    standfirst: `Every session in this window, we recorded where ${t}'s dealer gamma concentrated: the call wall above price, the put wall below it, and the gamma flip between them. This page is what those levels did next — not a forecast, a record. ${range}.`,
  };
}
