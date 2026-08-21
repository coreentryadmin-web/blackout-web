import type { XIntelSurface } from "@/lib/x-intel/queue-types";

/**
 * BLACKOUT POST FRANCHISES — the recurring, recognisable formats the account publishes.
 *
 * Supplied by the operator 2026-08-21 and treated as authoritative. This replaces the earlier
 * generic format list, which named categories ("BREAKING_MARKET_MOVE", "WHAT_CHANGED") rather than
 * franchises. The distinction is the whole point:
 *
 * > "That is how you start creating BLACKOUT-native vocabulary instead of just another financial
 * >  X account."
 *
 * A franchise is something a reader learns to recognise. Somebody who has seen ⚡ BLACKOUT
 * CONFLUENCE three times knows what the fourth one means before reading a word of it. A category
 * is just a label the writer used. So the agent must NOT invent a fresh identity every hour —
 * `slug` here is the durable name, and the ranker penalises repeats to rotate between franchises
 * rather than to invent new ones.
 *
 * `primary_surface` is which product the franchise is ABOUT, not the only one it may cite. Every
 * package still needs 2–3 attachments from DIFFERENT surfaces; the primary is what the headline
 * franchise is built on.
 */

export type XIntelFranchise =
  | "WHALE_WATCH"
  | "GAMMA_SHIFT"
  | "BLACKOUT_CONFLUENCE"
  | "NIGHT_HAWK_STRIKE"
  | "LEVEL_THAT_MATTERS"
  | "MARKET_PULSE"
  | "AFTER_DARK"
  | "BEFORE_THE_BELL"
  | "RECEIPTS"
  | "SIGNAL_CONFLICT"
  | "EARNINGS_WAR_ROOM";

export type XIntelFranchiseDef = {
  slug: XIntelFranchise;
  /** The wordmark as it appears in the post. */
  label: string;
  emoji: string;
  /** Which product the franchise is built on. `null` = deliberately cross-product. */
  primary_surface: XIntelSurface | null;
  /** The condition that earns this franchise. Read by the ranker, and by a human reviewing a pick. */
  when: string;
  /**
   * True when the franchise is anchored to a time of day rather than to an event. These must not
   * be selected off-schedule — an ☀️ BEFORE THE BELL at 14:00 ET is not a rotation choice, it is
   * a wrong post.
   */
  scheduled: boolean;
};

export const X_INTEL_FRANCHISES: ReadonlyArray<XIntelFranchiseDef> = [
  {
    slug: "WHALE_WATCH",
    label: "WHALE WATCH",
    emoji: "🐋",
    primary_surface: "helix",
    when: "Large or repeated institutional premium on one name — size, repetition and direction, not a single random sweep",
    scheduled: false,
  },
  {
    slug: "GAMMA_SHIFT",
    label: "GAMMA SHIFT",
    emoji: "🔥",
    primary_surface: "thermal",
    when: "Dealer positioning changes regime — a gamma flip crossed, short-gamma territory entered, a wall breaking",
    scheduled: false,
  },
  {
    slug: "BLACKOUT_CONFLUENCE",
    label: "BLACKOUT CONFLUENCE",
    emoji: "⚡",
    primary_surface: null,
    when: "Three or more independent surfaces agree on one name, with a first-alignment timestamp",
    scheduled: false,
  },
  {
    slug: "NIGHT_HAWK_STRIKE",
    label: "NIGHT HAWK STRIKE",
    emoji: "🦅",
    primary_surface: "nighthawk",
    when: "A committed Night Hawk play with a timestamped fire and a graded or live result",
    scheduled: false,
  },
  {
    slug: "LEVEL_THAT_MATTERS",
    label: "LEVEL THAT MATTERS",
    emoji: "🎯",
    primary_surface: "vector",
    when: "One specific level is doing the work — a break, a reclaim, a repeated test",
    scheduled: false,
  },
  {
    slug: "MARKET_PULSE",
    label: "MARKET PULSE",
    emoji: "🌎",
    primary_surface: null,
    when: "Broad-market state worth stating on its own — breadth, volatility, sector rotation",
    scheduled: false,
  },
  {
    slug: "AFTER_DARK",
    label: "AFTER DARK",
    emoji: "🌙",
    primary_surface: null,
    when: "Post-close recap. Scheduled — the after-close slot only",
    scheduled: true,
  },
  {
    slug: "BEFORE_THE_BELL",
    label: "BEFORE THE BELL",
    emoji: "☀️",
    primary_surface: null,
    when: "Premarket setup. Scheduled — the premarket slot only",
    scheduled: true,
  },
  {
    slug: "RECEIPTS",
    label: "RECEIPTS",
    emoji: "🧾",
    primary_surface: null,
    when: "Retrospective proof of an EARLIER package whose detection is already on record. Requires a prior queue row — this is the one franchise that cannot be built from this hour alone",
    scheduled: false,
  },
  {
    slug: "SIGNAL_CONFLICT",
    label: "SIGNAL CONFLICT",
    emoji: "⚔️",
    primary_surface: null,
    when: "Surfaces disagree. Published AS a disagreement — never reconciled into a verdict",
    scheduled: false,
  },
  {
    slug: "EARNINGS_WAR_ROOM",
    label: "EARNINGS WAR ROOM",
    emoji: "📊",
    primary_surface: "meridian",
    when: "An earnings event with positioning worth mapping before, and an expected-vs-actual follow-up after",
    scheduled: false,
  },
];

export const X_INTEL_FRANCHISE_BY_SLUG: Readonly<Record<XIntelFranchise, XIntelFranchiseDef>> =
  Object.fromEntries(X_INTEL_FRANCHISES.map((f) => [f.slug, f])) as Record<
    XIntelFranchise,
    XIntelFranchiseDef
  >;

/** The wordmark line a post opens with, e.g. "⚡ BLACKOUT CONFLUENCE". */
export function franchiseWordmark(slug: XIntelFranchise): string {
  const f = X_INTEL_FRANCHISE_BY_SLUG[slug];
  return `${f.emoji} ${f.label}`;
}

/**
 * Franchises eligible this cycle.
 *
 * Two exclusions, and neither is a style preference:
 *
 * - A `scheduled` franchise is only eligible in its own slot. ☀️ BEFORE THE BELL at midday is not
 *   a rotation choice, it is a wrong post.
 * - 🧾 RECEIPTS needs a prior package to be receipts OF. Without one it would be a claim about
 *   detection with no record behind it, which is the backfilled-foresight failure wearing a
 *   different hat.
 */
export function eligibleFranchises(opts: {
  slot: "premarket" | "session" | "after_close";
  hasPriorPackageToProve: boolean;
}): XIntelFranchise[] {
  return X_INTEL_FRANCHISES.filter((f) => {
    if (f.slug === "BEFORE_THE_BELL") return opts.slot === "premarket";
    if (f.slug === "AFTER_DARK") return opts.slot === "after_close";
    if (f.scheduled) return false;
    if (f.slug === "RECEIPTS") return opts.hasPriorPackageToProve;
    return opts.slot === "session";
  }).map((f) => f.slug);
}

/**
 * How much a candidate franchise should be penalised for having been used recently.
 *
 * Returns a multiplier in (0, 1]. Multiplicative because it composes with the ranker's other
 * factors the same way — a franchise used in the last hour is not disqualified, it just has to be
 * a clearly better story than the alternatives to win again. `recent` is newest-first.
 *
 * PURE. The rotation has to be explainable after the fact ("why did this beat that"), and a
 * penalty computed inline in a cron is one nobody can replay.
 */
export function franchiseRepeatPenalty(
  candidate: XIntelFranchise,
  recent: ReadonlyArray<XIntelFranchise>,
): number {
  const idx = recent.indexOf(candidate);
  if (idx === -1) return 1;
  // Immediately previous → heaviest. Decays back to 1 as it recedes.
  const PENALTIES = [0.25, 0.5, 0.7, 0.85];
  return PENALTIES[idx] ?? 1;
}
