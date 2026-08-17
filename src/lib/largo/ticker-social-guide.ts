/**
 * Ticker-scoped social post guide — which products apply, what to capture, how to post.
 */

import type { SocialContentArchetype } from "@/lib/largo/social-content-core";
import { LARGO_PLATFORM_LINKS } from "@/lib/largo/platform-links";
import {
  buildCapturePlaybook,
  platformShowcaseWorkflow,
  type CapturePlaybook,
} from "@/lib/largo/x-post-capture-playbook";
import {
  buildXPostMediaPlan,
  formatMediaPlanForClipboard,
  type XPostMediaAttachment,
} from "@/lib/largo/x-post-media-plan";

export type TickerProductSlot = {
  id: string;
  tool: string;
  deskPath: string;
  why: string;
  /** Include in X carousel (max 4). */
  essential: boolean;
  mustCapture: string[];
};

const MAG7 = new Set(["NVDA", "AAPL", "MSFT", "GOOG", "GOOGL", "AMZN", "META", "TSLA"]);

const TICKER_STOP = new Set([
  "POST",
  "FOR",
  "THE",
  "AND",
  "X",
  "ME",
  "A",
  "AN",
  "DRAFT",
  "TODAY",
  "WINNING",
  "PLAYS",
  "ABOUT",
  "CREATE",
  "WRITE",
  "GENERATE",
  "MAKE",
  "TWEET",
  "SOCIAL",
  "BLACKOUT",
]);

function normalizeTicker(raw?: string | null): string {
  const t = String(raw ?? "SPX").trim().toUpperCase();
  if (t === "SPXW") return "SPX";
  return t || "SPX";
}

function isLikelyTickerSymbol(raw: string): boolean {
  const t = raw.replace(/^\$/, "").toUpperCase();
  if (t.length < 1 || t.length > 5) return false;
  if (!/^[A-Z][A-Z0-9]{0,4}$/.test(t)) return false;
  return !TICKER_STOP.has(t);
}

function isSpx(ticker: string): boolean {
  return ticker === "SPX" || ticker === "SPXW";
}

/** Extract ticker from "generate a post for NVDA" style asks. */
export function extractSocialPostTicker(question: string, fallback?: string | null): string | null {
  const q = String(question ?? "");
  const forTicker = q.match(/\b(?:post|tweet|content)\s+(?:for|about)\s+\$?([A-Z]{2,5})\b/);
  if (forTicker?.[1] && isLikelyTickerSymbol(forTicker[1])) return normalizeTicker(forTicker[1]);

  const generate = q.match(
    /\b(?:generate|write|create|draft|make)\s+(?:me\s+)?(?:a\s+)?(?:an\s+)?(?:x\s+|twitter\s+)?post\s+(?:for|about)\s+\$?([A-Z]{2,5})\b/i,
  );
  if (generate?.[1] && isLikelyTickerSymbol(generate[1])) return normalizeTicker(generate[1]);

  const cashtags = q.match(/\$([A-Z]{1,5})\b/g);
  if (cashtags?.length) {
    for (const raw of cashtags) {
      const t = raw.replace(/^\$/, "");
      if (isLikelyTickerSymbol(t)) return normalizeTicker(t);
    }
  }

  const bare = q.match(/\b([A-Z]{2,5})\b/g);
  if (bare?.length) {
    for (const t of bare) {
      if (isLikelyTickerSymbol(t)) return normalizeTicker(t);
    }
  }

  if (fallback && isLikelyTickerSymbol(fallback)) return normalizeTicker(fallback);
  return null;
}

/** Which desk products apply to this ticker for a social post. */
export function applicableProductsForTicker(
  ticker: string,
  opts?: { earningsSoon?: boolean; onZerodteBoard?: boolean },
): TickerProductSlot[] {
  const s = normalizeTicker(ticker);
  const spx = isSpx(s);
  const slots: TickerProductSlot[] = [
    {
      id: "vector",
      tool: "Vector",
      deskPath: `${LARGO_PLATFORM_LINKS.desks.vector}?ticker=${encodeURIComponent(s)}`,
      why: `${s} 0DTE structure — spot vs gamma walls on the chart`,
      essential: true,
      mustCapture: ["0DTE + 15m selected", "Wall beads on chart", "Spot row + flip line visible"],
    },
    {
      id: "helix",
      tool: "Helix",
      deskPath: LARGO_PLATFORM_LINKS.desks.helix,
      why: `${s} options flow — tape proves who paid up and where`,
      essential: true,
      mustCapture: ["Ticker filter active on every row", "3–8 prints with premium + strike", "0DTE chip if same-day story"],
    },
    {
      id: "thermal",
      tool: "Thermal",
      deskPath: LARGO_PLATFORM_LINKS.desks.thermal,
      why: spx
        ? "SPX dealer gamma matrix — flip, walls, regime"
        : `${s} GEX/VEX matrix — flip line + call/put walls`,
      essential: true,
      mustCapture: ["Ticker chip shows correct symbol", "Spot row in matrix ladder", "At least one wall label + flip"],
    },
    {
      id: "nighthawk",
      tool: "Night Hawk",
      deskPath: LARGO_PLATFORM_LINKS.desks.nighthawk,
      why: `${s} on 0DTE Command board — committed plan or live P&L`,
      essential: Boolean(opts?.onZerodteBoard),
      mustCapture: ["Play card expanded", "Direction + strike + live P&L or graded outcome"],
    },
  ];

  if (spx) {
    slots.push({
      id: "slayer",
      tool: "SPX Slayer",
      deskPath: LARGO_PLATFORM_LINKS.desks.spxSlayer,
      why: "SPX play engine + left GEX rail — confluence grade",
      essential: true,
      mustCapture: ["Play engine phase/grade visible", "SPX matrix rail with spot row"],
    });
  } else {
    slots.push({
      id: "largo",
      tool: "Largo",
      deskPath: LARGO_PLATFORM_LINKS.desks.largo,
      why: `AI desk read for ${s} — verdict + levels in one card`,
      essential: false,
      mustCapture: ["Verdict line visible", "Levels rail if present"],
    });
  }

  if (opts?.earningsSoon || MAG7.has(s)) {
    slots.push({
      id: "meridian",
      tool: "Meridian",
      deskPath: LARGO_PLATFORM_LINKS.desks.meridian,
      why: `${s} catalyst / earnings intel — timing + signal grid`,
      essential: Boolean(opts?.earningsSoon),
      mustCapture: ["Event detail panel open", "Verdict + financials or macro headline", "Flow/thermal signal cards if populated"],
    });
  }

  if (MAG7.has(s) && !spx) {
    slots.push({
      id: "thermal_mag7",
      tool: "Thermal Mag 7 grid",
      deskPath: LARGO_PLATFORM_LINKS.desks.thermal,
      why: "Peer gamma context — where NVDA sits vs mega-cap dealers",
      essential: false,
      mustCapture: ["Grid preset Mag 7 active", "Seven columns loaded", `${s} column readable`],
    });
  }

  return slots;
}

export function buildTickerFullWorkflow(
  ticker: string,
  archetype?: SocialContentArchetype,
  corpus?: string,
): CapturePlaybook[] {
  const s = normalizeTicker(ticker);
  const workflows = platformShowcaseWorkflow(s);
  if (corpus && /\b(earnings|meridian|catalyst)\b/i.test(corpus)) {
    const m = buildCapturePlaybook({ toolId: "meridian", ticker: s, archetype });
    if (m) workflows.unshift(m);
  }
  return workflows;
}

export type TickerSocialGuide = {
  ticker: string;
  products: TickerProductSlot[];
  essentialAttachments: XPostMediaAttachment[];
  optionalAttachments: XPostMediaAttachment[];
  workflowClipboard: string;
};

export function buildTickerSocialGuide(input: {
  ticker: string;
  question?: string | null;
  answer?: string;
  archetype?: SocialContentArchetype;
  onZerodteBoard?: boolean;
  earningsSoon?: boolean;
}): TickerSocialGuide {
  const ticker = normalizeTicker(input.ticker);
  const corpus = `${input.question ?? ""}\n${input.answer ?? ""}`;
  const products = applicableProductsForTicker(ticker, {
    earningsSoon: input.earningsSoon,
    onZerodteBoard: input.onZerodteBoard,
  });

  const allPlaybooks = buildTickerFullWorkflow(ticker, input.archetype, corpus);

  const essential: XPostMediaAttachment[] = [];
  const optional: XPostMediaAttachment[] = [];
  const essentialPlan = buildXPostMediaPlan({
    ticker,
    answer: input.answer ?? "",
    question: input.question,
    archetype: input.archetype,
  });

  for (const att of essentialPlan) {
    essential.push(att);
  }

  let order = essential.length + 1;
  const essentialTools = new Set(essential.map((e) => e.tool));
  for (const pb of allPlaybooks) {
    if (essentialTools.has(pb.tool)) continue;
    optional.push({
      tool: pb.tool,
      label: pb.goal,
      deskPath: pb.deskPath,
      captureHint: pb.steps[pb.steps.length - 1] ?? pb.goal,
      order: order++,
      steps: pb.steps,
      screenshotTarget: pb.screenshotTarget,
      verifyBeforeCapture: pb.verifyBeforeCapture,
      primary: false,
    });
  }

  const workflowClipboard =
    formatMediaPlanForClipboard(essential) +
    (optional.length
      ? `\n\nOptional extras (Instagram carousel / reply thread):\n${formatMediaPlanForClipboard(optional).replace(/^\n+/, "")}`
      : "");

  return {
    ticker,
    products,
    essentialAttachments: essential,
    optionalAttachments: optional,
    workflowClipboard,
  };
}

export function formatHowToPostBlock(): string {
  return `
### How to post on X (@BlackOutTrade)

1. **Copy** — tap **Copy for X** under the answer (tweet + workflow copied).
2. **Screenshots** — capture panels in workflow order; attach **up to 4** on the main tweet.
3. **Compose** — paste copy → attach images → post. Footer: @BlackOutTrade · link in bio.
4. **Extras** — optional 5th+ panels → reply thread or Instagram carousel.
5. **CTA** — pricing link in bio by default; Whop/Discord only when Post **CTA** says so.
6. **Never** auto-post from the desk — you review every number before it goes live.
`.trim();
}

export function formatTickerSocialGuideBlock(guide: TickerSocialGuide): string {
  const productLines = guide.products
    .map(
      (p) =>
        `- **${p.tool}** (${p.essential ? "ESSENTIAL on X" : "optional"}) — ${p.why}\n  URL: ${p.deskPath}\n  Must capture: ${p.mustCapture.join("; ")}`,
    )
    .join("\n");

  return `
## Ticker social guide — ${guide.ticker}

${formatHowToPostBlock()}

### Products for ${guide.ticker} (cite live data from each that applies)
${productLines}

### Prefilled screenshot order (essential = attach on main tweet)
${guide.workflowClipboard}

**Your answer MUST include:** Verdict + Facts (live tools) → ## Post with Copy, Alt hooks, CTA, Screenshot workflow (babysit each essential panel above) → mention optional products when they add proof.
`.trim();
}
