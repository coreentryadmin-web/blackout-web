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
    metaTitle: "Call Wall & Put Wall Explained: Gamma Levels | BlackOut",
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
    metaTitle: "Gamma Squeeze Explained: The Feedback Loop | BlackOut",
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
  {
    slug: "iron-condor-strategy-guide",
    path: "/learn/iron-condor-strategy-guide",
    metaTitle: "Iron Condor Strategy: The Complete Guide | BlackOut",
    metaDescription: "Learn the iron condor options strategy: the four legs, max profit and loss, and how SPX 0DTE condors use dealer gamma to pick strikes that actually hold.",
    targetKeyword: "iron condor strategy",
    type: "article",
    title: "Iron Condor Strategy: The Complete Guide",
    description: "Learn the iron condor options strategy: the four legs, max profit and loss, and how SPX 0DTE condors use dealer gamma to pick strikes that actually hold.",
    body: `An iron condor is the trade premium sellers reach for when they expect a range, not a breakout. It's four legs, one ticket, a credit collected up front, and a max loss that's capped before you ever place the order — which is exactly why it's become the default structure for 0DTE SPX trading, where most sessions really are a bet on where price *won't* go.

## What an iron condor is

An iron condor combines two credit spreads sold at the same time on the same underlying and expiration: a call spread above the current price and a put spread below it. You collect a net credit for selling both, and you keep the full credit if price settles between your two short strikes at expiration. It's a defined-risk, defined-reward bet that price stays inside a range — not that it goes anywhere.

## The four legs

Every iron condor has four legs. Say SPX is trading at 5,500:

- **Sell a call**, say the 5,550 strike (your short call)
- **Buy a call** further out, say 5,570 (your long call — caps upside risk)
- **Sell a put**, say the 5,450 strike (your short put)
- **Buy a put** further out, say 5,430 (your long put — caps downside risk)

The two short strikes — 5,550 and 5,450 here — define your safe zone. The long strikes are the "wings," and the distance between a short strike and its matching long strike (20 points on each side in this example) is the width. Wider wings mean more premium and more risk per contract; narrower wings mean less of both.

## Max profit and max loss

Max profit is simply the net credit received when you open the trade, and you keep it in full if SPX closes anywhere between 5,450 and 5,550. Max loss is the width of one spread minus the credit collected — take in $3.00 on 20-point wings and your max loss is $17.00 per contract ($1,700), no matter how far price runs past a short strike, because the long leg on that side caps it. That cap is the entire point: you know the worst case before the market opens, not after.

## When to use an iron condor

Condors work best when you expect the session (or the remaining life of the option) to be range-bound, and when implied volatility is elevated relative to what you expect to actually play out — you're a net seller of premium, so rich IV means a bigger credit for the same strikes. See [Implied Volatility Explained](/learn/implied-volatility-explained) for how IV level changes what you collect, and [Options Greeks Explained](/learn/options-greeks-explained) for why theta is working *for* you on every leg you sold. They're a poor fit for a session you expect to trend or break out — that's a job for a directional [0DTE strategy](/learn/0dte-spx-options-strategy) instead.

## How SPX 0DTE condors work

On SPX, condors get opened same-day against the day's expected range: collect the credit early, let theta and range-bound chop erode both spreads toward zero, then close or let it expire. SPX is cash-settled and European-style, so there's no early-assignment risk to babysit — one reason it's the preferred underlying for 0DTE condors over single stocks. The catch is gamma: a short strike that looks 50 points out-of-the-money at 10am can get tested by 1pm if the market actually breaks, because 0DTE gamma accelerates fast as expiration nears.

## Gamma, GEX, and condor strike selection

This is where dealer positioning should actually drive your strikes, not round numbers. Placing your short strikes at or just past the [call wall and put wall](/learn/call-wall-put-wall-explained) gives you a mechanical reason to expect price to struggle past them — those levels concentrate the dealer hedging flow that tends to cap moves. Check the session's [GEX](/learn/what-is-gex) too: strongly positive GEX supports a tight range and favors condors with tighter wings; a market trading near or below the [gamma flip](/learn/gamma-flip-explained) argues for wider wings, smaller size, or skipping the trade. [Max pain](/learn/max-pain-options-explained) is worth a glance as a secondary reference, though the walls and flip are the more mechanically grounded read.

## Put it to work

BlackOut Thermal plots the call wall, put wall, gamma flip, and max pain for SPX in real time, so you can set condor strikes against the same structure the desks use instead of guessing at round numbers — [see Thermal live →](/learn/heat-maps). Pair it with [SPX Slayer](/learn/spx-slayer) for the live 0DTE read on the session. New to the terminology? Start with the [Options Trading Glossary](/learn/options-trading-glossary). [Get access →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "what-is-dark-pool-trading",
    path: "/learn/what-is-dark-pool-trading",
    metaTitle: "What Is Dark Pool Trading? Options Flow | BlackOut",
    metaDescription: "Dark pools are private exchanges where institutions trade off the public tape. Learn how to spot dark pool prints and what they mean for options flow.",
    targetKeyword: "dark pool trading",
    type: "article",
    title: "What Is Dark Pool Trading? How It Affects Options Flow",
    description: "Dark pools are private exchanges where institutions trade off the public tape. Learn how to spot dark pool prints and what they mean for options flow.",
    body: `Roughly 40-50% of U.S. equity volume on any given day never touches a public exchange. It trades in dark pools — private venues where institutions buy and sell size without showing their hand on the lit tape. If you've ever seen a stock quietly absorb massive selling with barely a dent in price, a dark pool is often why. Here's what they are and what they mean for the options flow you actually trade on.

## What a dark pool is

A dark pool is a private trading venue — usually run by a bank or broker-dealer — where buy and sell orders are matched away from public exchanges like the NYSE or Nasdaq. Unlike a lit exchange, there's no visible order book. Trades execute at a price (often the midpoint of the public bid-ask) and only get reported to the tape *after* the fact, with size and timing details that can be delayed or aggregated. You can see that a trade happened; you can't see the order building up beforehand.

## Why dark pools exist

Imagine a pension fund needs to sell 2 million shares of a stock. Routing that order to a lit exchange would show up instantly, other participants would trade ahead of it, and the fund would move the price against itself before the order even fills. Dark pools solve that: they let institutions execute large blocks with minimal market impact, because the order isn't visible until it's already done. That's the entire reason they exist — not a shadowy loophole, but a practical answer to the problem of size.

## How to spot dark pool prints

You won't see a dark pool order book, but you can see the fingerprints:

**Trades printed at the midpoint** — a price sitting exactly between the bid and ask, characteristic of dark pool execution rather than a lit-exchange fill at the bid or ask.

**Size that dwarfs the visible tape** — a single print for 500,000 shares when the average trade size on the lit exchange is a few hundred is a strong tell.

**Price barely moving despite heavy volume** — if a stock absorbs a huge block and doesn't budge, that supply or demand was met off-exchange, not on the public book.

Data providers that break out "dark pool" or "off-exchange" volume specifically, instead of lumping it into total volume, make this far easier to see directly rather than inferring it.

## What dark pool activity means for options flow

Here's the connection most traders miss: a large dark pool print in the stock often *precedes* options activity, not the other way around. An institution building a position off-exchange in the shares will frequently layer in options — calls to add leverage on top of a long build, or puts to hedge a large stock position they just accumulated. A heavy dark pool print followed by unusual call buying in the same name within the same session is a much stronger signal than either one alone. See [How to Read Options Flow](/learn/how-to-read-options-flow) for the questions that separate a real signal from routine hedging, and [Unusual Options Activity](/learn/unusual-options-activity-guide) for how to filter the flow itself.

Dark pool activity also interacts with dealer gamma. A large block trade that shifts a stock's price can push it through a [gamma flip](/learn/gamma-flip-explained) or toward a [call wall or put wall](/learn/call-wall-put-wall-explained) without the move ever showing up as heavy volume on the lit tape — one more reason positioning context matters even when the tape looks quiet. Background: [Dealer Gamma & Options Flow: The Complete Guide](/learn/dealer-gamma-options-flow-guide).

## How BlackOut surfaces it

Thermal's dark pool overlay plots off-exchange block levels directly on the gamma profile, so you can see where institutional size has traded relative to the walls and the flip instead of reconciling a separate data feed yourself — [see Thermal live →](/learn/heat-maps). Pair it with HELIX for the options side: [see HELIX's flow scanner →](/learn/helix-flows). [Get access →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "options-greeks-explained",
    path: "/learn/options-greeks-explained",
    metaTitle: "Options Greeks Explained: Delta, Gamma & Theta | BlackOut",
    metaDescription: "Delta, gamma, theta, and vega explained in plain English — what each Greek measures, how they interact, and why gamma dominates 0DTE trading.",
    targetKeyword: "options greeks explained",
    type: "article",
    title: "Options Greeks Explained: Delta, Gamma, Theta, Vega",
    description: "Delta, gamma, theta, and vega explained in plain English — what each Greek measures, how they interact, and why gamma dominates 0DTE trading.",
    body: `Every option has four numbers attached to it that tell you, before you risk a dollar, exactly how it will behave as the market moves, as time passes, and as volatility shifts. Those numbers are the Greeks. Ignore them and you're pricing options by feel; understand them and you know precisely what you own.

## Delta: your directional exposure

Delta measures how much an option's price changes for a $1 move in the underlying. A call with a 0.40 delta gains roughly $0.40 for every $1 the stock rises; a put with a -0.35 delta gains roughly $0.35 for every $1 the stock falls. Delta also approximates the probability the option finishes in-the-money — a 0.20 delta call is roughly a 20% shot, an 0.80 delta call roughly 80%. Traders use it as a rough stand-in for "how much stock am I effectively long or short": 10 contracts of a 0.30-delta call behave like being long roughly 300 shares.

## Gamma: how fast delta changes

Gamma measures how much delta itself changes for a $1 move in the underlying. A high-gamma option's delta swings quickly — a 0.40-delta call with high gamma might become a 0.60-delta call after a modest rally, gaining exposure fast. Gamma is highest for at-the-money options close to expiration, which is exactly why 0DTE options carry so much of it: an SPX 0DTE contract can go from a 0.20 delta to a 0.70 delta within an hour if price crosses the strike. This is the same gamma that market makers hedge against at scale — aggregated across the whole chain it's what's called [GEX](/learn/what-is-gex). See [What Is Dealer Gamma Exposure?](/learn/what-is-dealer-gamma-exposure) for how that hedging turns into a market-moving force, and [Delta Hedging Explained](/learn/delta-hedging-explained) for the mechanics of how dealers manage it.

## Theta: the cost of time

Theta measures how much value an option loses per day, all else equal. A theta of -0.15 means the option loses about $15 a day (per contract) purely from time passing — no price movement required. Theta accelerates as expiration approaches, and it's brutal on 0DTE: a contract with hours left can lose a meaningful chunk of its value simply because the clock ran, which is exactly why premium sellers (like an [iron condor](/learn/iron-condor-strategy-guide)) want time on their side while buyers are racing against it.

## Vega: sensitivity to volatility

Vega measures how much an option's price changes for a 1-point move in implied volatility. A vega of 0.20 means the option gains about $0.20 in value if IV rises one point, and loses the same if IV falls. Vega matters most for options with more time left — a 0DTE contract has almost none, while a monthly option can move meaningfully on IV alone. See [Implied Volatility Explained](/learn/implied-volatility-explained) for how IV itself behaves, including the crush that guts vega-heavy positions after an earnings print.

## How the Greeks interact

They don't operate in isolation. A long call is simultaneously long delta, long gamma, short theta, and long vega — it profits from a rally, profits *faster* as the rally continues (gamma), bleeds value every day it doesn't move (theta), and gains if IV expands. An iron condor flips most of that: short gamma, long theta, short vega — it wants the market to sit still, time to pass, and IV to hold or fall. Every position is really a bundle of these four exposures, and knowing the bundle tells you exactly what environment the trade needs to work.

## Why gamma dominates 0DTE

On a monthly option, theta and vega often matter more day to day. On a same-day SPX contract, gamma swamps everything else — it's why a 0DTE position can double or get cut in half within an hour on a move that would barely register on a 30-day option. That's also why dealer gamma positioning — the aggregate hedging pressure across the whole chain — matters more for 0DTE than any other single input. See [0DTE SPX Options Strategy](/learn/0dte-spx-options-strategy) for how to structure around it.

## Watching the Greeks live

Reading Greeks off a static chain is a snapshot; reading them as dealer exposure across every strike and expiration is a live picture of where hedging pressure sits. Thermal's DEX and VEX lenses show delta and vega exposure by strike in real time — [see it live →](/learn/heat-maps) — while SPX Slayer folds the gamma read into every graded 0DTE setup: [see SPX Slayer →](/learn/spx-slayer). New to the terms? The [Options Trading Glossary](/learn/options-trading-glossary) has quick definitions. [Get access →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "implied-volatility-explained",
    path: "/learn/implied-volatility-explained",
    metaTitle: "Implied Volatility Explained: A Trader's Guide | BlackOut",
    metaDescription: "What implied volatility is, how IV rank and percentile work, why IV crush happens, and how VIX relates to it — a plain-English guide for options traders.",
    targetKeyword: "implied volatility explained",
    type: "article",
    title: "Implied Volatility Explained: What Every Trader Should Know",
    description: "What implied volatility is, how IV rank and percentile work, why IV crush happens, and how VIX relates to it — a plain-English guide for options traders.",
    body: `Two options on the same stock, same strike, same expiration, can be priced completely differently depending on one number: implied volatility. It's the market's forecast of how much a stock will move, baked directly into the option's price — and understanding it separates traders who know why they're paying what they're paying from traders who are just clicking buy.

## What implied volatility actually is

Implied volatility (IV) is the annualized expected move the options market is pricing in for the underlying, derived by working backward from an option's price through a pricing model. A stock with 20% IV is priced as if it'll move about 20% (annualized, one standard deviation) over the next year; a stock with 80% IV is priced for a much wilder ride. IV isn't a prediction of direction — it says nothing about up or down — only about magnitude. Higher IV means richer option premiums on both calls and puts.

## IV rank and IV percentile

Raw IV numbers are hard to judge in isolation — 40% IV is low for a meme stock and sky-high for a utility. IV rank and IV percentile solve that by putting current IV in the context of its own history. IV rank measures where current IV sits between its 52-week low and high (an IV rank of 80 means IV is near the top of its yearly range). IV percentile measures what percentage of days in the past year had a *lower* IV than today. Both answer the same practical question — is volatility cheap or expensive right now, for this name — which tells you whether you want to be a net buyer or net seller of premium.

## How IV affects pricing

IV is a direct input to every option's price through vega — see [Options Greeks Explained](/learn/options-greeks-explained) for how vega measures that sensitivity. When IV rises, every option on that chain gets more expensive, calls and puts alike, independent of where the stock actually trades. This is why a stock can sit flat and an option can still gain value — IV expanded and repriced it — or why a stock can rally and a call can still lose money if IV collapses hard enough to overwhelm the delta gain.

## IV crush

IV crush is what happens when implied volatility collapses immediately after an event it was pricing in — most commonly earnings. A stock heading into an earnings print might carry 90% IV because the market is pricing a big move; the instant the print hits and uncertainty resolves, IV can fall to 35% within minutes, regardless of which way the stock moved. An option holder can be right on direction and still lose money if the IV crush outweighs the delta gain. This is the single most common way retail traders get burned buying options right before a catalyst.

## IV and VIX

The VIX is essentially the market's aggregate implied volatility reading for the S&P 500 — a 30-day IV computed across the SPX options chain and annualized. When VIX is low (say, 12-14), SPX options are cheap and premium sellers get less credit for the same strikes; when VIX spikes to 25, 30, or higher, every SPX option — including the ones in an [iron condor](/learn/iron-condor-strategy-guide) — gets more expensive, and the whole chain reprices. VIX level is also a rough proxy for the dealer positioning regime: elevated VIX often (though not always) coincides with negative aggregate gamma exposure, the [GEX](/learn/what-is-gex) condition where hedging amplifies moves instead of dampening them — see [Gamma Flip Explained](/learn/gamma-flip-explained) for the specific level where that switch happens.

## How to actually use IV

Before entering any options trade, check IV rank first. High IV rank favors selling premium — condors, credit spreads, covered calls — because you're getting paid more for the same risk. Low IV rank favors buying premium — long calls, long puts, debit spreads — because options are relatively cheap and a move can pay off without fighting a rich price. Skipping this step means you're either overpaying to buy or underselling — a coin flip you don't need to take.

## Watching IV live

Thermal's VEX lens shows vanna exposure — how dealer hedging shifts as IV itself moves — layered on top of the gamma profile, the live version of "what happens to positioning if volatility expands." [See it live →](/learn/heat-maps). Largo can walk you through what a given IV reading actually means for the setup in front of you if you're newer to this: [ask Largo →](/learn/largo-ai). New to the terms? [Options Trading Glossary](/learn/options-trading-glossary). [Get access →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "unusual-options-activity-guide",
    path: "/learn/unusual-options-activity-guide",
    metaTitle: "Unusual Options Activity: Spotting Smart Money | BlackOut",
    metaDescription: "How to spot unusual options activity — volume vs open interest, sweep detection, and the filters that separate real institutional signal from noise.",
    targetKeyword: "unusual options activity",
    type: "article",
    title: "Unusual Options Activity: How to Spot Smart Money",
    description: "How to spot unusual options activity — volume vs open interest, sweep detection, and the filters that separate real institutional signal from noise.",
    body: `"Unusual options activity" gets thrown around constantly, usually attached to a scary chart and a vague promise that "someone knows something." Most of it is noise. The traders who actually use UOA well have a specific, mechanical definition of unusual — and a filter that throws out most of what shows up on the tape before they even look at the rest.

## What unusual options activity actually means

Unusual options activity (UOA) is volume in a specific contract that's meaningfully higher than what that contract, or that name, normally sees. The key word is *relative*. 5,000 contracts trading in an SPX weekly is unremarkable — SPX trades that in minutes on a normal day. 5,000 contracts trading in a thinly-traded biotech's far-OTM calls, when its normal daily options volume is 200, is a real anomaly worth a second look. UOA tools flag contracts where volume spikes relative to their own baseline, not against some universal threshold.

## Volume vs. open interest — the filter that matters most

This is the single most important distinction in reading UOA. **Volume** is how many contracts traded today. **Open interest** is how many contracts are currently outstanding, carried over from prior days. Compare the two:

- **Volume > open interest**: today's activity is creating *new* positions — this is where real signal lives, because fresh money is entering, not existing holders trading among themselves.
- **Volume < open interest**: today's trades are more likely closing, rolling, or churning existing positions — often much less meaningful.

A contract with 8,000 volume against 1,200 open interest is a far stronger signal than one with 8,000 volume against 40,000 open interest, even though the raw volume number looks identical on a screener.

## Sweep detection

A sweep is an order split across multiple exchanges simultaneously to fill fast, usually because the buyer wants size *now* and is willing to pay up across venues rather than wait on one book. Sweeps executed aggressively at the ask (for calls) or the bid (for puts) suggest urgency and conviction — someone wanted in badly enough to accept worse pricing to get filled immediately. A single large order sitting on one exchange, filled passively over time, reads very differently: it could just as easily be a market maker unwinding inventory as a directional bet. Sweep detection is what separates "someone paid up in a hurry" from "a big number happened."

## Separating signal from noise

Before treating any UOA alert as meaningful, run it through the same checklist that applies to reading flow generally: is it opening or closing, is it aggressive or passive, is it hedged against a stock position, and is it actually unusual for that specific name relative to its own history. See [How to Read Options Flow](/learn/how-to-read-options-flow) for the full breakdown of that filter. A lot of "unusual" activity turns out to be routine — a large fund rolling a hedge, a market maker adjusting inventory, or a spread that's net-flat despite one leg looking huge in isolation.

## Where UOA fits with dealer positioning

Unusual flow tells you *who's showing up and how urgently*; dealer gamma tells you *where the levels are that matter*. The strongest setups are where the two agree — aggressive, opening, unusual call buying pushing into a level that's already thin on gamma, like a [call wall](/learn/call-wall-put-wall-explained) close to breaking. Either signal alone is a partial picture; together they're a real edge. Background: [Dealer Gamma & Options Flow: The Complete Guide](/learn/dealer-gamma-options-flow-guide). A related off-exchange signal worth layering in is [dark pool activity](/learn/what-is-dark-pool-trading) — a large block trade in the stock ahead of unusual options flow in the same name is a stronger combined tell than either alone.

## How BlackOut filters it

HELIX applies exactly this filter automatically — premium size thresholds, sweep detection, opening-vs-closing context, and anomaly flags — so you're not manually cross-referencing volume against open interest on every alert that crosses the tape. [See HELIX live →](/learn/helix-flows). New here? [Getting Started with BlackOut](/learn/getting-started) walks through how the scanners fit together. [Get access →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "max-pain-options-explained",
    path: "/learn/max-pain-options-explained",
    metaTitle: "Max Pain in Options: What It Is & How to Use It | BlackOut",
    metaDescription: "Max pain theory explained — how it's calculated, whether it actually predicts price, and how it relates to dealer gamma walls and the pin at expiration.",
    targetKeyword: "max pain options",
    type: "article",
    title: "Max Pain in Options: What It Is and How to Use It",
    description: "Max pain theory explained — how it's calculated, whether it actually predicts price, and how it relates to dealer gamma walls and the pin at expiration.",
    body: `Max pain shows up on every options screener with a confident single number, implying the market is fated to land there by expiration. It's a real, calculable concept — and it's also one of the most overstated tools in retail options trading. Here's what it actually measures, and where it fits next to the gamma levels that do a better job explaining price behavior.

## What max pain is

Max pain is the strike price at which the largest number of options — calls and puts combined, by dollar value — expire worthless, meaning option *buyers* lose the most money and option *sellers* (largely market makers and institutions) lose the least. It's calculated by running through every strike, totaling the intrinsic value all open calls and puts would be worth if the stock settled there, and finding the strike that minimizes the total payout to option holders.

## The theory behind it

The max pain theory argues that because market makers are net short most of the open interest (they sold the options to the public), they have a financial incentive — and, the theory claims, enough size to actually do it — to pin the stock near the max pain strike into expiration, minimizing what they have to pay out. It's an appealing story: a single number that supposedly reveals where "they" want price to land.

## Does it actually work?

Mixed, and less than the hype suggests. Max pain is a *static, backward-looking calculation* — it treats every open contract as equally likely to matter and ignores how dealers are actually positioned right now, including the delta and gamma hedging flows that dominate the real mechanics of price movement into expiration (see [Delta Hedging Explained](/learn/delta-hedging-explained)). It also assumes market makers are both willing and able to coordinate price toward a single strike, which oversimplifies a market with many participants beyond option sellers. Max pain has some pull on quiet, low-volume expirations with little else driving price — but on an active session with real catalysts or heavy directional flow, it's routinely overridden.

## Max pain vs. gamma walls

This is the more useful comparison. The [call wall and put wall](/learn/call-wall-put-wall-explained) are also concentrations of options positioning, but they're derived from *gamma exposure* — the actual hedging flows dealers are mechanically forced into as price moves — rather than a static "who loses the most" calculation. Gamma walls explain *why* price gets sticky at a level (dealers are buying or selling the underlying to stay hedged, in real time). Max pain only explains where the payout math nets out lowest, with no mechanism forcing price there. When max pain and a gamma wall land near the same strike, that's a stronger combined case for a pin. When they diverge, the gamma read is generally the more mechanically grounded one — see [What Is GEX?](/learn/what-is-gex) for the fuller picture of that hedging force.

## Where max pain still adds value

Use it as a secondary reference, not a primary signal. On expiration day specifically, especially with low realized volatility and no scheduled catalysts, max pain can be a reasonable tiebreaker for where a range-bound session settles — useful context for sizing an [iron condor's](/learn/iron-condor-strategy-guide) strikes or deciding whether to hold a position into the close. It's also worth checking relative to the [gamma flip](/learn/gamma-flip-explained): if max pain sits on the same side of the flip as current price, that's mild confirmation; if it sits on the opposite side, the gamma regime is the read to trust.

## Reading it correctly

Don't trade off max pain alone, and don't treat it as a prediction — treat it as one more data point in a stack that includes the gamma walls, the flip level, and actual options flow. Thermal shows max pain directly alongside the call wall, put wall, and gamma flip on the same profile, so you can see at a glance whether they agree or disagree instead of chasing max pain as a standalone number. [See it live →](/learn/heat-maps). [Get access →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "delta-hedging-explained",
    path: "/learn/delta-hedging-explained",
    metaTitle: "Delta Hedging Explained: How Dealers Stay Neutral | BlackOut",
    metaDescription: "How market makers delta hedge to stay neutral, why it forces mechanical buying and selling, and how it connects to dealer gamma exposure and 0DTE moves.",
    targetKeyword: "delta hedging explained",
    type: "article",
    title: "Delta Hedging Explained: How Market Makers Stay Neutral",
    description: "How market makers delta hedge to stay neutral, why it forces mechanical buying and selling, and how it connects to dealer gamma exposure and 0DTE moves.",
    body: `Every option you buy has to be sold by someone — and that someone, almost always a market maker, doesn't want to carry your directional risk. Delta hedging is how they get rid of it. It's a mechanical, constant process, and it's the actual engine behind why options positioning moves the underlying market, not just a side effect of it.

## What delta hedging is

When a market maker sells you a call, they've taken on the opposite exposure: if the stock rallies, that call becomes more valuable and the dealer, as the seller, is now losing on the position. To offset that, they buy shares of the underlying stock. The number of shares they buy is based on the option's delta — see [Options Greeks Explained](/learn/options-greeks-explained) for what delta measures. Sell a call with a 0.40 delta on 100 shares, and the dealer buys roughly 40 shares to neutralize the directional exposure. That's delta hedging: continuously buying or selling the underlying to keep the combined position (options plus stock) as close to directionally flat as possible.

## Why it's continuous, not one-time

Delta isn't fixed — it changes as the stock price moves, which is what gamma measures. As the stock rallies and that 0.40-delta call becomes a 0.55-delta call, the dealer's hedge is now too small, so they have to buy *more* shares to stay neutral. As it falls back, delta drops and they sell some of that hedge back. This is why delta hedging isn't a "set it and forget it" trade — dealers are rebalancing constantly, sometimes hundreds of times a day on a name like SPX, as price ticks and delta shifts underneath them.

## How it moves the market

Here's the mechanism that actually matters for you as a trader: delta hedging isn't optional or discretionary — market makers *have* to do it to manage risk, which means their buying and selling is largely forced, not opinion-driven. When enough dealers are hedging in the same direction at the same time, that forced flow becomes a real, measurable force on price — sometimes cushioning a move, sometimes accelerating it, depending on which way their gamma is positioned. A single dealer rebalancing a small book doesn't move SPX. The aggregate hedging flow across the entire open interest chain absolutely can.

## Long gamma vs. short gamma hedging

Whether delta hedging calms the market or amplifies it depends on the dealer's gamma position. When dealers are net **long gamma**, their hedging works against the move — they sell into rallies and buy into dips, which dampens volatility and helps price pin. When dealers are net **short gamma**, their hedging works with the move — they buy as price rises and sell as it falls, which amplifies volatility and can turn a small move into a fast one. This is the exact distinction covered in [What Is Dealer Gamma Exposure?](/learn/what-is-dealer-gamma-exposure), and it's what separates a grinding, range-bound day from a violent trending one — see [Gamma Flip Explained](/learn/gamma-flip-explained) for the specific price level where dealers switch between the two.

## The extreme version: gamma squeezes

When heavy call buying pushes dealers deep into short gamma on a name, their delta hedging can spiral: buying to hedge pushes the stock up, which increases delta further, which forces more buying. That feedback loop is a [gamma squeeze](/learn/gamma-squeeze-explained) — the mechanical, non-opinion-driven reason a stock can go vertical on no real news. It's delta hedging taken to its most visible extreme.

## Watching it in real time

You can't see individual dealer hedges, but you can see the aggregate effect. Thermal's DEX lens plots delta exposure by strike — the delta-zero pivot and posture that tells you roughly where hedging flow leans — right alongside the gamma profile: [see it live →](/learn/heat-maps). Pair that with SPX Slayer's live gamma read on the session to see how the hedging backdrop is shaping the day's setups: [see SPX Slayer →](/learn/spx-slayer). [Get access →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
];

export function getArticle(slug: string): LearnArticle | undefined {
  return LEARN_ARTICLES.find((a) => a.slug === slug);
}

export function articleNav(slug: string): { prev: LearnArticle | undefined; next: LearnArticle | undefined } {
  const idx = LEARN_ARTICLES.findIndex((a) => a.slug === slug);
  return {
    prev: idx > 0 ? LEARN_ARTICLES[idx - 1] : undefined,
    next: idx >= 0 && idx < LEARN_ARTICLES.length - 1 ? LEARN_ARTICLES[idx + 1] : undefined,
  };
}

export function readingTime(body: string): number {
  const words = body.split(/\s+/).length;
  return Math.max(1, Math.round(words / 230));
}
