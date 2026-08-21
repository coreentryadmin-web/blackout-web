import type { XIntelCta, XIntelCtaVariant } from "@/lib/x-intel/queue-types";
import { X_INTEL_CTA_VARIANTS } from "@/lib/x-intel/queue-types";

/**
 * THE CALL TO ACTION — rotated per package, carried as a SEPARATE field from the post copy.
 *
 * ── PLACEMENT: IN THE BODY (operator decision, 2026-08-21) ─────────────────────────────────────
 *
 * The CTA replaces the `BLACKOUT // THERMAL + MERIDIAN` sign-off at the foot of the post, as a
 * rotating one-liner plus a link.
 *
 * I originally built this as a REPLY and argued for it on reach grounds — the reasoning is kept
 * below because it is still true and worth re-reading if the numbers ever say so. The operator
 * asked for a body CTA twice, which settles it: it is their account, their reach to spend, and
 * they are the one who can see whether it costs anything. `placement` remains a field rather than
 * a constant so the decision stays visible and reversible, and the learning loop can measure it
 * once there is data — right now there is none, so nobody actually knows which is better.
 *
 * The original reasoning, for the record:
 *
 * 1. **Reach.** @BlackOutTrade is already algorithm-cold — `docs/ops/X-MARKETING-AUDIT.md` measures
 *    ~8–40 impressions on recent posts against 1,908 followers. An external link in the body of a
 *    post is the single most reliable way to suppress distribution further, and suppressing a post
 *    that carries real market intelligence to sell a link is a bad trade at any conversion rate.
 *    The repo already encodes this convention — `social-realtime-triggers.ts` says "link Discord in
 *    reply thread not main tweet".
 * 2. **Room.** 280 characters is tight for a package that has to carry a level, a time, a move and
 *    an attribution. A CTA block in the body crowds out the evidence the post exists to show.
 * 3. **Trust.** The post is the product demonstration. Keeping the ask one step behind it is the
 *    difference between a desk that publishes intelligence and an account that publishes ads.
 *
 * On the API this would also be a 13× cost difference — a desk post with a URL in the body is
 * ~$0.20 on pay-per-use versus ~$0.015 without — but that is NOT the reason here, and it is worth
 * being precise about why: packages from this queue are published BY HAND by a human, so they cost
 * nothing per post and the pay-per-use pricing does not apply to them at all. The reach argument
 * stands on its own.
 *
 * ── WHY ROTATION IS DETERMINISTIC AND NOT RANDOM ───────────────────────────────────────────────
 *
 * A random pick is unmeasurable at this volume. At ~7 packages a day, random selection produces
 * runs and gaps that are indistinguishable from a CTA that works or does not — you cannot tell a
 * good offer from a lucky week, which means the learning loop can never improve it. Least-recently-
 * used rotation gives even exposure, and because the chosen variant is recorded on the queue row,
 * every CTA can be attributed down the funnel the brief asks for:
 *
 *     impressions → engagement → profile visits → BLACKOUT visits → registrations → memberships
 *
 * That attribution is the entire point of rotating at all. A rotation nobody measures is just
 * variety.
 *
 * ── WHY NOT EVERY POST ASKS FOR MONEY ──────────────────────────────────────────────────────────
 *
 * `SOFT` and `DISCORD` carry no offer. This is the same principle as never forcing a story onto a
 * quiet hour: an account that asks for a sale on every single post stops being one traders open.
 * The paid variants are deliberately a minority of the rotation.
 */

/** Where the offer copy comes from. Kept in one place so a price change is one edit. */
const PRICING = {
  full: "$199/mo",
  spx: "$49/mo",
} as const;

/**
 * The promo code is supplied by the operator and is NOT verifiable from this repo — there is no
 * promo-code record anywhere in the codebase, so nothing here can confirm it is live in Whop. A
 * dead code in a public post is worse than no code: it converts an offer into a broken promise in
 * front of the exact audience being asked to buy. Whoever changes this must re-check it in Whop.
 */
const PROMO_CODE = "BLACK50";

const LINKS = {
  /**
   * Supplied by the operator 2026-08-21. NOTE: `SITE.social.discord.url` in `src/lib/site.ts`
   * points at a DIFFERENT invite (`5zSt7G34dw`). One of the two is stale and they are not
   * reconciled here on purpose — picking one silently would either publish a dead invite or
   * quietly overrule the site's own config. Raised in the PR; see the note there.
   */
  discord: "https://discord.gg/j9FNuBXfMH",
  whop: "https://whop.com/joined/blackout-2d9c/",
  site: "https://www.blackouttrades.com",
} as const;

/**
 * UTM tagging, so a click can be traced to the exact package that earned it.
 *
 * `utm_content` carries the cycle key rather than a post type — the existing `x-whop-link.ts`
 * tags by post TYPE, which cannot distinguish two packages of the same type and is why the current
 * analytics can only attribute at the campaign level. Per-package is the granularity the learning
 * loop needs.
 */
function tagged(url: string, cycleKey: string, variant: XIntelCtaVariant): string {
  const u = new URL(url);
  u.searchParams.set("utm_source", "x");
  u.searchParams.set("utm_medium", "social");
  u.searchParams.set("utm_campaign", "x-intel");
  u.searchParams.set("utm_content", `${cycleKey}:${variant}`);
  return u.toString();
}

type EdgeLine = { readonly variant: XIntelCtaVariant; readonly line: string };

/**
 * ONE TRUE, SPECIFIC CLAIM PER POST.
 *
 * Every line here names something the desk actually does, in the terms a trader would check. That
 * constraint is not style — the post above this block is a measured screenshot, so a vague claim
 * underneath one ("powerful analytics", "institutional-grade data") reads as the part that was made
 * up, and costs the evidence its credibility. Each of these was observed on the live platform.
 */
const EDGES: ReadonlyArray<EdgeLine> = [
  {
    variant: "SCANNER",
    line: "The Universe Scanner ranks the whole board by distance to its gamma flip — you see who is about to matter before it moves.",
  },
  {
    variant: "FLIP_ALERTS",
    line: "Positioning alerts fire the moment spot crosses the flip — regime change, timestamped, not noticed twenty minutes later.",
  },
  {
    variant: "EXPIRY_MATRIX",
    line: "Every strike against every expiry, with net GEX, walls, flip and max pain — and you can read 0DTE and all-expiry separately, because they often disagree.",
  },
  {
    variant: "BEAD_RAILS",
    line: "Gamma drawn on the chart itself — every strike's beads and wall bands sitting on the candles, not in a table you have to translate.",
  },
  {
    variant: "EARNINGS_BASE_RATES",
    line: "Earnings scored against this name's own base rate with the sample size shown — and it says \"insufficient history\" rather than inventing a number.",
  },
  {
    variant: "TAPE",
    line: "The tape with the size that matters: net premium, repeat strikes, dark-pool blocks, and which side actually paid up.",
  },
  {
    variant: "OPEX_HISTORY",
    line: "OpEx and macro days graded against every prior session on record — cross-market, with the pin-versus-close history attached.",
  },
  {
    variant: "NIGHT_HAWK",
    line: "Every play on the board with its P&L, closed and graded — the losers stay on the page.",
  },
];

/**
 * THE OFFER IS CONSTANT (operator decision, 2026-08-21).
 *
 * Cashtags, the free Discord, the site, Whop and the price go on EVERY post. The earlier design
 * rotated whether a post asked for anything at all, on the reasoning that an account asking for a
 * sale every time stops being one traders open. The operator's call is that the links are how the
 * lead arrives and a post without them is a post that cannot convert — and they are the one who can
 * see the funnel. What rotates instead is the CLAIM, which keeps the rotation measurable.
 */
function offerBlock(cycleKey: string, variant: XIntelCtaVariant): string {
  return [
    `Free Discord — ${tagged(LINKS.discord, cycleKey, variant)}`,
    `The desk — ${tagged(LINKS.site, cycleKey, variant)}`,
    `Full desk ${PRICING.full} · SPX Slayer ${PRICING.spx} · ${PROMO_CODE} takes 50% off month one`,
    tagged(LINKS.whop, cycleKey, variant),
  ].join("\n");
}

/**
 * CASHTAGS.
 *
 * X indexes `$TICKER` and surfaces posts on the symbol's own page, which is the one distribution
 * channel available to a cold account that does not depend on followers. A package about BAC that
 * writes "BAC" is invisible to everyone browsing $BAC.
 *
 * Deduplicated and order-preserving so the lead ticker stays first, and capped — a wall of tickers
 * reads as spam to a reader and as spam to the ranker.
 */
export const CASHTAG_LIMIT = 4;

export function cashtags(tickers: ReadonlyArray<string>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tickers) {
    const sym = t.trim().toUpperCase().replace(/^\$/, "");
    // Index tickers like SPX carry no cashtag on X; a $ in front of a non-symbol is just noise.
    if (!/^[A-Z][A-Z.]{0,5}$/.test(sym) || seen.has(sym)) continue;
    seen.add(sym);
    out.push(`$${sym}`);
    if (out.length >= CASHTAG_LIMIT) break;
  }
  return out.join(" ");
}

/**
 * Pick the next claim: least recently used.
 *
 * PURE and total. `recent` is newest-first, exactly as `recentCtaVariants()` returns it. With no
 * history it returns the head of the canonical order, so a cold start is deterministic rather than
 * arbitrary — a fresh database and a replayed one choose the same thing, which is what makes the
 * rotation reproducible in a test.
 *
 * The earlier version also refused two paid asks in a row. Every post now carries the same offer,
 * so there is no longer any such thing as a paid variant and that guard had nothing left to guard.
 */
export function selectCtaVariant(
  recent: ReadonlyArray<XIntelCtaVariant>,
): XIntelCtaVariant {
  // Rank by how long ago each was last used; never-used sorts first.
  const lastUsedIndex = (v: XIntelCtaVariant): number => {
    const i = recent.indexOf(v);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  return [...X_INTEL_CTA_VARIANTS].sort((a, b) => {
    const d = lastUsedIndex(b) - lastUsedIndex(a);
    if (d !== 0) return d;
    // Stable tie-break on canonical order so two never-used variants resolve deterministically.
    return X_INTEL_CTA_VARIANTS.indexOf(a) - X_INTEL_CTA_VARIANTS.indexOf(b);
  })[0]!;
}

/**
 * MEASURE LENGTH THE WAY X DOES.
 *
 * X replaces every URL with a t.co shortlink and counts it as a fixed 23 characters no matter how
 * long the original is. That matters enormously here: each tagged link runs ~120 raw characters,
 * almost all of it UTM, so a raw `.length` check reported this block at 586 when X sees roughly
 * half that. Budgeting against the raw number would have driven me to strip the very tracking the
 * learning loop is built on, to fix a limit that was never being exceeded.
 */
export const T_CO_LENGTH = 23;

export function xWeightedLength(text: string): number {
  const urls = text.match(/https?:\/\/\S+/g) ?? [];
  const raw = urls.reduce((n, u) => n + u.length, 0);
  return text.length - raw + urls.length * T_CO_LENGTH;
}

/**
 * Budget for the CTA BLOCK, measured X's way.
 *
 * Not 280: the CTA is no longer a standalone reply that has to fit a post on its own, it is the
 * foot of a long-form body. This is a budget for how much of the reader's attention the ask may
 * take from the evidence above it, which is a different question from what the platform allows.
 */
export const CTA_CHAR_LIMIT = 400;

/**
 * Build the CTA reply for one package.
 *
 * Returns the variant alongside the copy so it lands on the queue row — an untracked rotation
 * cannot be measured, and a CTA that cannot be measured cannot be improved.
 */
export function buildCta(
  cycleKey: string,
  recent: ReadonlyArray<XIntelCtaVariant> = [],
): XIntelCta {
  const variant = selectCtaVariant(recent);
  const edge = EDGES.find((e) => e.variant === variant) ?? EDGES[0]!;
  const url = tagged(LINKS.site, cycleKey, variant);
  return {
    variant,
    text: `${edge.line}\n\n${offerBlock(cycleKey, variant)}`,
    url,
    placement: "body",
  };
}

/** Every variant's copy, for the admin page's preview and for tests. */
export function previewAllCtas(cycleKey: string): XIntelCta[] {
  return X_INTEL_CTA_VARIANTS.map((variant) => {
    const edge = EDGES.find((e) => e.variant === variant) ?? EDGES[0]!;
    return {
      variant,
      text: `${edge.line}\n\n${offerBlock(cycleKey, variant)}`,
      url: tagged(LINKS.site, cycleKey, variant),
      placement: "body" as const,
    };
  });
}
