import type { XIntelCta, XIntelCtaVariant } from "@/lib/x-intel/queue-types";
import { X_INTEL_CTA_VARIANTS } from "@/lib/x-intel/queue-types";

/**
 * THE CALL TO ACTION — rotated per package, carried as a SEPARATE field from the post copy.
 *
 * ── WHY THE CTA IS NOT IN THE POST BODY ────────────────────────────────────────────────────────
 *
 * It is a reply, not a footer. Three reasons, in order of how much they cost if ignored:
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

type Builder = (cycleKey: string) => { text: string; url: string | null };

const BUILDERS: Record<XIntelCtaVariant, Builder> = {
  SOFT: () => ({
    text: "More reads like this through the session — @BlackOutTrade, link in bio.",
    url: null,
  }),

  DISCORD: (cycle) => {
    const url = tagged(LINKS.discord, cycle, "DISCORD");
    return {
      text: `We break these down live in the free Discord — ${url}`,
      url,
    };
  },

  SITE: (cycle) => {
    const url = tagged(LINKS.site, cycle, "SITE");
    return {
      text: `Every surface in this post is live on the desk — ${url}`,
      url,
    };
  },

  PRICING: (cycle) => {
    const url = tagged(LINKS.site, cycle, "PRICING");
    return {
      text: `The full BLACKOUT desk is ${PRICING.full}. SPX Slayer alone is ${PRICING.spx}. ${url}`,
      url,
    };
  },

  WHOP_OFFER: (cycle) => {
    const url = tagged(LINKS.whop, cycle, "WHOP_OFFER");
    return {
      text: `${PROMO_CODE} takes 50% off your first month — full desk ${PRICING.full}, SPX ${PRICING.spx}. ${url}`,
      url,
    };
  },
};

/** Variants that ask for money. Never two in a row — see `selectCtaVariant`. */
const PAID_VARIANTS: ReadonlySet<XIntelCtaVariant> = new Set<XIntelCtaVariant>([
  "PRICING",
  "WHOP_OFFER",
]);

/**
 * Pick the next variant: least recently used, never a paid ask immediately after another one.
 *
 * PURE and total. `recent` is newest-first, exactly as `recentCtaVariants()` returns it. With no
 * history it returns the head of the canonical order, so a cold start is deterministic rather than
 * arbitrary — a fresh database and a replayed one choose the same thing, which is what makes the
 * rotation reproducible in a test.
 */
export function selectCtaVariant(
  recent: ReadonlyArray<XIntelCtaVariant>,
): XIntelCtaVariant {
  const lastWasPaid = recent.length > 0 && PAID_VARIANTS.has(recent[0]!);

  // Rank by how long ago each variant was last used; never-used sorts first.
  const lastUsedIndex = (v: XIntelCtaVariant): number => {
    const i = recent.indexOf(v);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };

  const eligible = X_INTEL_CTA_VARIANTS.filter(
    (v) => !(lastWasPaid && PAID_VARIANTS.has(v)),
  );

  // `eligible` can never be empty: SOFT, DISCORD and SITE are all unpaid, so the back-to-back
  // guard can never exclude everything. The fallback is defensive, not reachable.
  const pool = eligible.length ? eligible : X_INTEL_CTA_VARIANTS;

  return [...pool].sort((a, b) => {
    const d = lastUsedIndex(b) - lastUsedIndex(a);
    if (d !== 0) return d;
    // Stable tie-break on canonical order so two never-used variants resolve deterministically.
    return X_INTEL_CTA_VARIANTS.indexOf(a) - X_INTEL_CTA_VARIANTS.indexOf(b);
  })[0]!;
}

/** X's limit applies to the reply too. */
export const CTA_CHAR_LIMIT = 280;

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
  const { text, url } = BUILDERS[variant](cycleKey);
  return { variant, text, url, placement: "reply" };
}

/** Every variant's copy, for the admin page's preview and for tests. */
export function previewAllCtas(cycleKey: string): XIntelCta[] {
  return X_INTEL_CTA_VARIANTS.map((variant) => {
    const { text, url } = BUILDERS[variant](cycleKey);
    return { variant, text, url, placement: "reply" as const };
  });
}
