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

Every time you buy or sell an option, a market maker takes the other side. To stay neutral, they continuously hedge by buying and selling the underlying as price moves — a process called **delta hedging** (see [Delta Hedging Explained](/learn/delta-hedging-explained) for the full mechanics). Multiply that hedging across every open contract in SPX and you get a force large enough to pin the market at some levels and accelerate it through others. Understanding that force is the single biggest edge available to a retail options trader — and it's the foundation everything at BlackOut is built on.

Consider a concrete example. SPX is trading at 5,500. There are tens of thousands of open call contracts clustered at the 5,550 strike. Every tick higher forces dealers to buy shares to hedge those calls, and those purchases push SPX higher still. The reverse happens on the way down with puts. That mechanical buying and selling is not opinion — it's math — and it happens on a scale that dwarfs most directional order flow.

## The core concept: dealer gamma exposure

**Gamma exposure** measures how much dealers must buy or sell as price moves, and in which direction. When dealers are **long gamma**, they sell rallies and buy dips — dampening volatility and pinning price. When they're **short gamma**, they buy strength and sell weakness — amplifying every move. Knowing which regime you're in tells you whether to fade extremes or ride momentum. The Greek that drives all of this — gamma — and its relationship to delta, theta, and vega are covered in [Options Greeks Explained](/learn/options-greeks-explained). → Read the full breakdown: [What Is Dealer Gamma Exposure?](/learn/what-is-dealer-gamma-exposure)

## The levels that matter

Three levels concentrate most of the hedging pressure:

The **gamma flip** is the price where dealers switch from long to short gamma — the line between a calm day and an explosive one. → [Gamma Flip Explained](/learn/gamma-flip-explained)

The **call wall** and **put wall** are large concentrations of gamma that often act as resistance and support. → [Call Wall & Put Wall Explained](/learn/call-wall-put-wall-explained)

Aggregate all of it and you get **GEX** — total gamma exposure across the chain. → [What Is GEX?](/learn/what-is-gex)

## Reading order flow

Positioning tells you *where* the battle lines are; options order flow tells you *who's showing up*. Learning to separate real institutional signal from routine hedging is its own skill — and it extends beyond the lit tape into [dark pool activity](/learn/what-is-dark-pool-trading), where institutions trade size off-exchange before layering on options exposure. Spotting [unusual options activity](/learn/unusual-options-activity-guide) on top of that dark pool context is what turns raw flow into actionable signal. → [How to Read Options Flow](/learn/how-to-read-options-flow)

## Applying it to 0DTE

Zero-days-to-expiration options carry enormous, fast-decaying gamma, which makes intraday dealer positioning more important for 0DTE than for any other timeframe. That same gamma concentration is what makes premium-selling structures like the [iron condor](/learn/iron-condor-strategy-guide) viable when the positioning read supports a range. Meanwhile, [implied volatility](/learn/implied-volatility-explained) determines how rich the premiums are on any given session — and whether the trade is worth taking at all. → [0DTE SPX Options Strategy Guide](/learn/0dte-spx-options-strategy) and [Is 0DTE Gambling?](/learn/is-0dte-gambling)

## Where to go next

New to the terms? Start with the [Options Trading Glossary](/learn/options-trading-glossary). Curious how a sharp move happens? Read [Gamma Squeeze Explained](/learn/gamma-squeeze-explained). Want to understand the Greeks underneath all of it? [Options Greeks Explained](/learn/options-greeks-explained) covers delta, gamma, theta, and vega in plain English.

**See it on the tools.** [Thermal](/learn/heat-maps) maps the gamma flip, call wall, put wall, and GEX heatmap live every session. [SPX Slayer](/learn/spx-slayer) is the 0DTE desk — graded setups, live tracking, public record. [HELIX](/learn/helix-flows) scans institutional flow for unusual activity so you see who's showing up. [Night Hawk](/learn/night-hawk) handles swing and overnight setups outside the 0DTE window. And [Largo AI](/learn/largo-ai) can walk you through any of it conversationally if you're just getting started. [Get access →](/pricing)

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
    body: `Most retail traders watch price. Professional desks watch something underneath price: **dealer gamma exposure**. It's the hidden force that explains why the S&P 500 grinds quietly toward a level and pins there, or why it suddenly accelerates once it breaks. If you've ever felt like the market "knew" where it was going before you did, gamma is a big part of the answer.

## The core idea in one sentence

When you buy or sell an option, a market maker takes the other side — and to stay neutral, they continuously buy and sell the underlying as price moves (see [Delta Hedging Explained](/learn/delta-hedging-explained) for the mechanics of that process). Gamma exposure measures how much they'll have to buy or sell, and in which direction. Multiply that across every open contract and you get a map of where dealers become forced buyers and forced sellers.

## Positive gamma vs. negative gamma

**Positive (long) gamma:** dealers hedge *against* the move — selling into rallies, buying into dips. This dampens volatility. Price tends to pin and mean-revert.

**Negative (short) gamma:** dealers hedge *with* the move — buying as price rises, selling as it falls. This amplifies volatility. Small moves turn into big ones.

Knowing which regime you're in tells you whether to fade extremes or ride momentum — and that single distinction changes how you trade the day.

## A concrete example

Imagine SPX is at 5,500 with the **gamma flip** sitting at 5,480. Price is 20 points above the flip, so dealers are net long gamma. Every push toward 5,530 meets mechanical selling as dealers re-hedge their call positions — price stalls, reverses back toward 5,500, and the session grinds sideways. That's positive gamma doing its job: suppressing volatility and creating a range-bound session.

Now the next morning, macro data lands hot and SPX gaps down to 5,460 — below the 5,480 flip. Dealers are now net short gamma. As SPX slides, they must sell to hedge, which pushes price lower, which forces more selling. A 20-point dip becomes a 60-point slide in under an hour. Same market, same ticker — the only thing that changed was the gamma regime. That regime call, above or below the flip, is the single most important read before you put on a trade. → [Gamma Flip Explained](/learn/gamma-flip-explained)

## How to read it in practice

Start each session by checking three things: (1) where the gamma flip sits relative to current price, (2) whether aggregate GEX is positive or negative, and (3) where the call wall and put wall bracket the day's expected range. Together they tell you the character of the session before the first candle prints. Positive GEX with price above the flip? Expect chop — fade extremes, sell premium. Negative GEX with price below the flip? Expect speed — respect momentum, cut losers fast. The regime dictates the playbook.

## Why it matters most for 0DTE

Zero-days-to-expiration options have exploded in volume, and their gamma is enormous and fast-decaying. That makes intraday dealer positioning one of the most important, and most overlooked, inputs for anyone trading SPX on the day. For more, see [0DTE SPX Options Strategy](/learn/0dte-spx-options-strategy).

## The key levels to watch

Dealer gamma concentrates at specific prices: the [gamma flip](/learn/gamma-flip-explained), the [call wall, and the put wall](/learn/call-wall-put-wall-explained). These aren't magic lines — they're where mechanical hedging pressure builds up, which is why price so often reacts to them. The aggregate read is [GEX](/learn/what-is-gex).

## How BlackOut puts this on your screen

Reading gamma by hand means pulling the full options chain, modeling dealer positioning, and updating it tick by tick. BlackOut [Thermal](/learn/heat-maps) does it for you — a live dealer gamma heatmap across strikes and expirations, with the flip, walls, and GEX plotted directly on the profile. Paired with [SPX Slayer](/learn/spx-slayer) (our 0DTE desk) and [HELIX](/learn/helix-flows) (institutional flow scanner), you get the positioning picture the desks trade on. [Get access →](/pricing)

New to the terminology? See the [Options Trading Glossary](/learn/options-trading-glossary).

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "gamma-flip-explained",
    path: "/learn/gamma-flip-explained",
    metaTitle: "Gamma Flip Explained: Calm vs. Chaos | BlackOut",
    metaDescription: "The gamma flip is the price where dealers switch from stabilizing the market to amplifying it. Learn to find it and why it defines the character of the day.",
    targetKeyword: "gamma flip explained",
    type: "article",
    title: "Gamma Flip Explained: The Single Most Important Level on the Board",
    description: "The gamma flip is the price where dealers switch from stabilizing the market to amplifying it. Learn to find it and why it defines the character of the day.",
    body: `If you only learn one dealer-positioning concept, make it the **gamma flip**. It's the price level where the market's behavior fundamentally changes — from calm and mean-reverting to fast and trending. Pros obsess over it because it tells them the *character* of the day before they place a single trade.

## What the gamma flip actually is

The gamma flip is the price at which aggregate dealer gamma crosses from positive to negative. Above it, dealers are typically long gamma and *stabilize* the market. Below it, they flip short gamma and *destabilize* it. (For the underlying mechanics, see [What Is Dealer Gamma Exposure?](/learn/what-is-dealer-gamma-exposure). For how the hedging process works step by step, see [Delta Hedging Explained](/learn/delta-hedging-explained).)

## Above the flip: expect chop

When price is above the flip and dealers are long gamma, they sell every rally and buy every dip to stay hedged. That hedging works *against* price movement, so volatility gets crushed. Days like this tend to be quiet, range-bound, and mean-reverting — good for fading extremes, punishing for chasing breakouts.

## Below the flip: expect fireworks

When price falls below the flip, dealers flip short gamma. Now their hedging works *with* the move — they sell as price falls and buy as it rises. Small moves snowball into big ones. This is where the fast, violent selloffs and sharp reversals live. Momentum works; fading gets run over.

## A concrete example

SPX opens at 5,520. The gamma flip sits at 5,490, and aggregate [GEX](/learn/what-is-gex) is positive. For the first two hours the market bounces between 5,510 and 5,535 — classic long-gamma chop. Dealers sell every push toward the call wall at 5,550 and buy every dip toward 5,510. Range-bound fades work; breakout longs get chopped up.

At 1:15 PM a weak Treasury auction drops SPX through 5,490. Now dealers are short gamma. Selling begets selling: the 30-point dip in positive gamma becomes a 70-point waterfall in 45 minutes. Anyone who faded the break at 5,485 got steamrolled; anyone who recognized the regime change and respected momentum caught the trend of the day.

The only variable that changed was which side of the flip price sat on. The level itself told you the playbook — before the candle printed.

## How to trade around it

**Above the flip (positive gamma):** Fade extremes, sell premium, and expect the session to stay within the [call wall](/learn/call-wall-put-wall-explained) and [put wall](/learn/call-wall-put-wall-explained). Structures like the [iron condor](/learn/iron-condor-strategy-guide) thrive here because price tends to stay in a range. [Implied volatility](/learn/implied-volatility-explained) often drifts lower as the session progresses, so premium sellers benefit from both theta and IV contraction.

**Below the flip (negative gamma):** Respect momentum. Directional trades work; premium-selling is riskier because the range can blow out fast. Size down, widen stops, and wait for the move to exhaust rather than fading the first push through a level.

**Near the flip:** This is the messiest zone — price can oscillate across the line, flipping the regime intraday. Sit on your hands or use smaller positions until the session commits to one side.

## Why it changes how you trade

Same chart, same setup — but on one side of the flip you fade, and on the other you follow. Traders who ignore the flip apply the wrong playbook to the wrong regime and wonder why their strategy "stopped working." It didn't; the environment changed.

## Related levels

The flip works alongside the [call wall and put wall](/learn/call-wall-put-wall-explained), and the whole picture is summarized by [GEX](/learn/what-is-gex). Together they define the day's structure.

## See it live

BlackOut [Thermal](/learn/heat-maps) maps the gamma flip in real time every morning, so you know which regime you're trading before the open. Pair it with [SPX Slayer](/learn/spx-slayer) for graded 0DTE setups that factor in the regime, or ask [Largo AI](/learn/largo-ai) to walk you through the day's flip level if you're still learning. [Get access →](/pricing)

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
    body: `Traders draw support and resistance from past price. Dealers have a different kind of level — one built from where options gamma piles up. The two biggest are the **call wall** and the **put wall**, and they often behave like magnets and barriers on the SPX chart.

## What a call wall is

The call wall is the strike above current price with the largest concentration of call gamma. Because dealers are hedging all those calls, price often gets *pinned* toward the wall and struggles to break above it — it acts like resistance or a magnet. When a call wall finally breaks, it can trigger a fast move as dealers scramble to re-hedge.

## What a put wall is

The put wall is the mirror image below price — the strike with the largest concentration of put gamma. It frequently acts as support: dealer hedging tends to cushion declines as price approaches it. A decisive break *below* the put wall often signals that support has failed and volatility is about to expand.

## A concrete example

SPX opens at 5,500. The call wall sits at 5,550 — a massive cluster of open call interest at that strike — and the put wall sits at 5,430. Between those two levels, the session has a defined range: dealer hedging sells every push toward 5,550 and buys every dip toward 5,430, keeping price bracketed.

At 11 AM, a strong earnings beat from a mega-cap tech name pushes SPX to 5,545. It stalls. Pushes to 5,548, pulls back to 5,540, pushes again — and can't break through. That's the call wall: each tick toward 5,550 triggers more dealer selling as they hedge the gamma concentrated there. By noon the market has given up and settled back to 5,520.

Now consider the opposite. A weak macro print sends SPX sliding toward 5,430. The put wall catches the first test, then the second. But on the third attempt, price closes decisively below 5,425 and doesn't bounce. The hedging cushion is gone — the put wall has broken — and the session accelerates lower. That break is a momentum signal, not a fade.

## Why these levels work

They aren't superstition. Large gamma concentrations force large hedging flows exactly at those strikes, and that mechanical buying and selling is what creates the "stickiness." It's the same force behind the [gamma flip](/learn/gamma-flip-explained) — just concentrated at specific strikes instead of a single regime line. The underlying mechanism is delta hedging at scale: as price approaches a strike loaded with gamma, dealers must buy or sell aggressively to stay neutral (see [Delta Hedging Explained](/learn/delta-hedging-explained) for how that process works tick by tick). Background: [What Is Dealer Gamma Exposure?](/learn/what-is-dealer-gamma-exposure).

## How walls shift during the session

Walls are not static. They move as new options are opened, existing positions are closed, and contracts expire. A call wall at 5,550 in the morning can weaken by the afternoon if large call holders roll or close their positions. Conversely, a surge in put buying can strengthen the put wall or shift it to a different strike entirely.

On 0DTE expirations, the effect is even more pronounced: same-day contracts carry enormous gamma that evaporates by the close, so the walls that define the morning range may not be the ones that matter at 3 PM. Checking the live gamma profile mid-session — not just at the open — is how you catch these shifts before they catch you.

## Walls and max pain

You'll often see [max pain](/learn/max-pain-options-explained) sitting near a wall — that's not a coincidence. Max pain is calculated from the same open interest that builds the walls, so they tend to cluster in the same zone. When max pain, the call wall, and the put wall all converge on a tight range, the case for a pinning session is strong — three independent reads pointing the same direction. When they diverge — say max pain at 5,490 but the call wall at 5,560 and the put wall at 5,420 — the gamma walls are the more mechanically grounded levels to trade against, because they represent actual hedging flow rather than a static payout calculation. Use max pain as a tiebreaker, not a primary level.

## How to use them

Treat the call wall as a likely ceiling and the put wall as a likely floor *while they hold* — and treat breaks of either as momentum signals, not fades. Combine them with the gamma flip to build a full picture: where the day pins, and where it breaks. Walls also inform premium-selling structures: placing [iron condor](/learn/iron-condor-strategy-guide) short strikes at or just past the walls gives a mechanical reason to expect the range to hold.

## See them live

BlackOut [Thermal](/learn/heat-maps) plots the call wall and put wall across strikes and expirations in real time, so you're trading the same levels the desks are — not drawing lines from yesterday's chart. [Get access →](/pricing)

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
    body: `You'll see "GEX" all over fintwit. It stands for **gamma exposure**, and it's one of the most useful single numbers an options trader can watch — a summary of where dealers, in aggregate, are forced to buy and sell. Here's what it means and how to read it without a quant degree.

## GEX in one line

GEX aggregates the gamma of every open option on an underlying (like SPX) into a total measure of dealer positioning. Positive GEX means dealers are net long gamma and tend to *stabilize* the market; negative GEX means they're net short gamma and tend to *amplify* moves. (For the mechanics under the hood, start with [What Is Dealer Gamma Exposure?](/learn/what-is-dealer-gamma-exposure). For what gamma itself measures, see [Options Greeks Explained](/learn/options-greeks-explained).)

## Positive GEX: the market self-corrects

In a high positive-GEX environment, dealer hedging leans against price — selling rallies, buying dips. Volatility is suppressed, ranges are tight, and mean-reversion strategies tend to work. Think slow, grinding days.

## Negative GEX: the market self-reinforces

In negative GEX, hedging flows *with* price. Selloffs feed on themselves, rallies can go parabolic, and realized volatility jumps. This is the regime behind most of the scary red days — and the sharp V-shaped reversals. See how a violent version of this unfolds in [Gamma Squeeze Explained](/learn/gamma-squeeze-explained).

## Reading GEX in practice

Numbers help make this tangible. When aggregate SPX GEX is at +$5 billion, dealers need to sell roughly $5 billion in stock for every 1% up-move and buy the same for every 1% down-move. That's a massive stabilizing force — price has to fight through a wall of mechanical selling to rally, and a wall of mechanical buying to sell off. The result is compression: the session's range tightens, realized vol underperforms implied, and premium-selling structures like the [iron condor](/learn/iron-condor-strategy-guide) have a higher probability of staying in the zone.

When GEX flips to -$3 billion, the picture inverts. Now every 1% decline forces dealers to sell roughly $3 billion more, pushing price further down, which triggers more selling. A small gap down at the open becomes a momentum day. Range-bound assumptions get punished; directional conviction (and tight risk management) gets paid.

The exact dollar value matters less than the sign and relative magnitude. A GEX reading in the top quartile of its recent range screams "chop day." A reading in the bottom quartile warns of trend potential. And crossing zero — the [gamma flip](/learn/gamma-flip-explained) — is the regime change that rewires the playbook entirely.

## GEX and the flip level

The price where total GEX crosses zero is the [gamma flip](/learn/gamma-flip-explained) — the boundary between the two regimes. Watching where price sits relative to that line is the fastest read on the day's likely behavior. The delta hedging that actually generates these flows is covered in [Delta Hedging Explained](/learn/delta-hedging-explained).

## GEX and implied volatility

GEX and [implied volatility](/learn/implied-volatility-explained) are two sides of the same coin. High positive GEX mechanically suppresses realized volatility — dealers are selling rallies and buying dips, compressing the range. When realized vol drops below what IV was pricing in, options are overpriced relative to what's actually happening, and premium sellers benefit from both theta decay and the IV contraction that follows. Conversely, negative GEX amplifies realized vol: moves overshoot, the session's range blows past what IV implied, and option buyers get paid. Checking GEX alongside the VIX (the market's 30-day implied vol for SPX) tells you whether the volatility the market is pricing is likely to understate or overstate what actually plays out — a direct input into whether you want to be a net buyer or seller of premium on any given session.

## How to actually use it

GEX is a *context* tool, not a signal by itself. Use it to decide *how* to trade — fade extremes in positive GEX, respect momentum in negative GEX — and combine it with the [call wall and put wall](/learn/call-wall-put-wall-explained) for specific levels. On a practical level:

- **High positive GEX:** Sell premium, fade range extremes, expect tight ranges. Good days for iron condors and mean-reversion entries.
- **Low or negative GEX:** Respect momentum, widen stops, consider directional entries. Poor days for premium selling; strong days for trend-following.
- **Near-zero GEX:** The messiest regime. Price oscillates across the flip. Reduce size or wait for a commitment.

## See it live

BlackOut [Thermal](/learn/heat-maps) computes and visualizes GEX across strikes and expirations in real time — the gamma profile, the flip, and the walls on one screen. [See it in action →](/pricing)

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

A 0DTE option expires the same day you trade it. On SPX there are expirations every trading day, so there's always a same-day contract. Because expiration is hours away, these options have almost no time value and enormous, fast-decaying **gamma** — which is exactly why dealer hedging matters more here than on any other timeframe. (Background: [What Is Dealer Gamma Exposure?](/learn/what-is-dealer-gamma-exposure). To understand the Greeks driving it, see [Options Greeks Explained](/learn/options-greeks-explained).)

## Why dealer gamma is the whole game intraday

With so much gamma expiring today, dealer hedging flows are massive and concentrated. That's what creates the intraday pins, the sudden accelerations, and the sharp reversals. If you know where the [gamma flip](/learn/gamma-flip-explained), [call wall, and put wall](/learn/call-wall-put-wall-explained) sit, you know where the day is likely to pin and where it's likely to break — before it happens.

## A structured approach (not a coin flip)

1. **Read the regime first.** Are you above the gamma flip (expect chop, fade extremes) or below it (expect momentum, respect trends)? See [GEX](/learn/what-is-gex).
2. **Mark the walls.** Use the call wall as a likely ceiling and the put wall as a likely floor while they hold.
3. **Define risk before you enter.** 0DTE moves fast; know your exit before the trade, not after.
4. **Size for the regime.** Smaller when guessing, larger only when the positioning read and the flow agree.
5. **Wait for confluence.** The best setups are where positioning, flow, and price all line up — which is exactly what a grading system is for.

## Entry timing matters

Not all hours are equal. The first 30 minutes after the open carry the widest spreads, the most noise, and the most fakeouts — gamma is at its absolute peak, and a move that looks decisive at 9:35 AM often reverses by 10:00. The window from roughly 10:00 AM to 11:30 AM ET is where the session typically commits to its character: the regime becomes clear, flow settles, and the levels that held the first test are more likely to hold the second. Late-day entries (after 2:00 PM) carry a different edge: theta decay accelerates toward zero and any remaining gamma becomes binary — you're either right immediately or you're out. [Implied volatility](/learn/implied-volatility-explained) also has an intraday pattern — it tends to be highest at the open and compresses as the session progresses, which matters for how much premium you're paying or collecting at any given hour. Many professional 0DTE traders skip the first 30 minutes entirely and limit their entries to a 3-hour window where the signal-to-noise ratio is highest.

## Regime-based sizing

Size is where most 0DTE traders blow up. A simple framework: in a strongly positive GEX session where price is well above the gamma flip, you can size up slightly because the range is compressed and the probability of a violent move against you is lower. In a negative GEX session below the flip, cut size by half or more — realized vol can be 2–3x what it is in positive gamma, and a normal loss becomes an outsized one if you're carrying the same risk. Near the flip, where the regime can switch intraday, minimum size protects you from getting whipsawed.

The same logic applies to structure choice. Positive gamma sessions favor premium-selling structures like the [iron condor](/learn/iron-condor-strategy-guide) — you're collecting credit in an environment that naturally suppresses the range. Negative gamma sessions favor directional plays where momentum can pay off, and where condors get their short strikes tested.

## Why grading beats guessing

Not every setup is worth taking. BlackOut's engine scans thousands of contracts and grades each setup A–F — only about 3% survive. That filter is the difference between reacting to noise and acting on signal.

## Is this just gambling?

It doesn't have to be. The honest answer is nuanced enough to deserve its own piece: [Is 0DTE Gambling?](/learn/is-0dte-gambling)

## See the 0DTE desk

BlackOut's [SPX Slayer](/learn/spx-slayer) is a 0DTE desk built on exactly this approach — live gamma, graded setups, public logging. For setups that carry overnight, [Night Hawk](/learn/night-hawk) handles the swing side. New to the platform? [Getting Started](/learn/getting-started) walks you through how the tools fit together. [Get access →](/pricing)

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

## The numbers: what realistic edge looks like

Honest expectations help separate structured trading from fantasy. A well-filtered 0DTE system does not win 80% of the time on directional plays — anyone claiming that is either selling something or cherry-picking. Realistic win rates on graded, directional 0DTE setups tend to land in the 45–55% range, which sounds underwhelming until you look at the payoff structure. Because gamma is so large on same-day contracts, a winning trade often returns 80–150% on the premium risked, while a losing trade is capped at the premium paid (on long options) or the defined spread width minus the credit (on spreads).

What matters is **expected value**: a 50% win rate with a 2:1 average winner-to-loser ratio is a strong positive-EV system, even though it loses half its trades. A 70% win rate with winners that are a third the size of losers is negative EV despite looking "good." The filter — only taking graded setups where positioning and flow agree — is what keeps the ratio honest. Most sessions produce zero qualifying entries. That's the point: standing aside when the read isn't clear is the single biggest contributor to long-term positive EV.

## How to move from one to the other

Stop trading every idea. Start reading the regime, marking the levels, defining risk, and demanding confluence before you click. Structure turns a coin flip into a process. A few concrete starting points:

1. **Learn the levels.** Before your first trade of the day, check the gamma flip, call wall, and put wall. If you can't name them, you don't have a read — don't trade.
2. **Define risk in dollars, not feelings.** Before clicking, know exactly how much you'll lose if you're wrong. On a long 0DTE option, that's the premium. On a spread, it's the spread width minus the credit.
3. **Demand a filter.** Only take setups that pass a checklist — positioning, flow, regime. If any input is missing or conflicting, stand aside. Most days, standing aside *is* the trade.
4. **Track the record.** Log every entry, every exit, every reason. A trading process without a record is a narrative, not a system.

That's the entire premise behind BlackOut — live dealer gamma, A–F graded setups, and publicly logged results so there's no hiding from the record. [SPX Slayer](/learn/spx-slayer) is the 0DTE desk built on this approach; [Getting Started](/learn/getting-started) walks through how to set up and use the tools from day one. [See what the desks see →](/pricing)

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

**Is it unusual for that name?** Size only matters relative to a ticker's normal volume — that's what "unusual" flow really means. For a full breakdown of how to filter unusual activity systematically, see [Unusual Options Activity Guide](/learn/unusual-options-activity-guide).

Answer those and a "huge bullish print" often turns out to be a hedge. Context is everything. (Background on the positioning side: [What Is Dealer Gamma Exposure?](/learn/what-is-dealer-gamma-exposure))

## Sweep detection: urgency on the tape

A **sweep** is an order split across multiple exchanges simultaneously to fill fast. The buyer wants size *now* and is willing to pay up across venues rather than wait on one book. Sweeps at the ask for calls (or at the bid for puts) signal urgency and conviction — someone paid a premium to get filled immediately. Contrast that with a single large passive fill on one exchange, which could be a market maker unwinding inventory or a fund rolling an existing position. When you see a sweep in a contract whose volume already dwarfs its open interest, that's a strong combined tell: new, urgent, aggressive positioning. That's the kind of flow worth acting on.

## The dark pool layer

Not all institutional activity shows up on the lit options tape. Roughly 40–50% of U.S. equity volume trades in **dark pools** — private venues where institutions buy and sell size without showing their hand. A large dark pool print in the stock often *precedes* the options activity, not the other way around: the institution builds a position off-exchange first, then layers on calls or puts for leverage or hedging. A heavy dark pool block followed by unusual call buying in the same name within the same session is a much stronger signal than either one alone. See [What Is Dark Pool Trading?](/learn/what-is-dark-pool-trading) for how to read those prints.

## Unusual activity vs. routine flow

The hardest part of reading flow is deciding what counts as unusual. SPX prints millions of contracts a day; a "large" trade on SPX is routine. The same-size print in a mid-cap name with a fraction of the normal options volume is genuinely unusual. The distinction is always *relative* — volume compared to that name's own baseline, not a universal dollar threshold. The most reliable filter: compare today's volume on a specific contract to its open interest. When volume on a single strike exceeds its open interest, those are new positions being created, not existing ones churning. That's where real institutional signal lives. Pair that with sweep detection and bid/ask aggression, and you've filtered out the vast majority of noise before you even look at direction. See [Unusual Options Activity Guide](/learn/unusual-options-activity-guide) for the full breakdown of this filter.

## Flow + positioning = the full picture

Flow tells you *who's showing up*; dealer positioning tells you *where the levels are*. The strongest setups happen when both agree — aggressive opening flow pushing into a [gamma level](/learn/gamma-flip-explained) that's likely to give way. Either one alone is half a picture.

For example: you see a sweep of 5,000 SPX 5,550 calls at the ask, opening new positions. You check Thermal and see the call wall sits at 5,550 with price at 5,530. That level is about to absorb heavy buying *and* heavy dealer hedging simultaneously — the flow and the positioning are converging on the same strike. That's a setup worth watching closely for a breakout or a rejection, depending on how the wall responds.

## How BlackOut handles flow

[HELIX](/learn/helix-flows) tracks institutional options flow with premium filters, sweep detection, and anomaly flags, so you see the [unusual activity](/learn/unusual-options-activity-guide) that actually matters instead of drowning in prints. Combined with dealer gamma from [Thermal](/learn/heat-maps), it's signal over noise — flow and positioning on one screen. [Get access →](/pricing)

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

A **gamma squeeze** starts with heavy call buying. Dealers who sell those calls are now short gamma, and to stay hedged they must buy the underlying as price rises — this is the delta hedging process (see [Delta Hedging Explained](/learn/delta-hedging-explained) for the step-by-step mechanics). That buying pushes price higher — which forces them to buy *even more* to stay hedged. The hedging feeds the move, the move forces more hedging, and a feedback loop forms. (For the underlying positioning concept, see [What Is Dealer Gamma Exposure?](/learn/what-is-dealer-gamma-exposure).)

## Why it accelerates

The key is that dealers here are **short gamma** — the negative-gamma regime where hedging flows *with* price instead of against it. In that regime, moves self-reinforce rather than self-correct. It's the violent cousin of a [negative-GEX](/learn/what-is-gex) day. A small catalyst can snowball into a vertical move because every uptick mechanically creates more buying. The Greek driving the feedback is gamma itself — as delta increases with each uptick, the hedging demand grows nonlinearly (see [Options Greeks Explained](/learn/options-greeks-explained) for how gamma relates to delta).

## What delta hedging has to do with it

A gamma squeeze is really just [delta hedging](/learn/delta-hedging-explained) taken to its extreme. Under normal conditions, a dealer who sold calls delta hedges by buying a modest number of shares and rebalancing gradually as price moves. That's routine and orderly. A gamma squeeze turns it violent: call buying is so concentrated, and the resulting short gamma so deep, that the *rate* at which dealers need to buy shares to stay hedged overwhelms the available liquidity. Each purchase pushes price higher; each tick higher increases delta on the remaining short calls; each delta increase demands more buying. The hedging mechanic that normally stabilizes a market becomes the engine of a runaway move because the scale of the short gamma position is too large for the underlying's liquidity to absorb quietly. Understanding that the squeeze is a hedging phenomenon — not a sentiment phenomenon — is what tells you when the move is likely to exhaust: once the calls go deep in-the-money and delta approaches 1.0, the incremental hedging demand disappears, and the mechanical fuel burns off.

## Squeeze vs. short squeeze

A short squeeze is driven by *short sellers* covering. A gamma squeeze is driven by *dealers* hedging options. They often happen together — call buying plus short covering — which is why the biggest melt-ups tend to combine both forces. The gamma squeeze is the mechanical amplifier; the short squeeze is the directional fuel.

## Real-world examples

**GameStop, January 2021.** The most famous gamma squeeze in recent history. Retail traders on Reddit piled into GME calls, which forced dealers — now massively short gamma — to buy shares as the stock rallied. That mechanical buying pushed GME higher, which triggered more call buying, which forced more hedging. The stock rose from roughly $20 to nearly $500 in two weeks. Short sellers covering their positions (a classic short squeeze) ran alongside the gamma squeeze, creating a double feedback loop that overwhelmed the entire market structure.

**Broader market squeezes.** Gamma squeezes don't require a meme stock. They happen in SPX itself when heavy call positioning meets a catalyst. A strong jobs number or a Fed surprise can push the index through a level where call gamma is concentrated — say, past the call wall at 5,550 — and the mechanical hedging from dealers who sold those calls pushes SPX further than the news alone would justify. The move often exhausts abruptly once the gamma burns off (the calls go deep in-the-money and delta approaches 1.0, so incremental buying stops), leaving a spike-and-fade pattern on the chart. Recognizing when a move is being amplified by gamma — versus driven by genuine reassessment of value — tells you when to ride and when to expect the reversal.

## How to spot the conditions

Gamma squeezes need three ingredients: heavy call positioning, a short-gamma dealer regime, and a catalyst. You can see the first two in the positioning data: concentrated call gamma (a large call wall) and price below or breaking through the [gamma flip](/learn/gamma-flip-explained). When those conditions are present and a catalyst arrives — earnings, macro data, a short-squeeze trigger — the feedback loop has fuel. Without the positioning setup, the same catalyst produces a normal move, not a squeeze. That distinction is the entire value of reading positioning before trading the headline.

## See the positioning live

BlackOut [Thermal](/learn/heat-maps) maps dealer gamma positioning in real time, so you can see when the conditions for an amplified move are building instead of learning about it after the candle. [Get access →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "options-trading-glossary",
    path: "/learn/options-trading-glossary",
    metaTitle: "Options Trading Glossary: Key Terms | BlackOut",
    metaDescription: "A plain-English glossary of options trading terms — dealer gamma, 0DTE, GEX, gamma flip, call wall, put wall, order flow and more, explained simply.",
    targetKeyword: "options trading glossary",
    type: "glossary",
    title: "Options Trading Glossary",
    description: "A plain-English glossary of options trading terms — dealer gamma, 0DTE, GEX, gamma flip, call wall, put wall, order flow and more, explained simply.",
    body: `Plain-English definitions of the terms you'll see across BlackOut and the Learn hub. Each links to a deeper guide where one exists.

**0DTE (Zero Days to Expiration)** — An option that expires the same trading day. Carries large, fast-decaying gamma, making intraday dealer positioning critical. See [0DTE SPX Options Strategy](/learn/0dte-spx-options-strategy).

**Call Wall** — The strike above current price with the largest concentration of call gamma; often acts as resistance or a magnet. See [Call Wall & Put Wall](/learn/call-wall-put-wall-explained).

**Dark Pool** — A private trading venue where institutions buy and sell size away from the public exchange, with trades reported only after the fact. Roughly 40–50% of U.S. equity volume trades through dark pools. See [What Is Dark Pool Trading?](/learn/what-is-dark-pool-trading).

**Dealer** — A market maker who takes the other side of your options trades and hedges continuously to stay neutral. Their hedging is what moves markets intraday.

**Dealer Gamma Exposure** — A measure of how much dealers must buy or sell as price moves. The foundation of positioning analysis. See [What Is Dealer Gamma Exposure?](/learn/what-is-dealer-gamma-exposure).

**Delta** — How much an option's price changes for a $1 move in the underlying. Also approximates the probability of finishing in-the-money. See [Options Greeks Explained](/learn/options-greeks-explained).

**Delta Hedging** — The continuous process by which market makers buy and sell the underlying to stay directionally neutral as delta shifts. The mechanical engine behind why positioning moves the market. See [Delta Hedging Explained](/learn/delta-hedging-explained).

**Gamma** — The rate of change of an option's delta as the underlying moves. High gamma means hedging needs change quickly. See [Options Greeks Explained](/learn/options-greeks-explained).

**Gamma Flip** — The price where aggregate dealer gamma crosses from positive to negative — the line between a calm, pinning market and a fast, trending one. See [Gamma Flip Explained](/learn/gamma-flip-explained).

**Gamma Squeeze** — A feedback loop where dealer hedging of short-gamma call positions forces them to chase price, amplifying a move. See [Gamma Squeeze Explained](/learn/gamma-squeeze-explained).

**GEX (Gamma Exposure)** — Total dealer gamma aggregated across the options chain; positive stabilizes the market, negative amplifies it. See [What Is GEX?](/learn/what-is-gex).

**Implied Volatility (IV)** — The market's forecast of how much an underlying will move, priced into the option. Higher IV means richer premiums on both calls and puts. IV rank and IV percentile put current IV in the context of its own history. See [Implied Volatility Explained](/learn/implied-volatility-explained).

**Iron Condor** — A four-leg options strategy that collects a credit by selling a call spread above price and a put spread below, profiting when the underlying stays within a range. See [Iron Condor Strategy Guide](/learn/iron-condor-strategy-guide).

**Long Gamma** — When dealers hedge against the move (sell rallies, buy dips), dampening volatility and pinning price.

**Max Pain** — The strike price at which the most options expire worthless and option sellers pay out the least. A secondary reference, not a primary signal — gamma walls tend to be more mechanically grounded. See [Max Pain in Options](/learn/max-pain-options-explained).

**Options Flow** — The stream of options trades hitting the tape. Useful only with context — opening vs. closing, bid vs. ask, hedged vs. directional. See [How to Read Options Flow](/learn/how-to-read-options-flow).

**Put Wall** — The strike below current price with the largest concentration of put gamma; often acts as support. See [Call Wall & Put Wall](/learn/call-wall-put-wall-explained).

**Short Gamma** — When dealers hedge with the move (buy strength, sell weakness), amplifying volatility. The regime behind fast selloffs and squeezes.

**SPX** — Options on the S&P 500 index, cash-settled and European-style — the primary market for dealer-gamma and 0DTE trading.

**Theta** — The amount of value an option loses per day from time decay alone. Accelerates as expiration approaches and is especially punishing on 0DTE contracts. See [Options Greeks Explained](/learn/options-greeks-explained).

**Unusual Options Activity (UOA)** — Volume in a specific contract that's meaningfully higher than its baseline. The real filter is whether volume exceeds open interest (new positions) and whether it's aggressive (sweeps at the ask). See [Unusual Options Activity Guide](/learn/unusual-options-activity-guide).

**Vega** — How much an option's price changes for a 1-point move in implied volatility. Matters most on longer-dated options; nearly zero on 0DTE. See [Options Greeks Explained](/learn/options-greeks-explained).

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
  {
    slug: "spx-slayer-dashboard-guide",
    path: "/learn/spx-slayer-dashboard-guide",
    metaTitle: "SPX Slayer Dashboard Walkthrough | BlackOut",
    metaDescription:
      "Walk through every panel and value on the SPX Slayer dashboard — the three-column layout, hero price, GEX regime, VWAP tint, and freshness indicators.",
    targetKeyword: "SPX Slayer dashboard guide",
    type: "article" as const,
    title: "SPX Slayer Dashboard: A Complete Walkthrough",
    description:
      "Walk through every panel and value on the SPX Slayer dashboard — the three-column layout, hero price, GEX regime, VWAP tint, and freshness indicators.",
    body: `The [SPX Slayer](/learn/spx-slayer) dashboard is a three-column 0DTE command center. Every number, pill, and color on screen exists because it feeds a trading decision — nothing decorative makes the cut. This walkthrough explains what each element means so you can read the board cold.

## The three-column layout

**Left column — GEX/VEX matrix.** This is the dealer-positioning panel. It shows a strike-by-expiry grid of signed gamma (or vanna) exposure, color-coded from deep red (heavy put gamma) to deep green (heavy call gamma). You toggle between GEX and VEX lenses here. Key levels — the [gamma flip](/learn/gamma-flip-explained), [call wall, and put wall](/learn/call-wall-put-wall-explained) — are highlighted so you can see the day's structure at a glance. For a deeper dive into reading the matrix itself, see [Reading the SPX Slayer GEX Matrix](/learn/spx-slayer-gex-matrix-guide).

**Center column — play engine.** This is where the graded setups live. Each play card shows the ticker, direction, strike, expiry, confluence grade (A+ through D), score, confidence percentage, and current action state (SCANNING, WATCHING, BUY, HOLD, TRIM, SELL). The center column is the decision layer — positioning data from the left feeds into the grading engine, and the output is a filtered, ranked list of plays worth watching. See [SPX Slayer Play Grades Explained](/learn/spx-slayer-play-grades-explained) for how the grading works.

**Right column — Largo commentary.** [Largo AI](/learn/largo-ai) provides a running narrative of the session — regime reads, level commentary, and context for why the engine is or isn't firing. Think of it as a senior trader sitting next to you explaining the board. During RTH it updates as conditions change; outside market hours it summarizes the prior session.

## The hero bar

Across the top of the dashboard sits the hero bar — the five-second read on where SPX stands right now.

**Hero SPX price.** The large number front and center. It updates in near-real-time via SSE and shows the last traded price for SPX.

**VIX pill.** A small badge next to price showing the current VIX level. VIX is the market's 30-day [implied volatility](/learn/implied-volatility-explained) read for SPX — a quick proxy for how expensive options are and, loosely, whether dealers are likely positioned in a positive or negative [gamma regime](/learn/what-is-gex). A VIX under 15 usually means calm; above 25 means volatility is elevated and premiums are rich.

**VWAP pill.** Shows SPX's volume-weighted average price for the session. The pill tints **green (bull)** when price is trading above VWAP — buyers are in control on a volume-weighted basis — and **red (bear)** when price is below. VWAP is a widely watched institutional reference; its tint gives you the intraday posture without opening a chart.

**Net GEX.** The aggregate [gamma exposure](/learn/what-is-gex) number for the SPX chain. Positive means dealers are long gamma (expect range compression); negative means short gamma (expect amplification). This single number sets the session's baseline character.

## Technical levels strip

Below the hero bar, a strip of reference levels gives you the day's structural map:

- **EMA 20 / 50 / 200** — exponential moving averages on SPX. The stack order (20 above 50 above 200, or inverted) tells you whether the short-term, intermediate, and long-term trends agree or conflict.
- **SMA 50 / 200** — simple moving averages. When the SMA 50 crosses above the SMA 200 (a "golden cross") or below it (a "death cross"), the event shows up here as a reference.
- **HOD / PDH** — today's high of day and the prior day's high. Price breaking above PDH is a momentum tell; failing at it is resistance.
- **LOD / PDL** — today's low of day and the prior day's low. A break below PDL signals continuation weakness; holding it suggests support.

These levels are inputs into the play engine's confluence scoring. You don't need to memorize them — the grading system weighs them for you — but seeing them lets you understand *why* a grade came out the way it did.

## FreshnessChip and market status

Data freshness matters on a 0DTE desk. The **FreshnessChip** in the header shows one of three states:

- **Live** (green) — data is current and streaming. The board is tradeable.
- **Stale** (amber) — data hasn't updated within the expected window. This can happen during brief connectivity interruptions or low-activity pre-market periods. Treat the board with caution.
- **Offline** (red) — the data feed is disconnected. Do not trade off a stale board.

Next to the chip, the **market status** indicator shows whether regular trading hours are active, whether the market is in pre-market or after-hours, or whether it is closed for the day.

## Regime indicator

A badge showing the current [gamma regime](/learn/gamma-flip-explained) — positive or negative — so you know in one glance whether the session favors fading or following. This is derived from the net GEX sign and the position of price relative to the gamma flip.

## Trading halt banners

If SPX or a major component triggers a trading halt (a market-wide circuit breaker or a single-stock LULD halt on a name the engine is tracking), a red banner appears across the top of the dashboard. Halts mean the order book is frozen — no fills, no hedging, no reliable pricing. The banner stays until the halt lifts. During a halt, the play engine pauses grading and the FreshnessChip switches to stale, because the last quote is no longer actionable.

## Putting it together

The dashboard is designed to be read top-down: hero bar for the five-second pulse, technical strip for context, left column for positioning, center for actionable plays, right for narrative. Before you look at any individual play, glance at the regime indicator and net GEX — they tell you whether it's a day to sell premium or respect momentum, and that single read shapes everything else on the screen. For the full story on how plays get graded, see [SPX Slayer Play Grades Explained](/learn/spx-slayer-play-grades-explained). New to BlackOut? [Getting Started](/learn/getting-started) walks through the platform end to end. [Get access →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "spx-slayer-play-grades-explained",
    path: "/learn/spx-slayer-play-grades-explained",
    metaTitle: "SPX Slayer Play Grades: A+ Through D | BlackOut",
    metaDescription:
      "How SPX Slayer's confluence grading works — score, confidence, gate logic from GEX regime through BlackOut Intelligence, and what each grade means for sizing.",
    targetKeyword: "SPX Slayer play grades",
    type: "article" as const,
    title: "SPX Slayer Play Grades: A+ Through D Explained",
    description:
      "How SPX Slayer's confluence grading works — score, confidence, gate logic from GEX regime through BlackOut Intelligence, and what each grade means for sizing.",
    body: `Every play on the [SPX Slayer](/learn/spx-slayer) dashboard carries a **confluence grade** — a letter from A+ down to D — plus a numeric score (0-100) and a confidence percentage (0-100%). The grade is the engine's verdict on how many independent signals agree that this setup is worth taking. Here is how the grading pipeline works, gate by gate.

## What confluence means here

Confluence is the overlap of independent inputs pointing in the same direction. A single bullish signal is a hypothesis; five bullish signals that each come from a different data source — positioning, flow, technicals, volatility regime, risk-reward — are confluence. The grading engine counts how many of those independent inputs agree, weighs them by reliability, and outputs a score. The more gates a play clears, the higher the grade.

## The sequential gate logic

The engine evaluates each candidate play through a series of gates in order. A play must pass each gate to reach the next. If it fails at any stage, it either gets downgraded or rejected entirely. The gates run in this sequence:

**Gate 1 — GEX regime.** Is the session's [gamma exposure](/learn/what-is-gex) environment compatible with this trade's direction and structure? A directional long in a strongly positive-GEX, range-bound session gets penalized; the same long in a negative-GEX trending session gets a boost. This gate doesn't kill a play outright, but it sets the ceiling — a play fighting the regime can never grade above B.

**Gate 2 — VWAP posture.** Where is price relative to the session's volume-weighted average price? A bullish play with price above VWAP gets a tailwind; below VWAP it is swimming upstream. The VWAP pill on the [dashboard](/learn/spx-slayer-dashboard-guide) shows this in real time.

**Gate 3 — EMA stack alignment.** The engine checks whether the 20, 50, and 200 EMAs are stacked in the direction of the trade. A bullish call with 20 > 50 > 200 (a fully aligned uptrend stack) earns full marks. A mixed or inverted stack means the trend structure disagrees with the trade's direction — that costs points.

**Gate 4 — Flow bias.** Is institutional [options flow](/learn/how-to-read-options-flow) leaning in the same direction? The engine reads the net premium bias from [HELIX](/learn/helix-flows) — whether call-side or put-side premium dominates the session — and checks whether that lean supports the play. Aggressive sweeps in the same direction add conviction; flow running the opposite way is a red flag.

**Gate 5 — Risk-to-reward.** The engine calculates the R:R on the specific contract — how much the option can gain to target versus how much is at risk to stop. Plays with thin R:R (less than 1:1) get penalized regardless of how many other gates they cleared. A favorable R:R alone won't produce a high grade, but an unfavorable one will cap the grade.

**Gate 6 — BlackOut Intelligence verdict.** The final filter. [Largo AI](/learn/largo-ai) and the broader BlackOut Intelligence layer assess the full context — macro calendar, earnings proximity, regime stability, any conflicting signals the mechanical gates cannot weigh. This gate can veto an otherwise-passing play if the qualitative context is wrong, or give a final boost to a play where every quantitative gate aligned.

**Gate 7 — Option ticket.** The engine selects the specific contract (strike, expiry) and confirms that liquidity, spread width, and premium are acceptable. A great setup on an illiquid contract with a wide bid-ask gets downgraded or skipped.

## The grades

**A+ (score 90-100, confidence 85-100%).** Every gate cleared with strength. Regime, flow, technicals, R:R, and Intelligence all agree. These are rare — most sessions produce zero or one. Size with conviction when they appear.

**A (score 75-89, confidence 70-84%).** Strong confluence with one minor disagreement — perhaps the EMA stack is mixed while everything else aligns. Still a high-conviction setup; full standard sizing.

**B (score 55-74, confidence 50-69%).** Solid but not unanimous. Typically two gates are neutral or mildly conflicting. Playable, but size down — this is a half-position grade.

**C (score 35-54, confidence 30-49%).** Marginal. Several gates disagree or are neutral. Only experienced traders should consider these, and only at minimum size. The engine surfaces them for transparency, not as recommendations.

**D (score 0-34, confidence 0-29%).** Failing. The setup lacks meaningful confluence. The engine logs it but does not suggest action. If you find yourself wanting to trade a D-grade play, step back — you are overriding the filter, not using it.

## Play actions: the lifecycle

Each play moves through a lifecycle of action states:

- **SCANNING** — the engine is evaluating the candidate. No action for you yet.
- **WATCHING** — the play passed initial gates but hasn't hit entry criteria. Watch the level.
- **BUY** — entry criteria are met. The play is at its graded price with the graded R:R.
- **HOLD** — the position is open and within the expected range. No action needed.
- **TRIM** — the play has hit a partial target. Consider taking partial profits.
- **SELL** — the play has hit its full target or stop. Exit.

The action state updates in real time as price moves. A play can cycle from BUY back to WATCHING if price pulls away from the entry zone before you act — it does not chase.

## How to use grades for sizing

The simplest framework: A+ and A get your standard position size. B gets half. C gets quarter size or skip. D is a no-trade. This isn't a rule — it's a starting point you calibrate to your own risk tolerance. The grade tells you how much agreement exists among independent signals; your size should reflect that agreement. Fewer signals agreeing means less conviction, which means less capital at risk.

Pair the grade with the [GEX regime](/learn/what-is-dealer-gamma-exposure) and the dashboard's net GEX reading for the full picture. A B-grade play in a strongly supportive regime is different from a B-grade play in a hostile one — the regime sets the ceiling, and the grade tells you where within that ceiling the play sits. For the full dashboard context, see [SPX Slayer Dashboard Walkthrough](/learn/spx-slayer-dashboard-guide). New to BlackOut? Start with [Getting Started](/learn/getting-started). [Get access →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "spx-slayer-gex-matrix-guide",
    path: "/learn/spx-slayer-gex-matrix-guide",
    metaTitle: "Reading the SPX Slayer GEX Matrix | BlackOut",
    metaDescription:
      "How to read the SPX Slayer GEX matrix — strike-by-expiry gamma grid, King nodes, gamma walls, GEX vs VEX toggle, and gamma flip for the 0DTE column.",
    targetKeyword: "GEX matrix heatmap",
    type: "article" as const,
    title: "Reading the SPX Slayer GEX Matrix",
    description:
      "How to read the SPX Slayer GEX matrix — strike-by-expiry gamma grid, King nodes, gamma walls, GEX vs VEX toggle, and gamma flip for the 0DTE column.",
    body: `The GEX matrix on [SPX Slayer](/learn/spx-slayer) is a strike-by-expiry grid that maps where dealer [gamma exposure](/learn/what-is-gex) concentrates across the entire SPX options chain. It is the positioning backbone of the dashboard — every graded play factors in where the walls sit and which regime price is trading in. Here is how to read it cell by cell.

## The grid: strikes x expirations

The matrix is a heatmap table. Each row is a strike price. Each column is an expiration date — the leftmost column is the 0DTE (same-day) expiry, and subsequent columns move out to weeklies and monthlies. Each cell contains a **signed dollar value** representing the net gamma exposure at that specific strike-expiry intersection.

Positive cells (green) mean dealers are net long gamma at that strike — hedging will dampen moves toward it. Negative cells (red) mean dealers are net short gamma — hedging will amplify moves through it. The **diverging color scale** runs from deep red (largest negative) through neutral (near-zero, gray) to deep green (largest positive), so the visual heat pattern tells the story before you read a single number.

## The spot row highlight

The row corresponding to the current SPX price is highlighted — usually with a distinct border or background tint. This anchors your eye to where price sits relative to the gamma landscape. Everything above the spot row is overhead resistance context; everything below is downside support context. As SPX moves, the highlight follows.

## King nodes

Certain cells carry a **star marker** — these are **King nodes**, the single largest absolute gamma concentration in their respective column (expiry). A King node at the 5,550 strike in the 0DTE column means that strike carries more gamma for today's expiry than any other. King nodes are where the most aggressive dealer hedging will occur for that expiry. They often coincide with — but are not always identical to — the call wall or put wall, because the wall is the largest concentration across all expirations, while a King node is the largest within a single expiry.

## Column max +/- (gamma walls)

At the top or bottom of each column, the matrix marks the **column maximum positive** and **column maximum negative** values. These are that expiry's local gamma walls — the strike where the most call-side or put-side gamma sits for that specific expiration. When you aggregate these across all columns, you get the overall [call wall and put wall](/learn/call-wall-put-wall-explained) for the full chain. Watching the column-level walls lets you see whether a particular expiry (say, this Friday's monthly) is driving the aggregate wall, or whether the wall is spread across many expirations.

## GEX vs VEX lens toggle

A toggle at the top of the matrix switches between two views:

**GEX lens** — the default. Shows [gamma exposure](/learn/what-is-dealer-gamma-exposure) per cell. This is the primary positioning read: where dealers must buy and sell as price moves, and how aggressively. Use this for regime reads, wall identification, and flip-level awareness.

**VEX lens** — shows **vanna exposure** per cell. Vanna measures how dealer delta changes as [implied volatility](/learn/implied-volatility-explained) shifts. VEX tells you what happens to the positioning picture if the VIX spikes or drops — a critical second layer on days when IV is moving sharply. For more on what the VEX lens reveals, see [Thermal's Four Lenses](/learn/thermal-four-lenses-explained). The toggle is the same concept used on [Thermal](/learn/heat-maps), applied here to the SPX-specific matrix.

## Gamma flip and the 0DTE column

The [gamma flip](/learn/gamma-flip-explained) — the strike where aggregate dealer gamma crosses from positive to negative — is marked directly on the matrix, typically as a horizontal line or a color-change boundary. For the 0DTE column specifically, the flip is especially important because same-day gamma is enormous and fast-decaying. The 0DTE column's flip level can differ from the full-chain flip when longer-dated expirations carry gamma at different strikes. On days when the 0DTE flip diverges from the overall flip, price behavior can be choppy as the two signals conflict.

The **net exposure** summary at the bottom of the 0DTE column shows aggregate gamma for all same-day contracts — positive or negative, with a magnitude. This is the quick-glance answer to "is today's session stabilized or amplified by 0DTE positioning?"

## Convergence and divergence between walls and price

The matrix's real power is pattern recognition. When the call wall, put wall, and flip converge on a narrow range around current price, expect a grinding, range-bound session — all three forces are acting as magnets and barriers in a tight zone. When they diverge — flip far below price, call wall far above, put wall far below — the range is wide open, and price has room to trend before hitting a mechanical barrier.

Watch for **wall migration** during the session. If the call wall at 5,550 weakens (its cell value shrinks) while a new gamma cluster builds at 5,570, the ceiling is shifting higher. The matrix updates in real time, so checking it mid-session — not just at the open — is how you catch repositioning before the chart shows it.

## Cross-referencing with the play engine

The graded plays in the center column of the [dashboard](/learn/spx-slayer-dashboard-guide) already incorporate the matrix data — the [gate logic](/learn/spx-slayer-play-grades-explained) reads the regime, walls, and flip from this same grid. But seeing the raw matrix lets you understand *why* a play graded the way it did. A B-grade play near a thick wall makes sense — the wall adds resistance that lowers conviction. An A-grade play in open space between walls makes sense too — nothing mechanical is blocking the move.

For the full Thermal heatmap with profile view and additional overlays, see [How to Read Thermal Heatmaps](/learn/thermal-heatmap-reading-guide). [Get access →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "spx-slayer-lotto-power-hour",
    path: "/learn/spx-slayer-lotto-power-hour",
    metaTitle: "SPX Slayer Lotto & Power Hour Plays | BlackOut",
    metaDescription:
      "How SPX Slayer's Lotto and Power Hour engines work — strike selection, timing windows, premium caps, and what separates them from the main play engine.",
    targetKeyword: "0DTE lotto plays power hour",
    type: "article" as const,
    title: "SPX Slayer Lotto & Power Hour Plays",
    description:
      "How SPX Slayer's Lotto and Power Hour engines work — strike selection, timing windows, premium caps, and what separates them from the main play engine.",
    body: `The main [SPX Slayer](/learn/spx-slayer) play engine runs throughout regular trading hours, looking for high-confluence 0DTE setups at standard strikes and premium levels. Alongside it, two specialized engines target the edges of the session where gamma dynamics are most extreme: the **Lotto Play** engine in the morning and the **Power Hour** engine near the close. Each has its own timing window, strike logic, and risk rules — they are not looser versions of the main engine, but separate systems designed for different market conditions.

## Lotto Play engine (7:00 - 10:30 AM ET)

The Lotto engine fires during the first hours of the session, when [gamma](/learn/what-is-gex) is at its peak on 0DTE contracts and intraday moves can be oversized relative to the rest of the day.

**Strike selection.** Lotto plays target strikes roughly **25 points out of the money** from the current SPX price. That distance is deliberate — close enough that a strong directional move brings the contract into play, far enough that the premium is cheap and the R:R is asymmetric. These are not at-the-money setups; they are defined-risk lottery tickets on the thesis that the morning session will produce a directional push.

**Target and stop.** Each Lotto play carries a **25-point target** and an **8-point stop**. The target-to-stop ratio (~3:1) reflects the asymmetric bet: you expect to lose more often than you win, but the wins are large enough to make the expected value positive over a sample. This is a classic skew trade — frequent small losses, occasional large gains.

**Premium cap.** The engine enforces a **VIX-indexed premium cap** — the maximum you should pay for the contract adjusts based on the current VIX level. When VIX is elevated and premiums are rich, the cap rises to reflect that the same OTM strike costs more. When VIX is low, the cap tightens. This prevents overpaying in a calm market where the asymmetric payoff disappears once premium gets too expensive. See [Implied Volatility Explained](/learn/implied-volatility-explained) for why VIX level directly drives option prices.

**Why the morning window.** Between 7:00 and 10:30 AM ET, 0DTE gamma is at its session maximum — the contracts still have most of the day's theta left, and delta can swing dramatically on even modest price moves. By 10:30, much of that initial gamma has decayed and the session's character has typically committed — the Lotto edge (asymmetric gamma on cheap OTM strikes) weakens, so the engine shuts off.

## Power Hour engine (2:45 - 3:15 PM ET)

The Power Hour engine fires in the final 30 minutes before the close becomes imminent. By this point in the session, 0DTE contracts have almost no time value left — [theta](/learn/options-greeks-explained) has eaten most of the premium — and any remaining gamma is binary: a move either happens now or it does not.

**Strike selection.** Power Hour targets strikes roughly **8 points out of the money** — much closer than Lotto. With so little time left, a 25-point OTM strike is essentially worthless, so the engine moves in closer where delta can still respond to a late-session push.

**Target and stop.** The target is **13 points** with a **4-point stop** (~3:1 ratio, similar risk profile to Lotto but scaled to the tighter range of a session winding down).

**Premium and quality caps.** The maximum premium is **$0.50** — because there's almost no time value remaining, paying more than $0.50 for a near-OTM 0DTE contract at 2:45 PM means you are overpaying for what is essentially a binary outcome. Additionally, the engine requires a **minimum score of 45** and a **minimum grade of B** — Power Hour plays must still pass the [confluence filter](/learn/spx-slayer-play-grades-explained), just at a lower bar than the main engine, reflecting the reduced data available so late in the session.

**One play max.** The engine limits output to a single Power Hour play per session. This is a discipline rule: with 15-30 minutes of life remaining and binary outcomes, one well-selected play is a strategy; three is gambling.

**Why the narrow window.** The 2:45 - 3:15 PM ET window captures the point where intraday gamma is at its most extreme decay rate. Contracts expiring in under an hour can double or go to zero on a single SPX tick. By 3:15 the window closes — too little time remains for even an 8-point move to develop with any consistency.

## How they differ from the main play engine

The main play engine looks for the highest-confluence setups the session offers, at standard OTM distances, with no fixed timing window during RTH. Lotto and Power Hour are edge-of-session specialists:

- **Lotto** exploits morning gamma amplitude with wider strikes and larger targets — a low-probability, high-payoff structure.
- **Power Hour** exploits end-of-day gamma decay with tight strikes and cheap premium — a binary bet on a late directional push.
- **Main engine** operates in the core session where positioning data is richest and the [gate logic](/learn/spx-slayer-play-grades-explained) has the most inputs to weigh.

All three share the same underlying positioning data from the [GEX matrix](/learn/spx-slayer-gex-matrix-guide) and [Thermal](/learn/heat-maps), and all three log results to the same public record. The difference is *when* they fire, *what* strikes they target, and *how* they define risk — each tuned to the gamma environment of its specific window. See the full [SPX Slayer Dashboard Walkthrough](/learn/spx-slayer-dashboard-guide) for how they appear on screen. [Get access →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "thermal-heatmap-reading-guide",
    path: "/learn/thermal-heatmap-reading-guide",
    metaTitle: "How to Read Thermal Heatmaps | BlackOut",
    metaDescription:
      "How to read BlackOut Thermal heatmaps — matrix view, exposure profile, King nodes, flip and wall levels, HELIX flow overlay, dark pool lines, and alerts.",
    targetKeyword: "dealer gamma heatmap guide",
    type: "article" as const,
    title: "How to Read BlackOut Thermal Heatmaps",
    description:
      "How to read BlackOut Thermal heatmaps — matrix view, exposure profile, King nodes, flip and wall levels, HELIX flow overlay, dark pool lines, and alerts.",
    body: `[Thermal](/learn/heat-maps) is BlackOut's dealer-positioning visualization — a live heatmap that shows where [gamma exposure](/learn/what-is-gex) (and vanna, delta, and charm) concentrates across the options chain. It has two primary views, a set of overlay layers, and a key-level summary box. Here is how to read each component.

## Matrix view

The matrix is a **strike-by-expiry heat table**. Each row is a strike price; each column is an expiration date. Each cell contains the signed dollar exposure at that intersection — positive (green) where dealers are long gamma and hedging dampens the move, negative (red) where dealers are short gamma and hedging amplifies it. The **diverging color scale** runs from deep red through gray (near zero) to deep green, so the visual pattern reveals the positioning landscape before you read a single number.

The **spot row** — the row closest to the current underlying price — is highlighted with a distinct border. Everything above spot is overhead resistance context (where call-side gamma builds); everything below is downside support context (where put-side gamma lives). The default ticker is **SPY**, but you can switch to any supported name.

## Profile view

The profile view collapses the matrix into a single-axis chart — exposure by strike, summed across all selected expirations. This is where the shape of dealer positioning becomes visually obvious.

**ExposureProfile bars.** Horizontal bars extending left (negative, red) or right (positive, green) from a zero axis. The length of each bar is the net exposure at that strike. Three markers anchor the profile:

- **Spot marker** — a vertical line at the current price, so you see where the underlying sits relative to the gamma landscape.
- **Flip marker** — the price where the bars cross from positive to negative, the [gamma flip](/learn/gamma-flip-explained). Above it, expect range compression; below it, expect amplification.
- **King marker** — the strike with the single largest absolute gamma concentration. It often — but not always — coincides with the [call wall or put wall](/learn/call-wall-put-wall-explained). When the King node sits at the call wall, that level carries extra weight as a ceiling.

**HELIX flow overlay.** Aggregated [institutional options flow](/learn/how-to-read-options-flow) from [HELIX](/learn/helix-flows) can be layered directly onto the profile. Flow activity appears as markers or shading at the strikes where large prints hit, so you can see in one view whether aggressive flow is pushing into a gamma wall (likely rejection) or into thin positioning (likely follow-through). For a full walkthrough of the flow scanner itself, see [HELIX Flow Scanner Guide](/learn/helix-flow-scanner-guide).

**Dark pool lines.** [Dark pool](/learn/what-is-dark-pool-trading) block prints are plotted as horizontal reference lines on the profile at the prices where off-exchange size traded. These lines show where institutions have quietly accumulated or distributed — levels that may act as support or resistance independent of options positioning. When a dark pool line sits at the same price as a gamma wall, the reinforcement is significant.

**CumulativeCurve.** A running sum of exposure from the lowest strike to the highest, plotted as a curve over the profile. The curve's slope tells you where exposure is building fastest, and the point where it crosses zero corresponds to the gamma flip. A steeply rising curve means positive gamma is accumulating rapidly — strong stabilization above that zone.

**ShiftView.** A comparison overlay showing how the exposure profile has *changed* since the prior snapshot (open, prior close, or a user-selected reference). Green shading means exposure increased (walls strengthened or shifted toward a strike); red shading means exposure decreased (walls weakened). ShiftView is how you catch wall migration mid-session without remembering what the morning profile looked like.

## ExpiryScope chips

A row of toggle chips at the top of the profile lets you filter which expirations feed the profile:

- **All** — every open expiry, giving the full-chain picture.
- **0DTE** — same-day contracts only. This isolates the intraday gamma that matters most for 0DTE trades. See [0DTE SPX Options Strategy](/learn/0dte-spx-options-strategy).
- **Near** — the next few expirations (typically 0-3 DTE). Useful for seeing the short-term positioning without the noise of far-out monthlies.
- **Monthly** — monthly expirations only, which tend to carry the most open interest and define the structural walls.

Switching scopes lets you answer questions like "is the call wall driven by 0DTE gamma or by the monthly?" — a distinction that matters because 0DTE walls evaporate by the close while monthly walls persist.

## KeyLevelBox

A summary panel showing the critical levels extracted from the active lens and scope:

- **Flip** — the [gamma flip](/learn/gamma-flip-explained) price.
- **Walls** — the [call wall and put wall](/learn/call-wall-put-wall-explained) strikes and their magnitudes.
- **Max pain** — the [max pain](/learn/max-pain-options-explained) strike for the selected expiry scope.
- **King node** — the single largest gamma concentration.
- **Net total** — the aggregate signed exposure (positive = long gamma environment, negative = short gamma).
- **Day-over-day deltas** — how each of these levels has shifted since the prior session's close. A call wall that moved up 20 points overnight tells a different story than one that sat still.

## AlertsStrip

A banner of real-time alerts that fires when key events occur:

- **Wall breaks** — price has moved through a call wall or put wall. A wall break is a momentum signal, not a fade (see [Call Wall & Put Wall Explained](/learn/call-wall-put-wall-explained)).
- **Flip crosses** — price has crossed the gamma flip, switching the session's regime from positive to negative gamma or vice versa. This is the single most important intraday event on the Thermal board.

Alerts are timestamped and persist for the session so you can scroll back to see what levels were tested and when.

## Putting it all together

Start with the KeyLevelBox for the five-second read: flip, walls, net exposure, and whether any levels shifted overnight. Then check the profile to see the shape — is gamma concentrated or spread out? Is the King node reinforcing a wall or sitting at a different strike? Layer on HELIX flow and dark pool lines to see where activity is converging with positioning. Use ExpiryScope to isolate 0DTE vs. monthly contributions. And watch the AlertsStrip for real-time wall breaks and flip crosses that change the playbook mid-session.

For a deep dive into the four exposure lenses (GEX, VEX, DEX, CHARM), see [Thermal's Four Lenses Explained](/learn/thermal-four-lenses-explained). For how to turn Thermal levels into actual strike selection, see [Using Thermal for Strike Selection](/learn/thermal-strike-selection-guide). [Get access →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "thermal-four-lenses-explained",
    path: "/learn/thermal-four-lenses-explained",
    metaTitle: "Thermal's Four Lenses: GEX VEX DEX CHARM | BlackOut",
    metaDescription:
      "Thermal's four exposure lenses — GEX for gamma walls, VEX for vanna, DEX for delta posture, CHARM for time-decay pinning — and when to use each one.",
    targetKeyword: "GEX VEX DEX CHARM explained",
    type: "article" as const,
    title: "Thermal's Four Lenses: GEX, VEX, DEX & CHARM",
    description:
      "Thermal's four exposure lenses — GEX for gamma walls, VEX for vanna, DEX for delta posture, CHARM for time-decay pinning — and when to use each one.",
    body: `[Thermal](/learn/heat-maps) computes dealer exposure from a single options-chain payload — one data pull covers all four views. A client-side toggle switches between four **lenses**, each showing a different Greek's exposure profile across strikes. Same data, four angles. Here is what each lens reveals and when to use it.

## GEX lens — gamma exposure

The default and most widely used lens. GEX maps where dealer [gamma](/learn/what-is-gex) concentrates across strikes, showing the mechanical buying and selling pressure dealers must exert as price moves.

**What it shows you:**

- **Gamma flip** — the price where aggregate gamma crosses from positive to negative, the boundary between a range-bound session and a trending one. See [Gamma Flip Explained](/learn/gamma-flip-explained).
- **Call wall** — the strike above price with the largest gamma concentration; acts as resistance. See [Call Wall & Put Wall Explained](/learn/call-wall-put-wall-explained).
- **Put wall** — the strike below price with the largest gamma concentration; acts as support.
- **Max pain** — the strike where the most options expire worthless. See [Max Pain Explained](/learn/max-pain-options-explained).
- **King node** — the single largest absolute gamma cell on the board.

**When to use it:** The GEX lens is your primary positioning read. Check it before the open to set the day's regime, and mid-session to catch wall migration. It answers the fundamental question: is dealer hedging working for you or against you today?

## VEX lens — vanna exposure

Vanna measures how dealer delta shifts as [implied volatility](/learn/implied-volatility-explained) changes. The VEX lens maps that sensitivity by strike — telling you what happens to the positioning picture if the VIX spikes or collapses.

**What it shows you:**

- **Vanna walls** — strikes where a change in IV would trigger the largest delta re-hedging by dealers. These are the levels most sensitive to a volatility event.
- **Vanna flip** — the price where the vanna profile crosses zero. Above it, a VIX spike forces dealers to buy; below it, the same spike forces selling.

**When to use it:** VEX matters most on days when IV itself is moving — macro data releases, FOMC days, earnings-heavy sessions. On a quiet day with stable VIX, the VEX lens adds little to what GEX already shows. But on a day when the VIX jumps 3 points, VEX tells you where the *second-order* hedging pressure will hit — the levels that only become important because volatility itself shifted. Think of it as "what does the gamma map look like *after* a vol shock?"

## DEX lens — delta exposure

Delta exposure shows the net directional positioning of dealers across strikes — how many shares' worth of hedging dealers are carrying at each price level.

**What it shows you:**

- **Delta-zero pivot** — the price where aggregate dealer delta exposure crosses zero. This is the point of directional neutrality: above it, dealers are net long delta (bullish hedge bias); below it, they are net short delta (bearish hedge bias).
- **Posture** — whether the overall dealer delta tilt is positive (supportive of upside), negative (supportive of downside), or flat. A large positive DEX reading means dealers own a lot of stock to hedge their short calls, and that stockpile acts as a cushion on dips.

**When to use it:** DEX is the directional read. GEX tells you volatility regime (calm vs. fast); DEX tells you directional lean (bulls vs. bears in the hedging book). When GEX says "expect a move" (negative gamma) and DEX says "dealers are leaning short delta," the setup favors downside — the hedging book is positioned to accelerate a selloff. Conversely, negative GEX with positive DEX means dealers have long-delta hedges that can fuel a squeeze higher.

## CHARM lens — charm exposure

Charm measures how [delta](/learn/options-greeks-explained) changes purely from the passage of time — no price movement required. The CHARM lens maps this time-decay effect by strike, showing where delta is drifting as the session wears on.

**What it shows you:**

- **Charm-zero pivot** — the price where time-driven delta drift crosses zero. Above it, time decay is adding to dealer delta (supportive); below it, time decay is subtracting delta (pressuring).
- **Pinning pressure** — charm concentrates at strikes with heavy open interest close to expiration. As theta erodes option value through the day, delta at those strikes migrates toward zero (for OTM) or 1.0 (for ITM), and dealers re-hedge accordingly. That re-hedging pulls price toward the heavy strikes — the mechanical underpinning of the "expiration pin." See [Max Pain Explained](/learn/max-pain-options-explained) for the related concept.

**When to use it:** CHARM matters most in the afternoon of an expiration day, when time decay is accelerating and the pinning effect is strongest. On a Monday with a Friday expiry, charm is a minor force. On Friday at 2 PM with massive 0DTE open interest, charm is actively dragging price toward the heaviest strikes. Use it to gauge whether a late-session move has mechanical time-decay support or is fighting against a charm-driven pin.

## One payload, four views

All four lenses derive from the same underlying options chain data — open interest, strikes, expirations, and the Greeks at each point. Thermal computes all four exposures server-side and delivers them in a single payload. The client-side toggle simply selects which exposure to render on the profile and heatmap. There is no additional data fetch when you switch lenses, so toggling is instant.

## Putting them together

A practical workflow: start with **GEX** to set the day's regime and mark the walls. If VIX is moving, switch to **VEX** to see which levels are most sensitive to the vol shift. Check **DEX** for the directional lean — does the hedging book favor bulls or bears? And late in the session on an expiry day, glance at **CHARM** to see whether time decay is pulling price toward a pin or letting it run.

No single lens is "the best" — each answers a different question about the same positioning data. GEX is the workhorse; the other three are context layers you reach for when the session demands them.

For how to read the heatmap and profile views themselves, see [How to Read Thermal Heatmaps](/learn/thermal-heatmap-reading-guide). For how to turn these levels into strike decisions, see [Using Thermal for Strike Selection](/learn/thermal-strike-selection-guide). [Get access →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "thermal-strike-selection-guide",
    path: "/learn/thermal-strike-selection-guide",
    metaTitle: "Using Thermal for Strike Selection | BlackOut",
    metaDescription:
      "How to use Thermal's gamma levels for options strike selection — call wall resistance, put wall support, iron condor placement, and gamma flip as a filter.",
    targetKeyword: "options strike selection gamma",
    type: "article" as const,
    title: "Using Thermal for Options Strike Selection",
    description:
      "How to use Thermal's gamma levels for options strike selection — call wall resistance, put wall support, iron condor placement, and gamma flip as a filter.",
    body: `Reading [Thermal](/learn/heat-maps) is one thing; translating what it shows into a specific strike on a specific contract is the step that actually matters. This guide covers how to use the gamma flip, call wall, put wall, and King nodes as direct inputs into strike selection — for directional trades, premium-selling structures, and hedges.

## Call wall as resistance: short call placement

The [call wall](/learn/call-wall-put-wall-explained) is the strike above price with the largest concentration of call-side [gamma](/learn/what-is-gex). Dealer hedging at that strike mechanically sells rallies — every tick toward the wall triggers more selling, creating a ceiling effect. That makes the call wall a natural candidate for **short call strike placement** in credit spreads or [iron condors](/learn/iron-condor-strategy-guide).

Practical example: SPX is at 5,500, and Thermal shows the call wall at 5,550 with a large, stable gamma reading. If you are selling a call spread, placing your short call at 5,550 means you are collecting premium on a strike where mechanical selling pressure is working in your favor — the wall acts as a built-in headwind for any rally that tries to reach your short strike. If the wall is thick (high gamma value) and has been stable across multiple snapshots (check ShiftView), the case is stronger. If the wall is thin or migrating, treat it with less confidence.

## Put wall as support: short put placement

The mirror logic applies on the downside. The [put wall](/learn/call-wall-put-wall-explained) is where put-side gamma concentrates below price, creating a cushion effect — dealer hedging buys dips as price approaches the wall. For a short put spread, placing your short put at or just inside the put wall means mechanical buying pressure works in your favor if price slides toward your strike.

Example: SPX at 5,500, put wall at 5,440. Selling a put spread with a 5,440 short put gives you a strike where dealers are incentivized to buy the dip. That gamma cushion does not guarantee the wall holds — walls break — but it provides a structural edge that picking a round number does not.

## Iron condor strike placement using walls

An [iron condor](/learn/iron-condor-strategy-guide) is a call spread above price plus a put spread below. The simplest Thermal-driven approach: place your short call at or just past the call wall, and your short put at or just past the put wall. This brackets the session inside the zone where dealer hedging actively defends both boundaries.

Example: call wall 5,550, put wall 5,440, SPX at 5,500. Sell the 5,550/5,570 call spread and the 5,440/5,420 put spread. Both short strikes sit at levels where mechanical hedging works in your favor. The long strikes (wings) are 20 points past each wall — wide enough to capture credit, narrow enough to cap max loss.

Check the [GEX regime](/learn/what-is-gex) before placing the condor. A high positive-GEX session supports the range thesis; negative GEX warns that the walls may not hold. In a negative-GEX environment, either widen the wings, reduce size, or skip the condor entirely.

## Gamma flip as a directional filter

The [gamma flip](/learn/gamma-flip-explained) is not a strike you trade directly — it is a filter that determines *which direction* to trade and *how aggressively* to size.

**Price above the flip (positive gamma):** The session favors mean reversion. Directional entries should lean toward fading extremes — buying puts near the call wall or calls near the put wall. Premium-selling structures thrive. Choose strikes closer to the money because the range is compressed.

**Price below the flip (negative gamma):** The session favors momentum. Directional entries should lean toward continuation — calls if price is pushing higher through the flip, puts if it broke down through it. Wider strikes are appropriate because the range is expanded. Condors are riskier — consider directional spreads instead.

**Price oscillating near the flip:** The regime is undefined. This is the hardest environment for strike selection because the market can flip from range-bound to trending and back within an hour. The best strike selection here is often *no strike* — sitting on your hands until the session commits to one side.

## Wall integrity: when walls might break

A wall is not a guarantee. Three conditions weaken a gamma wall:

1. **Thinning gamma.** If the cell values at the wall strike are declining across snapshots (visible in ShiftView), the wall is weakening. Dealers have less hedging to do there, so the mechanical barrier is smaller.

2. **Heavy directional flow.** Check the [HELIX flow overlay](/learn/helix-flow-scanner-guide) on the Thermal profile. If aggressive, opening sweeps are pushing directly at the wall — and the volume dwarfs the wall's gamma — the flow may overwhelm the hedging. This is how wall breaks happen: conviction-driven buying (or selling) large enough to absorb the dealer selling (or buying) at the wall.

3. **Catalyst override.** A macro event (FOMC, CPI) or a mega-cap earnings surprise can produce a move that blows through any gamma wall. Walls built on yesterday's open interest don't know about today's news. On high-catalyst days, treat walls as softer and widen your strikes or skip short-premium structures.

When a wall breaks, it flips from resistance to a momentum signal. Price that closes decisively past a broken call wall often continues higher as the hedging pressure that was capping the move is now gone. See [Call Wall & Put Wall Explained](/learn/call-wall-put-wall-explained) for more on what breaks look like and how to react.

## A practical workflow

Before selecting any strike: (1) open Thermal and note the flip, call wall, put wall, and King node from the [KeyLevelBox](/learn/thermal-heatmap-reading-guide); (2) check the GEX regime — positive or negative; (3) layer on HELIX flow and dark pool lines to see whether activity is converging with or diverging from the gamma levels; (4) then pick your structure (directional, condor, spread) and your strikes based on where the levels sit. This takes about 60 seconds and replaces guesswork with data. [Get access →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "helix-flow-scanner-guide",
    path: "/learn/helix-flow-scanner-guide",
    metaTitle: "HELIX Flow Scanner Walkthrough | BlackOut",
    metaDescription:
      "A complete walkthrough of the HELIX flow scanner — columns, premium filters, type toggles, analytics panel, replay mode, and the ticker drill-down drawer.",
    targetKeyword: "options flow scanner guide",
    type: "article" as const,
    title: "HELIX Flow Scanner: Complete Walkthrough",
    description:
      "A complete walkthrough of the HELIX flow scanner — columns, premium filters, type toggles, analytics panel, replay mode, and the ticker drill-down drawer.",
    body: `[HELIX](/learn/helix-flows) is BlackOut's institutional options flow scanner. It filters the raw firehose of options trades into the prints that actually carry signal — [unusual activity](/learn/unusual-options-activity-guide), aggressive sweeps, and anomalies that stand out from routine hedging noise. Here is how to read every element on the screen.

## HelixFlowTable: the core feed

The main panel is a real-time table of options trades that pass HELIX's premium and signal filters. Each row is a single print or aggregated burst. The columns:

- **Time** — when the trade hit the tape, displayed in ET.
- **Ticker** — the underlying symbol.
- **CALL / PUT** — the contract type, color-coded (green for calls, red for puts).
- **Expiry / Strike / DTE** — the contract's expiration date, strike price, and days to expiry. Short-dated contracts (especially 0DTE) carry a DTE badge to flag the accelerated gamma profile.
- **Premium** — the dollar value of the trade. HELIX surfaces trades above configurable premium thresholds.
- **Fill** — the fill price of the contract.
- **Ask%** — a critical conviction metric. This is total\_ask\_side\_premium / total\_premium x 100. An Ask% of **60% or higher** means the buyer paid at the ask (aggressive, conviction buying). An Ask% of **40% or lower** means the seller hit the bid (aggressive selling or passive liquidation). Mid-range values suggest a neutral or mixed fill. See [HELIX Flow Signals Explained](/learn/helix-flow-signals-explained) for more on interpreting this.
- **OI** — open interest on that contract. Compare to volume: when today's volume exceeds OI, these are new positions being created, not existing ones churning.
- **IV** — [implied volatility](/learn/implied-volatility-explained) of the contract at fill time. Elevated IV on the specific contract (relative to its own history) is one more signal of unusual positioning.
- **OTM%** — how far out of the money the strike is, expressed as a percentage of the underlying's price. Deeper OTM prints at large premiums are more unusual and therefore more interesting.
- **Rule** — the execution type: **SWEEP** (split across multiple exchanges for speed — signals urgency), **BLOCK** (large single-exchange print — often institutional), or **FLOOR** (executed on the physical floor — typically large or complex orders). See [HELIX Flow Signals Explained](/learn/helix-flow-signals-explained) for what each rule type implies.
- **Score** — HELIX's internal signal score for the trade, combining premium, aggression, OI ratio, and rule type.
- **Signals** — badges showing contextual flags: GEX proximity (is the strike near the [gamma flip](/learn/gamma-flip-explained), [call wall, or put wall](/learn/call-wall-put-wall-explained)?), [dark pool](/learn/what-is-dark-pool-trading) correlation, and other anomaly markers.

## Premium floor filters

A row of chips at the top sets the minimum premium threshold for trades to appear in the table:

- **$200K** — the broadest view; captures mid-size institutional prints.
- **$500K** — filters to larger trades only.
- **$1M** — major institutional activity.
- **$20M+** — whale-tier prints; rare but highly significant when they appear.

Raising the floor reduces noise and surfaces only the largest bets. Lowering it gives more context but requires more filtering skill. Start at $500K and move up or down based on the session's volume.

## Type filter and counts

Toggle between **ALL**, **CALL**, or **PUT** to filter the table by contract type. Each toggle shows a **live count** of how many qualifying trades are in each bucket for the current session — a quick read on whether the day's flow leans bullish (call-heavy) or bearish (put-heavy) at a glance.

## Ticker filter and watchlist

A search bar lets you filter the table to a single ticker. For names you watch regularly, **star** them to add to your watchlist — starred tickers float to the top of the filter and can be toggled on as a group. A **CSV export** button downloads the current filtered table for offline analysis or journaling.

## Replay mode

HELIX supports **replay mode** for historical review. Select a past date and the table loads that session's flow in chronological order, so you can step through the prints and see how the tape developed. Replay is how you study — pick a day the market moved hard, replay the flow, and see which prints led the move and which were noise. It's also useful for post-session debriefs: did the flow you acted on that day actually signal what you thought it did?

## Analytics column

To the right of the flow table, an analytics panel provides aggregated views:

- **Net Premium leaderboard** — the tickers with the largest net call-minus-put (or put-minus-call) premium on the session. This surfaces the names where directional conviction is most concentrated, regardless of how many individual prints there are.
- **Strike Stacks** — shows where premium is stacking at specific strikes on a given ticker. A heavy stack at one strike suggests a consensus price target among institutional flow.
- **Dark Pool panel** — aggregated [dark pool](/learn/what-is-dark-pool-trading) prints for the session, showing where off-exchange block trades are concentrating. Cross-reference with the flow table to see whether dark pool stock activity precedes or follows the options prints. For a deeper walkthrough, see [Reading Dark Pool Data on HELIX](/learn/helix-dark-pool-analysis).
- **Velocity Radar** — tracks the *rate* of flow, not just the total. A spike in velocity (many qualifying prints in a short window) is an urgency signal independent of premium size.

## TickerDrawer: per-ticker drill-down

Clicking a ticker in the flow table opens the **TickerDrawer** — a slide-out panel with a focused view of that single name. It shows all qualifying prints for the ticker, aggregated premium by direction, strike distribution, and a mini exposure profile from [Thermal](/learn/heat-maps) (if available for that name). The drawer is where you go from "interesting print" to "full picture on this name" — seeing whether the single trade you noticed is part of a larger pattern or a one-off.

## Practical workflow

A typical session with HELIX: set the premium floor at $500K, toggle to ALL, and scan the table for names appearing repeatedly with high Ask% and SWEEP rules. When a ticker catches your eye, click into the TickerDrawer for the full picture. Cross-check the signals column — is the print near a gamma wall? Is there dark pool activity in the same name? Then decide whether the flow supports a trade thesis. For how to interpret the Tide bar, anomaly banners, and AI brief that sit above the table, see [HELIX Flow Signals Explained](/learn/helix-flow-signals-explained). For background on separating signal from noise, see [How to Read Options Flow](/learn/how-to-read-options-flow). [Get access →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "helix-flow-signals-explained",
    path: "/learn/helix-flow-signals-explained",
    metaTitle: "HELIX Flow Signals: Tide & Sweeps | BlackOut",
    metaDescription:
      "HELIX flow signals explained — the Tide bar, flow anomaly banners, AI brief, ask-percent conviction, sweep vs block vs floor rules, and GEX proximity pills.",
    targetKeyword: "options flow signals sweeps",
    type: "article" as const,
    title: "HELIX Flow Signals: Tide, Sweeps & Anomalies",
    description:
      "HELIX flow signals explained — the Tide bar, flow anomaly banners, AI brief, ask-percent conviction, sweep vs block vs floor rules, and GEX proximity pills.",
    body: `The [HELIX flow scanner](/learn/helix-flow-scanner-guide) shows you the raw prints. The signals layer on top tells you what those prints *mean* in aggregate — whether the session's flow leans bullish or bearish, whether anything anomalous is happening, and whether the prints are landing near levels that matter on the [gamma map](/learn/heat-maps). Here is how to read each signal component.

## HelixTideBar: the session's directional lean

The **TideBar** sits above the flow table and provides a single-glance read on the aggregate direction of institutional flow for the current session.

**The pill.** A label showing **BULLISH**, **BEARISH**, or **NEUTRAL** — the net directional verdict based on cumulative premium weight across all qualifying trades.

**The split bar.** A horizontal bar divided into a green (call premium) section and a red (put premium) section, proportional to total dollar premium on each side. If the bar is 70% green, call-side premium is dominating the session 7-to-3. The bar updates on a **15-second polling cycle**, so the read stays current without flooding you with noise on every tick.

The Tide is a context signal, not a trade trigger. A BULLISH tide doesn't mean "buy calls now" — it means the weight of institutional money flowing through the scanner is leaning call-side. Combined with a [positive GEX regime](/learn/what-is-gex) and price above the [gamma flip](/learn/gamma-flip-explained), a bullish Tide adds confluence. Against a negative-GEX regime, a bullish Tide might simply be hedging rather than conviction.

## FlowAnomalyBanner: when something unusual is happening

When HELIX detects [unusual options activity](/learn/unusual-options-activity-guide) that rises above the baseline noise, the **FlowAnomalyBanner** appears at the top of the scanner.

**Severity badges.** Each anomaly carries a severity level. Low-severity anomalies (notable but not extreme) appear as standard badges. High-severity anomalies that cross a critical threshold — a $20M+ single print, a burst of sweeps on a single name within minutes — get a **pulsing badge** that draws your eye. The pulse is intentional: in a stream of data, critical items need to break through attention fatigue.

**Per-ticker grouping.** Anomalies are grouped by ticker, so you can see at a glance whether the unusual activity is concentrated on one name (a focused institutional thesis) or spread across many (a broad market event).

The banner polls every **20 seconds** — fast enough to catch a developing anomaly, slow enough to avoid false-positive flicker from isolated prints.

## FlowBrief: the AI narrative

During regular trading hours, HELIX generates a **FlowBrief** — a short, AI-written narrative summarizing the most significant flow developments of the session. The brief calls out the names with the heaviest flow, the direction of that flow, and any contextual factors (earnings proximity, macro data releases) that color the interpretation. It refreshes every **15 minutes** during RTH and pauses after the close.

Think of the FlowBrief as a second opinion. If you have been staring at the tape for two hours and lost the thread, the brief re-centers you on what actually matters this session versus what is noise. It is a summary, not a recommendation — use it for context, not as a trade signal.

## Ask% calculation: conviction in the fill

One of the most important columns in the [flow table](/learn/helix-flow-scanner-guide) is **Ask%**, and understanding its math is essential:

**Ask% = total ask-side premium / total premium x 100**

A print where the buyer pays at the ask is an aggressive fill — they wanted the contract enough to pay the offer price rather than sitting on the bid and waiting. An Ask% of **60% or higher** signals conviction buying: the institution crossed the spread to get filled, which costs money and implies urgency. An Ask% of **40% or lower** signals the opposite — the trade was executed at or below the midpoint, suggesting a less urgent or potentially bearish motivation (selling premium, liquidating a position).

Ask% is not a direction signal by itself — a 70% Ask% on puts means aggressive put *buying*, which is bearish. Always read Ask% in the context of whether the contract is a call or a put, and whether the trade is opening or closing a position.

## SWEEP vs. BLOCK vs. FLOOR

Every trade in the HELIX table carries a **rule type** badge:

**SWEEP** — the order was split across multiple exchanges simultaneously to fill fast. The buyer wanted size *now* and paid up across venues. Sweeps signal urgency and conviction. Aggressive sweeps at the ask (calls) or at the bid (puts) are the strongest flow signal in the scanner. See [How to Read Options Flow](/learn/how-to-read-options-flow) for more on sweep mechanics.

**BLOCK** — a large single-venue print, typically negotiated between two parties. Blocks are common for institutional position-building where the institution has time and can negotiate pricing. They carry less urgency than sweeps but more size conviction — someone committed significant capital in one print.

**FLOOR** — executed on the physical trading floor, usually for large or complex orders (multi-leg spreads, packages). Floor trades are often the largest and most carefully structured prints on the tape, but they can also be hedges rather than directional bets. Context from the other columns (Ask%, OI, IV) helps distinguish.

## GEX proximity signals

HELIX cross-references every trade against the live [Thermal](/learn/heat-maps) gamma profile. When a print's strike sits near a key gamma level, it gets a proximity pill:

- **FLIP** — the strike is near the [gamma flip](/learn/gamma-flip-explained). Flow hitting the flip is especially significant because it is pushing at the regime boundary.
- **CALL WALL** — the strike is at or near the [call wall](/learn/call-wall-put-wall-explained). Large call buying at the call wall can either reinforce it (more hedging selling, stronger ceiling) or signal an attempt to break through.
- **PUT WALL** — the strike is at or near the put wall. Large put buying at the put wall can weaken or break the support.

These pills turn the flow table from a standalone feed into a positioning-aware scanner. A $2M call sweep is interesting. A $2M call sweep at the gamma flip is a potential regime-change catalyst. A $2M call sweep at a thinning call wall might be the break signal.

## Combining signals

The most actionable flow setups layer multiple HELIX signals together:

- **Bullish Tide + sweeps at the ask + strikes near a weakening call wall** — buyers are pushing aggressively at a level that is losing its mechanical defense. Watch for a wall break.
- **Anomaly banner pulsing on one ticker + dark pool block in the same name + Ask% > 70%** — institutional accumulation across both dark and lit venues with conviction fills. Cross-reference with the [TickerDrawer](/learn/helix-flow-scanner-guide) for the full picture.
- **Bearish Tide + put sweeps + FLIP proximity pill** — flow is driving price toward the gamma flip from above. If price crosses below, the regime change can accelerate the move. See [Gamma Flip Explained](/learn/gamma-flip-explained).

For a deeper look at how dark pool data fits into this picture, see [Reading Dark Pool Data on HELIX](/learn/helix-dark-pool-analysis). For background on separating signal from noise more generally, see [How to Read Options Flow](/learn/how-to-read-options-flow). [Get access →](/pricing)

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options trading involves substantial risk and is not suitable for every investor.*`,
  },
  {
    slug: "helix-dark-pool-analysis",
    path: "/learn/helix-dark-pool-analysis",
    metaTitle: "Reading Dark Pool Data on HELIX | BlackOut",
    metaDescription:
      "How to read dark pool data on HELIX — the dark pool panel, Thermal overlay rail, spotting institutional accumulation, and cross-referencing with gamma levels.",
    targetKeyword: "dark pool options flow analysis",
    type: "article" as const,
    title: "Reading Dark Pool Data on HELIX",
    description:
      "How to read dark pool data on HELIX — the dark pool panel, Thermal overlay rail, spotting institutional accumulation, and cross-referencing with gamma levels.",
    body: `[Dark pool](/learn/what-is-dark-pool-trading) activity is the off-exchange layer most retail traders never see. Roughly 40-50% of U.S. equity volume trades through these private venues before showing up on the tape, and the prints often precede — not follow — the options flow that appears on a public scanner. [HELIX](/learn/helix-flows) surfaces that data so you can see it alongside everything else.

## The Dark Pool panel

In the analytics column of the [HELIX flow scanner](/learn/helix-flow-scanner-guide), the **Dark Pool panel** aggregates off-exchange block prints for the session. Each entry shows the ticker, price level, and aggregate block volume at that level. The panel answers a simple question: at which prices have institutions been quietly building or liquidating positions off the lit tape?

**What to look for:**

- **Large blocks at a single price.** Repeated dark pool prints clustered at the same price level suggest an institution is methodically accumulating (or distributing) at that price. The consistency matters more than any single print — one block is an anecdote; five blocks at the same price is a pattern.
- **Block size relative to the name.** A $10M dark pool print in AAPL is large but not extraordinary. The same print in a $5B market-cap name is enormous and far more likely to move the stock once the position is established.
- **Timing relative to options flow.** Dark pool stock prints frequently *precede* options activity. An institution buys shares off-exchange first, then layers on calls for leverage or puts for hedging. When you see a dark pool block appear in the panel and then, minutes or hours later, see aggressive call sweeps on the same name in the HELIX flow table — that convergence is one of the strongest institutional-conviction signals available to retail traders.

## DarkPoolRail on Thermal

Beyond the HELIX panel, dark pool levels also appear on [Thermal](/learn/heat-maps) as the **DarkPoolRail** — horizontal reference lines overlaid on the gamma exposure profile. Each line marks a price where significant off-exchange volume traded.

The power of the Thermal overlay is **context**. Seeing a dark pool line in isolation tells you where institutions traded. Seeing it on Thermal tells you where they traded relative to the [gamma flip](/learn/gamma-flip-explained), the [call wall, and the put wall](/learn/call-wall-put-wall-explained). A dark pool accumulation level that sits right at the put wall means that level has two independent reasons to act as support — mechanical dealer hedging *and* institutional demand. If price dips to that zone, both forces push back. Conversely, a dark pool distribution level near the call wall adds a second layer of resistance on top of the gamma ceiling.

## Spotting institutional accumulation

The textbook pattern for institutional accumulation on HELIX looks like this:

1. **Dark pool blocks appear** at a consistent price level over hours or days — quiet, steady buying off-exchange.
2. **[Unusual options activity](/learn/unusual-options-activity-guide) follows** — opening call purchases with high Ask% (conviction fills), often sweeps, on the same ticker.
3. **The convergence** — dark pool stock buying followed by aggressive options positioning in the same direction suggests the institution has built a core stock position and is now adding leveraged upside via calls (or hedging with puts).

Neither signal alone is conclusive. Dark pool blocks can be hedging, index rebalancing, or crosses between related funds. Call sweeps can be closing trades or legs of a spread. But the combination — off-exchange accumulation in the stock followed by opening, aggressive, unusual call flow — is a materially stronger signal than either in isolation.

On the distribution side, the pattern inverts: dark pool blocks appearing at a price above recent range (profit-taking or exit), followed by put buying or call selling on the options tape. This is harder to spot because distribution is often quieter and more gradual, but HELIX's anomaly detection ([FlowAnomalyBanner](/learn/helix-flow-signals-explained)) can flag the options leg when the activity crosses the unusual threshold.

## Cross-referencing with gamma levels

The most actionable dark pool reads involve layering the data against [Thermal's gamma profile](/learn/thermal-heatmap-reading-guide):

**Dark pool at the put wall.** Double support — dealer hedging buys dips at the wall, and institutional demand lives at the same price. A dip to this level has strong odds of bouncing unless both forces fail simultaneously (a wall break driven by flow larger than both the gamma and the dark pool demand).

**Dark pool at the call wall.** Double resistance if the dark pool prints are distribution. But if the dark pool prints are *accumulation* at the call wall, it suggests the institution expects a breakout — they are buying where dealers are selling, betting the wall will break. That setup is rare but powerful: watch for aggressive sweeps at the same level to confirm whether the wall is about to give way.

**Dark pool at the gamma flip.** Positioning at the regime boundary. If institutions are accumulating stock at the flip price, they may be betting on the session committing to positive gamma (price holding above the flip). If they are distributing, they may expect the flip to break to the downside. Cross-check with the [HELIX Tide](/learn/helix-flow-signals-explained) to see whether the broader flow agrees.

**Dark pool in open space.** When a large dark pool level sits between the call wall and the put wall — away from any gamma level — it can act as an independent support or resistance zone that the gamma profile alone would miss. These levels are "hidden" on a pure gamma read but visible on HELIX. Mark them as supplemental reference levels alongside the wall, flip, and [max pain](/learn/max-pain-options-explained).

## Practical routine

During RTH, glance at the Dark Pool panel periodically for developing block clusters. When a ticker shows up with heavy dark pool activity, open the [TickerDrawer](/learn/helix-flow-scanner-guide) to see the full flow picture for that name. Then switch to Thermal and check the DarkPoolRail against the gamma profile — does the dark pool level reinforce a wall, or does it sit in a gap? That two-screen check takes seconds and adds a layer of institutional context that most retail setups completely ignore.

For the foundations of dark pool mechanics, see [What Is Dark Pool Trading?](/learn/what-is-dark-pool-trading). For how to interpret the options flow side of the equation, see [How to Read Options Flow](/learn/how-to-read-options-flow) and [Unusual Options Activity Guide](/learn/unusual-options-activity-guide). [Get access →](/pricing)

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
