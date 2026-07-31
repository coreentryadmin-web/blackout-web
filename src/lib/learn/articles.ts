export type LearnArticle = {
  slug: string;
  path: string;
  metaTitle: string;
  metaDescription: string;
  targetKeyword: string;
  type: "pillar" | "article" | "glossary";
  title: string;
  description: string;
  body: string;
};

export const LEARN_ARTICLES: LearnArticle[] = [
  {
    slug: "dealer-gamma-options-flow-guide",
    path: "/learn/dealer-gamma-options-flow-guide",
    metaTitle: "Dealer Gamma & Options Flow: The Complete Guide | BlackOut",
    metaDescription: "The complete guide to dealer gamma and options flow — how dealer hedging moves SPX, what the gamma flip, call wall, and put wall mean, and how to trade it.",
    targetKeyword: "dealer gamma options flow guide",
    type: "pillar",
    title: "Dealer Gamma & Options Flow: The Complete Guide",
    description: "The complete guide to dealer gamma and options flow — how dealer hedging moves SPX, what the gamma flip, call wall, and put wall mean, and how to trade it.",
    body: `Most traders watch price. The desks watch what sits *underneath* price — dealer positioning. This guide is the map to that hidden layer: what dealer gamma is, why it moves the S&P 500 intraday, and how to read the levels the professionals actually trade around. It also serves as the hub for our deeper guides — each section links to a full breakdown.

## Why dealer positioning moves the market

Every time you buy or sell an option, a market maker takes the other side. To stay neutral, they continuously hedge by buying and selling the underlying as price moves. Multiply that hedging across every open contract in SPX and you get a force large enough to pin the market at some levels and accelerate it through others. Understanding that force is the single biggest edge available to a retail options trader — and it's the foundation everything at BlackOut is built on.

## The core concept: dealer gamma exposure

Gamma exposure measures how much dealers must buy or sell as price moves, and in which direction. When dealers are **long gamma**, they sell rallies and buy dips — dampening volatility and pinning price. When they're **short gamma**, they buy strength and sell weakness — amplifying every move. Knowing which regime you're in tells you whether to fade extremes or ride momentum. → Read the full breakdown: [What Is Dealer Gamma Exposure?](/learn/what-is-dealer-gamma-exposure)

## The levels that matter

Three levels concentrate most of the hedging pressure:

The **gamma flip** is the price where dealers switch from long to short gamma — the line between a calm day and an explosive one. → [Gamma Flip Explained](/learn/gamma-flip-explained)

The **call wall** and **put wall** are large concentrations of gamma that often act as resistance and support. → [Call Wall & Put Wall Explained](/learn/call-wall-put-wall-explained)

Aggregate all of it and you get **GEX** — total gamma exposure across the chain. → [What Is GEX?](/learn/what-is-gex)

## Reading order flow

Positioning tells you *where* the battle lines are; options order flow tells you *who's showing up*. Learning to separate real institutional signal from routine hedging is its own skill. → [How to Read Options Flow](/learn/how-to-read-options-flow)

## Applying it to 0DTE

Zero-days-to-expiration options carry enormous, fast-decaying gamma, which makes intraday dealer positioning more important for 0DTE than for any other timeframe. → [0DTE SPX Options Strategy Guide](/learn/0dte-spx-options-strategy) and [Is 0DTE Gambling?](/learn/is-0dte-gambling)

## Where to go next

New to the terms? Start with the [Options Trading Glossary](/learn/options-trading-glossary). Curious how a sharp move happens? Read [Gamma Squeeze Explained](/learn/gamma-squeeze-explained).

BlackOut maps all of this live — the gamma flip, call wall, and put wall — so you see the day's structure before the bell. [See what the desks see →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options and equities trading involve substantial risk and are not suitable for every investor.*`,
  },
  {
    slug: "what-is-dealer-gamma-exposure",
    path: "/learn/what-is-dealer-gamma-exposure",
    metaTitle: "What Is Dealer Gamma Exposure? A Trader's Guide | BlackOut",
    metaDescription: "Dealer gamma exposure explains why the market pins, accelerates, or reverses at key levels. Learn how to read it — and trade before the crowd moves.",
    targetKeyword: "dealer gamma exposure",
    type: "article",
    title: "What Is Dealer Gamma Exposure? A Trader's Guide to Reading the Market Like the Desks Do",
    description: "Dealer gamma exposure explains why the market pins, accelerates, or reverses at key levels. Learn how to read it — and trade before the crowd moves.",
    body: `Most retail traders watch price. Professional desks watch something underneath price: dealer gamma exposure. It's the hidden force that explains why the S&P 500 grinds quietly toward a level and pins there, or why it suddenly accelerates once it breaks. If you've ever felt like the market "knew" where it was going before you did, gamma is a big part of the answer.

## The core idea in one sentence

When you buy or sell an option, a market maker takes the other side — and to stay neutral, they continuously buy and sell the underlying as price moves. Gamma exposure measures how much they'll have to buy or sell, and in which direction. Multiply that across every open contract and you get a map of where dealers become forced buyers and forced sellers.

## Positive gamma vs. negative gamma

**Positive (long) gamma:** dealers hedge *against* the move — selling into rallies, buying into dips. This dampens volatility. Price tends to pin and mean-revert.

**Negative (short) gamma:** dealers hedge *with* the move — buying as price rises, selling as it falls. This amplifies volatility. Small moves turn into big ones.

Knowing which regime you're in tells you whether to fade extremes or ride momentum — and that single distinction changes how you trade the day.

## Why it matters most for 0DTE

Zero-days-to-expiration options have exploded in volume, and their gamma is enormous and fast-decaying. That makes intraday dealer positioning one of the most important, and most overlooked, inputs for anyone trading SPX on the day. For more, see [0DTE SPX Options Strategy](/learn/0dte-spx-options-strategy).

## The key levels to watch

Dealer gamma concentrates at specific prices: the [gamma flip](/learn/gamma-flip-explained), the [call wall, and the put wall](/learn/call-wall-put-wall-explained). These aren't magic lines — they're where mechanical hedging pressure builds up, which is why price so often reacts to them.

## How BlackOut puts this on your screen

Reading gamma by hand means pulling the full options chain, modeling dealer positioning, and updating it tick by tick. BlackOut Thermal does it for you — a live dealer gamma heatmap across strikes and expirations. Paired with SPX Slayer (our 0DTE desk) and HELIX (institutional flow), you get the positioning picture the desks trade on. [Get access →](/pricing)

New to the terminology? See the [Options Trading Glossary](/learn/options-trading-glossary).

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "gamma-flip-explained",
    path: "/learn/gamma-flip-explained",
    metaTitle: "Gamma Flip Explained: The Line Between Calm and Chaos | BlackOut",
    metaDescription: "The gamma flip is the price where dealers switch from stabilizing the market to amplifying it. Learn to find it and why it defines the character of the day.",
    targetKeyword: "gamma flip explained",
    type: "article",
    title: "Gamma Flip Explained: The Single Most Important Level on the Board",
    description: "The gamma flip is the price where dealers switch from stabilizing the market to amplifying it. Learn to find it and why it defines the character of the day.",
    body: `If you only learn one dealer-positioning concept, make it the gamma flip. It's the price level where the market's behavior fundamentally changes — from calm and mean-reverting to fast and trending. Pros obsess over it because it tells them the *character* of the day before they place a single trade.

## What the gamma flip actually is

The gamma flip is the price at which aggregate dealer gamma crosses from positive to negative. Above it, dealers are typically long gamma and *stabilize* the market. Below it, they flip short gamma and *destabilize* it. (For the underlying mechanics, see [What Is Dealer Gamma Exposure?](/learn/what-is-dealer-gamma-exposure))

## Above the flip: expect chop

When price is above the flip and dealers are long gamma, they sell every rally and buy every dip to stay hedged. That hedging works *against* price movement, so volatility gets crushed. Days like this tend to be quiet, range-bound, and mean-reverting — good for fading extremes, punishing for chasing breakouts.

## Below the flip: expect fireworks

When price falls below the flip, dealers flip short gamma. Now their hedging works *with* the move — they sell as price falls and buy as it rises. Small moves snowball into big ones. This is where the fast, violent selloffs and sharp reversals live. Momentum works; fading gets run over.

## Why it changes how you trade

Same chart, same setup — but on one side of the flip you fade, and on the other you follow. Traders who ignore the flip apply the wrong playbook to the wrong regime and wonder why their strategy "stopped working." It didn't; the environment changed.

## Related levels

The flip works alongside the [call wall and put wall](/learn/call-wall-put-wall-explained), and the whole picture is summarized by [GEX](/learn/what-is-gex). Together they define the day's structure.

## See it live

BlackOut Thermal maps the gamma flip in real time every morning, so you know which regime you're trading before the open. [Get access →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "call-wall-put-wall-explained",
    path: "/learn/call-wall-put-wall-explained",
    metaTitle: "Call Wall & Put Wall Explained: Gamma Support & Resistance | BlackOut",
    metaDescription: "Call walls and put walls are where dealer gamma concentrates — often acting as magnets, resistance, and support. Learn to read them on the SPX chain.",
    targetKeyword: "call wall put wall explained",
    type: "article",
    title: "Call Wall & Put Wall Explained: The Gamma Levels That Act Like Magnets",
    description: "Call walls and put walls are where dealer gamma concentrates — often acting as magnets, resistance, and support. Learn to read them on the SPX chain.",
    body: `Traders draw support and resistance from past price. Dealers have a different kind of level — one built from where options gamma piles up. The two biggest are the call wall and the put wall, and they often behave like magnets and barriers on the SPX chart.

## What a call wall is

The call wall is the strike above current price with the largest concentration of call gamma. Because dealers are hedging all those calls, price often gets *pinned* toward the wall and struggles to break above it — it acts like resistance or a magnet. When a call wall finally breaks, it can trigger a fast move as dealers scramble to re-hedge.

## What a put wall is

The put wall is the mirror image below price — the strike with the largest concentration of put gamma. It frequently acts as support: dealer hedging tends to cushion declines as price approaches it. A decisive break *below* the put wall often signals that support has failed and volatility is about to expand.

## Why these levels work

They aren't superstition. Large gamma concentrations force large hedging flows exactly at those strikes, and that mechanical buying and selling is what creates the "stickiness." It's the same force behind the [gamma flip](/learn/gamma-flip-explained) — just concentrated at specific strikes instead of a single regime line. (Background: [What Is Dealer Gamma Exposure?](/learn/what-is-dealer-gamma-exposure))

## How to use them

Treat the call wall as a likely ceiling and the put wall as a likely floor *while they hold* — and treat breaks of either as momentum signals, not fades. Combine them with the gamma flip to build a full picture: where the day pins, and where it breaks.

## See them live

BlackOut Thermal plots the call wall and put wall across strikes and expirations in real time, so you're trading the same levels the desks are. [Get access →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "what-is-gex",
    path: "/learn/what-is-gex",
    metaTitle: "What Is GEX (Gamma Exposure)? How to Read It | BlackOut",
    metaDescription: "GEX, or gamma exposure, aggregates dealer hedging across the options chain to reveal where the market stabilizes or accelerates. Learn to read GEX.",
    targetKeyword: "what is GEX gamma exposure",
    type: "article",
    title: "What Is GEX (Gamma Exposure)? A Plain-English Guide",
    description: "GEX, or gamma exposure, aggregates dealer hedging across the options chain to reveal where the market stabilizes or accelerates. Learn to read GEX.",
    body: `You'll see "GEX" all over fintwit. It stands for gamma exposure, and it's one of the most useful single numbers an options trader can watch — a summary of where dealers, in aggregate, are forced to buy and sell. Here's what it means and how to read it without a quant degree.

## GEX in one line

GEX aggregates the gamma of every open option on an underlying (like SPX) into a total measure of dealer positioning. Positive GEX means dealers are net long gamma and tend to *stabilize* the market; negative GEX means they're net short gamma and tend to *amplify* moves. (For the mechanics under the hood, start with [What Is Dealer Gamma Exposure?](/learn/what-is-dealer-gamma-exposure))

## Positive GEX: the market self-corrects

In a high positive-GEX environment, dealer hedging leans against price — selling rallies, buying dips. Volatility is suppressed, ranges are tight, and mean-reversion strategies tend to work. Think slow, grinding days.

## Negative GEX: the market self-reinforces

In negative GEX, hedging flows *with* price. Selloffs feed on themselves, rallies can go parabolic, and realized volatility jumps. This is the regime behind most of the scary red days — and the sharp V-shaped reversals. See how a violent version of this unfolds in [Gamma Squeeze Explained](/learn/gamma-squeeze-explained).

## GEX and the flip level

The price where total GEX crosses zero is the [gamma flip](/learn/gamma-flip-explained) — the boundary between the two regimes. Watching where price sits relative to that line is the fastest read on the day's likely behavior.

## How to actually use it

GEX is a *context* tool, not a signal by itself. Use it to decide *how* to trade — fade extremes in positive GEX, respect momentum in negative GEX — and combine it with the [call wall and put wall](/learn/call-wall-put-wall-explained) for specific levels.

BlackOut computes and visualizes all of this live. [See it in action →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "0dte-spx-options-strategy",
    path: "/learn/0dte-spx-options-strategy",
    metaTitle: "0DTE SPX Options Strategy: A Structured Guide | BlackOut",
    metaDescription: "A structured guide to trading 0DTE SPX options — what they are, why dealer gamma matters most here, and how to trade them with an edge instead of gambling.",
    targetKeyword: "0DTE SPX options strategy",
    type: "article",
    title: "0DTE SPX Options Strategy: How to Trade Zero-Days With an Edge",
    description: "A structured guide to trading 0DTE SPX options — what they are, why dealer gamma matters most here, and how to trade them with an edge instead of gambling.",
    body: `0DTE — zero-days-to-expiration — options on SPX have become one of the most traded instruments in the world. They're fast, cheap, and unforgiving. Traded blind, they're a coin flip. Traded with a read on dealer positioning, they're a defined-risk edge. This guide covers the difference.

## What "0DTE" means

A 0DTE option expires the same day you trade it. On SPX there are expirations every trading day, so there's always a same-day contract. Because expiration is hours away, these options have almost no time value and enormous, fast-decaying **gamma** — which is exactly why dealer hedging matters more here than on any other timeframe. (Background: [What Is Dealer Gamma Exposure?](/learn/what-is-dealer-gamma-exposure))

## Why dealer gamma is the whole game intraday

With so much gamma expiring today, dealer hedging flows are massive and concentrated. That's what creates the intraday pins, the sudden accelerations, and the sharp reversals. If you know where the [gamma flip](/learn/gamma-flip-explained), [call wall, and put wall](/learn/call-wall-put-wall-explained) sit, you know where the day is likely to pin and where it's likely to break — before it happens.

## A structured approach (not a coin flip)

1. **Read the regime first.** Are you above the gamma flip (expect chop, fade extremes) or below it (expect momentum, respect trends)? See [GEX](/learn/what-is-gex).
2. **Mark the walls.** Use the call wall as a likely ceiling and the put wall as a likely floor while they hold.
3. **Define risk before you enter.** 0DTE moves fast; know your exit before the trade, not after.
4. **Size for the regime.** Smaller when guessing, larger only when the positioning read and the flow agree.
5. **Wait for confluence.** The best setups are where positioning, flow, and price all line up — which is exactly what a grading system is for.

## Why grading beats guessing

Not every setup is worth taking. BlackOut's engine scans thousands of contracts and grades each setup A–F — only about 3% survive. That filter is the difference between reacting to noise and acting on signal.

## Is this just gambling?

It doesn't have to be. The honest answer is nuanced enough to deserve its own piece: [Is 0DTE Gambling?](/learn/is-0dte-gambling)

BlackOut's SPX Slayer is a 0DTE desk built on exactly this approach — live gamma, graded setups, public logging. [Get access →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "is-0dte-gambling",
    path: "/learn/is-0dte-gambling",
    metaTitle: "Is 0DTE Gambling? The Honest Answer | BlackOut",
    metaDescription: "Is trading 0DTE options gambling? Sometimes yes, sometimes no. Here's the honest difference between gambling on zero-days and trading them with structure.",
    targetKeyword: "is 0DTE gambling",
    type: "article",
    title: "Is 0DTE Gambling? An Honest Answer",
    description: "Is trading 0DTE options gambling? Sometimes yes, sometimes no. Here's the honest difference between gambling on zero-days and trading them with structure.",
    body: `"0DTE is just gambling" is one of the most repeated lines in trading. Like most repeated lines, it's half true. Whether trading zero-days-to-expiration options is gambling depends entirely on *how* you do it. Here's the honest breakdown.

## When 0DTE absolutely is gambling

If you're buying a same-day option because it's cheap, because a ticker is "hot," or because you feel like it's going up — with no read on positioning, no defined risk, and no plan for when you're wrong — that's gambling. The fast decay and leverage will find you out. Most people who lose money on 0DTE are doing exactly this.

## When it isn't

Now flip it. You know where the [gamma flip](/learn/gamma-flip-explained) sits, so you know whether the day favors fading or following. You've marked the [call wall and put wall](/learn/call-wall-put-wall-explained) as your levels. You've defined your risk before entering and sized for the regime. You're trading a setup that passed a filter, not a hunch. That's not gambling — that's trading a defined-risk edge on the same positioning data the desks use. (See [0DTE SPX Options Strategy](/learn/0dte-spx-options-strategy).)

## The real difference: information

A casino bet has a fixed, negative expected value and no information edge. A structured 0DTE trade is the opposite: your job is to only act when the information — dealer positioning plus [options flow](/learn/how-to-read-options-flow) — is on your side, and to stand aside when it isn't. The instrument is the same. The presence or absence of an edge is what separates the two.

## How to move from one to the other

Stop trading every idea. Start reading the regime, marking the levels, defining risk, and demanding confluence before you click. Structure turns a coin flip into a process. That's the entire premise behind BlackOut — live dealer gamma, A–F graded setups, and publicly logged results so there's no hiding from the record. [See what the desks see →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Trading involves substantial risk and is not suitable for every investor. This is a sensitive topic for many — if trading is causing financial or emotional harm, please seek appropriate support.*`,
  },
  {
    slug: "how-to-read-options-flow",
    path: "/learn/how-to-read-options-flow",
    metaTitle: "How to Read Options Flow: Signal vs. Noise | BlackOut",
    metaDescription: "Learn to read institutional options order flow — how to tell a real signal from a routine hedge, and what actually moves markets. A trader's guide.",
    targetKeyword: "how to read options flow",
    type: "article",
    title: "How to Read Options Flow: Telling Signal From Noise",
    description: "Learn to read institutional options order flow — how to tell a real signal from a routine hedge, and what actually moves markets. A trader's guide.",
    body: `Options order flow is one of the most misunderstood tools in trading. A "big print" crossing the tape looks exciting, but most of it is meaningless without context. Learning to separate real institutional signal from routine hedging is what makes flow useful. Here's how.

## What options flow actually is

Options flow is the stream of trades hitting the tape — who's buying and selling which contracts, in what size. The promise is that following the biggest, smartest money gives you an edge. The catch: not every large trade is a directional bet. Much of it is hedging, spreads, or rolls that say nothing about where price is going.

## The questions that separate signal from noise

Before you read anything into a print, ask:

**Opening or closing?** A trade that opens a new position is far more meaningful than one closing an old one.

**At the bid or the ask?** Aggressive buying at the ask (or selling at the bid) suggests conviction; passive fills suggest hedging.

**Is it hedged against stock?** A big call buy paired with a stock sale may be a neutral position, not a bullish bet.

**Is it unusual for that name?** Size only matters relative to a ticker's normal volume — that's what "unusual" flow really means.

Answer those and a "huge bullish print" often turns out to be a hedge. Context is everything. (Background on the positioning side: [What Is Dealer Gamma Exposure?](/learn/what-is-dealer-gamma-exposure))

## Flow + positioning = the full picture

Flow tells you *who's showing up*; dealer positioning tells you *where the levels are*. The strongest setups happen when both agree — aggressive opening flow pushing into a [gamma level](/learn/gamma-flip-explained) that's likely to give way. Either one alone is half a picture.

## How BlackOut handles flow

HELIX tracks institutional options flow with premium filters and anomaly detection, so you see the unusual activity that actually matters instead of drowning in prints. Combined with dealer gamma from Thermal, it's signal over noise. [Get access →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "gamma-squeeze-explained",
    path: "/learn/gamma-squeeze-explained",
    metaTitle: "Gamma Squeeze Explained: How a Feedback Loop Moves Price | BlackOut",
    metaDescription: "A gamma squeeze happens when dealer hedging forces them to chase price higher, feeding a rally. Learn how gamma squeezes form and how to spot the setup.",
    targetKeyword: "gamma squeeze explained",
    type: "article",
    title: "Gamma Squeeze Explained: The Feedback Loop That Sends Price Vertical",
    description: "A gamma squeeze happens when dealer hedging forces them to chase price higher, feeding a rally. Learn how gamma squeezes form and how to spot the setup.",
    body: `You've probably heard "gamma squeeze" blamed for a stock going vertical. It's a real, mechanical phenomenon — not a meme — and understanding it reveals a lot about how dealer hedging can amplify a move. Here's how it works.

## The setup

A gamma squeeze starts with heavy call buying. Dealers who sell those calls are now short gamma, and to stay hedged they must buy the underlying as price rises. That buying pushes price higher — which forces them to buy *even more* to stay hedged. The hedging feeds the move, the move forces more hedging, and a feedback loop forms. (For the underlying mechanics, see [What Is Dealer Gamma Exposure?](/learn/what-is-dealer-gamma-exposure).)

## Why it accelerates

The key is that dealers here are **short gamma** — the negative-gamma regime where hedging flows *with* price instead of against it. In that regime, moves self-reinforce rather than self-correct. It's the violent cousin of a [negative-GEX](/learn/what-is-gex) day. A small catalyst can snowball into a vertical move because every uptick mechanically creates more buying.

## Squeeze vs. short squeeze

A short squeeze is driven by *short sellers* covering. A gamma squeeze is driven by *dealers* hedging options. They often happen together — call buying plus short covering — which is why the biggest melt-ups tend to combine both forces.

## How to spot the conditions

Gamma squeezes need heavy call positioning, a short-gamma dealer regime, and a catalyst. You can see the first two in the positioning data: concentrated call gamma and price below or breaking through the [gamma flip](/learn/gamma-flip-explained). That's the setup; the catalyst provides the spark.

## See the positioning live

BlackOut maps dealer gamma positioning in real time, so you can see when the conditions for an amplified move are building instead of learning about it after the candle. [Get access →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "options-trading-glossary",
    path: "/learn/options-trading-glossary",
    metaTitle: "Options Trading Glossary: Gamma, 0DTE & Flow Terms | BlackOut",
    metaDescription: "A plain-English glossary of options trading terms — dealer gamma, 0DTE, GEX, gamma flip, call wall, put wall, order flow and more, explained simply.",
    targetKeyword: "options trading glossary",
    type: "glossary",
    title: "Options Trading Glossary",
    description: "A plain-English glossary of options trading terms — dealer gamma, 0DTE, GEX, gamma flip, call wall, put wall, order flow and more, explained simply.",
    body: `Plain-English definitions of the terms you'll see across BlackOut and the Learn hub. Each links to a deeper guide where one exists.

**0DTE (Zero Days to Expiration)** — An option that expires the same trading day. Carries large, fast-decaying gamma, making intraday dealer positioning critical. See [0DTE SPX Options Strategy](/learn/0dte-spx-options-strategy).

**Call Wall** — The strike above current price with the largest concentration of call gamma; often acts as resistance or a magnet. See [Call Wall & Put Wall](/learn/call-wall-put-wall-explained).

**Dealer** — A market maker who takes the other side of your options trades and hedges continuously to stay neutral. Their hedging is what moves markets intraday.

**Dealer Gamma Exposure** — A measure of how much dealers must buy or sell as price moves. The foundation of positioning analysis. See [What Is Dealer Gamma Exposure?](/learn/what-is-dealer-gamma-exposure).

**Gamma** — The rate of change of an option's delta as the underlying moves. High gamma means hedging needs change quickly.

**Gamma Flip** — The price where aggregate dealer gamma crosses from positive to negative — the line between a calm, pinning market and a fast, trending one. See [Gamma Flip Explained](/learn/gamma-flip-explained).

**Gamma Squeeze** — A feedback loop where dealer hedging of short-gamma call positions forces them to chase price, amplifying a move. See [Gamma Squeeze Explained](/learn/gamma-squeeze-explained).

**GEX (Gamma Exposure)** — Total dealer gamma aggregated across the options chain; positive stabilizes the market, negative amplifies it. See [What Is GEX?](/learn/what-is-gex).

**Long Gamma** — When dealers hedge against the move (sell rallies, buy dips), dampening volatility and pinning price.

**Options Flow** — The stream of options trades hitting the tape. Useful only with context — opening vs. closing, bid vs. ask, hedged vs. directional. See [How to Read Options Flow](/learn/how-to-read-options-flow).

**Put Wall** — The strike below current price with the largest concentration of put gamma; often acts as support. See [Call Wall & Put Wall](/learn/call-wall-put-wall-explained).

**Short Gamma** — When dealers hedge with the move (buy strength, sell weakness), amplifying volatility. The regime behind fast selloffs and squeezes.

**SPX** — Options on the S&P 500 index, cash-settled and European-style — the primary market for dealer-gamma and 0DTE trading.

Want the full picture? Start with the pillar guide: [Dealer Gamma & Options Flow](/learn/dealer-gamma-options-flow-guide). Or [see it all live →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
];

export function getArticle(slug: string): LearnArticle | undefined {
  return LEARN_ARTICLES.find((a) => a.slug === slug);
}
