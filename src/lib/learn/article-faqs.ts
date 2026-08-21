/**
 * FAQ structured data for learn articles.
 *
 * Each article slug maps to 2-3 FAQ items that target real search queries.
 * Rendered as FAQPage JSON-LD alongside the ArticleJsonLd on every learn
 * article page so Google can show expandable Q&A snippets in search results.
 */

type FAQItem = { question: string; answer: string };

export const ARTICLE_FAQS: Record<string, FAQItem[]> = {
  /* ── Pillar / core concepts ──────────────────────────────────────── */

  "dealer-gamma-options-flow-guide": [
    {
      question: "What is dealer gamma in options trading?",
      answer:
        "Dealer gamma is the aggregate hedging pressure that market makers exert when they buy and sell the underlying to stay neutral on their options positions, creating mechanical price levels like the gamma flip, call wall, and put wall.",
    },
    {
      question: "How does options flow affect stock prices?",
      answer:
        "Options flow drives stock prices through delta hedging. When traders buy or sell options, market makers take the other side and continuously hedge by buying and selling the underlying, creating large-scale mechanical buying and selling pressure at key levels.",
    },
    {
      question: "What is the relationship between dealer positioning and SPX?",
      answer:
        "Dealer positioning determines whether SPX stabilizes or accelerates on any given day. When dealers are long gamma they dampen volatility and pin price, and when they are short gamma they amplify moves and cause trending sessions.",
    },
  ],

  "what-is-dealer-gamma-exposure": [
    {
      question: "What is dealer gamma exposure?",
      answer:
        "Dealer gamma exposure measures how much market makers must buy or sell the underlying as price moves to stay hedged on their options positions, revealing where mechanical buying and selling pressure concentrates.",
    },
    {
      question: "What is the difference between positive and negative gamma?",
      answer:
        "Positive (long) gamma means dealers hedge against the move by selling rallies and buying dips, dampening volatility. Negative (short) gamma means dealers hedge with the move, amplifying volatility and causing price to trend.",
    },
    {
      question: "How do you read dealer gamma exposure?",
      answer:
        "Check three things before each session: where the gamma flip sits relative to current price, whether aggregate GEX is positive or negative, and where the call wall and put wall bracket the expected range.",
    },
  ],

  "gamma-flip-explained": [
    {
      question: "What is the gamma flip level?",
      answer:
        "The gamma flip is the price at which aggregate dealer gamma crosses from positive to negative. Above it the market tends to be calm and range-bound, and below it the market tends to be volatile and trending.",
    },
    {
      question: "How do you trade the gamma flip?",
      answer:
        "Above the gamma flip, fade extremes and sell premium since dealers suppress volatility. Below the gamma flip, respect momentum and avoid fighting the trend since dealers amplify moves.",
    },
    {
      question: "Why is the gamma flip important for day trading?",
      answer:
        "The gamma flip defines the character of the session before the first trade. The same chart setup requires opposite strategies depending on which side of the flip price sits on, making it the single most important positioning level to check each morning.",
    },
  ],

  "call-wall-put-wall-explained": [
    {
      question: "What is a call wall in options?",
      answer:
        "The call wall is the strike above current price with the largest concentration of call gamma, where dealer hedging creates mechanical selling pressure that often acts as resistance or a price magnet.",
    },
    {
      question: "What is a put wall in options?",
      answer:
        "The put wall is the strike below current price with the largest concentration of put gamma, where dealer hedging creates mechanical buying pressure that often acts as support.",
    },
    {
      question: "What happens when a call wall or put wall breaks?",
      answer:
        "When price breaks decisively through a gamma wall, the mechanical hedging that was containing the move becomes fuel for momentum, often triggering a fast move in the direction of the break rather than a reversal.",
    },
  ],

  "what-is-gex": [
    {
      question: "What is GEX in options trading?",
      answer:
        "GEX (Gamma Exposure) is the total dealer gamma aggregated across the entire options chain, summarizing whether dealers will stabilize the market (positive GEX) or amplify moves (negative GEX).",
    },
    {
      question: "How does GEX affect stock prices?",
      answer:
        "When GEX is positive, dealer hedging sells rallies and buys dips, suppressing volatility and keeping prices range-bound. When GEX is negative, dealer hedging amplifies moves, causing larger intraday swings.",
    },
    {
      question: "How do you use GEX for trading?",
      answer:
        "Use positive GEX sessions for premium selling and mean-reversion strategies like iron condors. Use negative GEX sessions for directional trades that respect momentum, and avoid premium-selling structures that rely on the range holding.",
    },
  ],

  /* ── 0DTE ────────────────────────────────────────────────────────── */

  "0dte-spx-options-strategy": [
    {
      question: "What are 0DTE options?",
      answer:
        "0DTE (zero-days-to-expiration) options are contracts that expire the same day they are traded, carrying enormous fast-decaying gamma that makes intraday dealer positioning the dominant factor in price behavior.",
    },
    {
      question: "How do you trade 0DTE SPX options?",
      answer:
        "Trade 0DTE SPX by first reading the gamma regime (above or below the flip), marking the call and put walls as the session's range boundaries, defining risk before entry, and waiting for confluence between positioning, flow, and price.",
    },
    {
      question: "What time is best for 0DTE trading?",
      answer:
        "The 10:00 AM to 11:30 AM ET window tends to offer the best signal-to-noise ratio for 0DTE trading, as the session's character has committed and the initial opening noise has settled. Many professional 0DTE traders skip the first 30 minutes entirely.",
    },
  ],

  "is-0dte-gambling": [
    {
      question: "Is trading 0DTE options gambling?",
      answer:
        "Trading 0DTE options is gambling when done without a read on positioning, defined risk, or a plan. It becomes structured trading when based on dealer gamma levels, flow analysis, and a systematic filter that demands confluence before entry.",
    },
    {
      question: "What win rate is realistic for 0DTE trading?",
      answer:
        "Realistic win rates on graded, directional 0DTE setups tend to land in the 45-55% range, with profitability coming from a favorable payoff structure where winners average 80-150% return versus capped losses on premium paid.",
    },
    {
      question: "How do you develop an edge in 0DTE trading?",
      answer:
        "Develop an edge by reading the gamma regime and marking levels before trading, defining risk in dollars before clicking, demanding confluence from independent signals before entering, and logging every trade to build a verifiable record.",
    },
  ],

  /* ── Flow & activity ─────────────────────────────────────────────── */

  "how-to-read-options-flow": [
    {
      question: "How do you read options flow?",
      answer:
        "Read options flow by checking whether trades are opening or closing positions, whether fills are aggressive (at the ask) or passive, whether trades are hedged against stock, and whether the volume is unusual relative to that name's baseline.",
    },
    {
      question: "What is a sweep order in options?",
      answer:
        "A sweep order is split across multiple exchanges simultaneously to fill fast, signaling urgency and conviction. Sweeps at the ask for calls indicate aggressive bullish positioning from institutions willing to pay up for immediate execution.",
    },
    {
      question: "How do you separate smart money from noise in options flow?",
      answer:
        "Compare today's volume to open interest at each strike. When volume exceeds open interest, new positions are being created. Pair that with sweep detection and bid/ask aggression to filter out routine hedging and market-making activity.",
    },
  ],

  "gamma-squeeze-explained": [
    {
      question: "What is a gamma squeeze?",
      answer:
        "A gamma squeeze is a feedback loop where heavy call buying forces dealers to buy the underlying to hedge their short gamma, which pushes price higher, which forces more buying, creating a self-reinforcing mechanical rally.",
    },
    {
      question: "What causes a gamma squeeze?",
      answer:
        "A gamma squeeze requires three ingredients: heavy call positioning that puts dealers short gamma, a catalyst that starts moving price higher, and enough momentum to trigger the feedback loop of forced dealer buying that overwhelms available liquidity.",
    },
    {
      question: "What is the difference between a gamma squeeze and a short squeeze?",
      answer:
        "A short squeeze is driven by short sellers covering their positions, while a gamma squeeze is driven by dealers mechanically hedging options. They often occur together, as with GameStop in January 2021, creating a double feedback loop.",
    },
  ],

  "options-trading-glossary": [
    {
      question: "What are the most important options trading terms to know?",
      answer:
        "Key options trading terms include delta (directional exposure), gamma (rate of delta change), theta (time decay), GEX (dealer gamma exposure), the gamma flip (calm-to-chaos boundary), and call/put walls (strikes with concentrated dealer hedging pressure).",
    },
    {
      question: "What does GEX mean in options?",
      answer:
        "GEX stands for Gamma Exposure, the total dealer gamma aggregated across the options chain. Positive GEX stabilizes the market as dealers sell rallies and buy dips, while negative GEX amplifies moves as dealers hedge with the trend.",
    },
  ],

  /* ── Strategies ──────────────────────────────────────────────────── */

  "iron-condor-strategy-guide": [
    {
      question: "What is an iron condor options strategy?",
      answer:
        "An iron condor is a four-leg options strategy that sells a call spread above price and a put spread below, collecting a net credit that is kept in full if the underlying stays between both short strikes at expiration.",
    },
    {
      question: "When should you trade an iron condor?",
      answer:
        "Iron condors work best in range-bound sessions with positive GEX (dealer hedging suppresses volatility), elevated implied volatility (richer premiums), and short strikes placed at or near the call wall and put wall for structural defense.",
    },
    {
      question: "What is the max loss on an iron condor?",
      answer:
        "The maximum loss on an iron condor is the width of one spread minus the net credit received. For example, 20-point wings with a $3.00 credit means max loss is $17.00 per contract, regardless of how far price runs past a short strike.",
    },
  ],

  "credit-spreads-strategy-guide": [
    {
      question: "What is a credit spread in options?",
      answer:
        "A credit spread involves selling a closer-to-the-money option and buying a further-out option at the same expiration, collecting a net credit upfront with a capped maximum loss equal to the spread width minus the credit received.",
    },
    {
      question: "When should you use credit spreads?",
      answer:
        "Credit spreads work best in positive GEX environments above the gamma flip with elevated implied volatility, placing short strikes at or near gamma walls where dealer hedging provides structural defense of the range.",
    },
    {
      question: "What is the difference between a bull put spread and a bear call spread?",
      answer:
        "A bull put spread sells a higher-strike put and buys a lower-strike put, profiting when price stays above the short put. A bear call spread sells a lower-strike call and buys a higher-strike call, profiting when price stays below the short call.",
    },
  ],

  /* ── Market structure ────────────────────────────────────────────── */

  "what-is-dark-pool-trading": [
    {
      question: "What is dark pool trading?",
      answer:
        "Dark pool trading occurs on private venues where institutions buy and sell large blocks of stock away from public exchanges, with trades reported to the tape only after execution, allowing large orders to fill with minimal market impact.",
    },
    {
      question: "How do dark pools affect options flow?",
      answer:
        "A large dark pool print in a stock often precedes options activity. Institutions build a position off-exchange first, then layer on calls or puts for leverage, making dark pool prints followed by unusual options activity a strong combined signal.",
    },
    {
      question: "How do you spot dark pool activity?",
      answer:
        "Look for trades printed at the midpoint between bid and ask, single prints with size that dwarfs the visible tape, and price barely moving despite heavy volume, as these are characteristic fingerprints of off-exchange dark pool execution.",
    },
  ],

  /* ── Greeks ──────────────────────────────────────────────────────── */

  "options-greeks-explained": [
    {
      question: "What are the options Greeks?",
      answer:
        "The four main options Greeks are delta (price sensitivity to underlying movement), gamma (rate of delta change), theta (daily time decay), and vega (sensitivity to implied volatility changes). Together they describe exactly how an option will behave.",
    },
    {
      question: "Why is gamma important for 0DTE options?",
      answer:
        "Gamma dominates 0DTE because same-day contracts carry enormous gamma that can swing delta from 0.20 to 0.70 within an hour, making a 0DTE position double or get cut in half on moves that would barely register on a 30-day option.",
    },
    {
      question: "What is theta in options trading?",
      answer:
        "Theta measures how much value an option loses per day from time decay alone. It accelerates as expiration approaches and is especially punishing on 0DTE contracts, working against buyers and in favor of sellers.",
    },
  ],

  "implied-volatility-explained": [
    {
      question: "What is implied volatility in options?",
      answer:
        "Implied volatility (IV) is the market's annualized forecast of how much an underlying will move, derived from option prices. Higher IV means richer option premiums on both calls and puts, regardless of direction.",
    },
    {
      question: "What is IV crush?",
      answer:
        "IV crush is the rapid collapse of implied volatility after a known event like earnings resolves. IV can drop from 90% to 35% within minutes regardless of direction, causing option holders to lose money even if they were right on the move.",
    },
    {
      question: "What is the difference between IV rank and IV percentile?",
      answer:
        "IV rank measures where current IV sits between its 52-week high and low, while IV percentile measures what percentage of days in the past year had lower IV. Both tell you whether volatility is cheap or expensive for that specific name.",
    },
  ],

  "delta-hedging-explained": [
    {
      question: "What is delta hedging?",
      answer:
        "Delta hedging is the continuous process by which market makers buy and sell the underlying stock to stay directionally neutral on their options positions, rebalancing hundreds of times daily as delta shifts with price movement.",
    },
    {
      question: "Why do market makers delta hedge?",
      answer:
        "Market makers delta hedge to eliminate directional risk. When they sell you a call, they buy shares equal to the option's delta to offset the exposure, and continuously adjust as the stock price moves and delta changes.",
    },
    {
      question: "How does delta hedging move the market?",
      answer:
        "When enough dealers hedge in the same direction simultaneously, their forced buying or selling becomes a real force on price. In long gamma they dampen moves; in short gamma they amplify them, which is why dealer positioning drives intraday price behavior.",
    },
  ],

  "theta-decay-options-explained": [
    {
      question: "How does theta decay work in options?",
      answer:
        "Theta decay is non-linear. A 30-day option loses small amounts daily, but decay accelerates sharply as expiration approaches. On 0DTE contracts, a $2.00 option at 10 AM can be worth $0.20 by 2 PM even with no underlying price movement.",
    },
    {
      question: "Should you buy or sell theta in options?",
      answer:
        "Selling theta (iron condors, credit spreads) works best in positive GEX regimes where dealers suppress volatility. Buying theta (directional 0DTE) works best in negative GEX regimes where momentum creates moves large enough to overcome the decay.",
    },
    {
      question: "Why does theta accelerate near expiration?",
      answer:
        "Theta accelerates because the remaining extrinsic value must decay to zero by expiration. The same dollar amount that took weeks to erode must now vanish in hours, creating the hockey-stick shaped decay curve that is especially brutal on 0DTE contracts.",
    },
  ],

  /* ── Flow filtering ──────────────────────────────────────────────── */

  "unusual-options-activity-guide": [
    {
      question: "What is unusual options activity?",
      answer:
        "Unusual options activity (UOA) is volume in a specific contract that is meaningfully higher than its baseline, measured relative to that name's own normal volume rather than against a universal dollar threshold.",
    },
    {
      question: "How do you identify unusual options activity?",
      answer:
        "Compare today's volume to open interest at a specific strike. When volume exceeds open interest, new positions are being created. Pair that with sweep detection and bid/ask aggression to filter out routine hedging and market-making noise.",
    },
    {
      question: "What makes options activity truly unusual versus routine?",
      answer:
        "True unusual activity combines three signals: volume exceeding open interest (new positions), aggressive fills at the ask (conviction), and sweep execution across multiple exchanges (urgency). Most flagged activity fails at least one of these filters.",
    },
  ],

  /* ── Max pain ────────────────────────────────────────────────────── */

  "max-pain-options-explained": [
    {
      question: "What is max pain in options?",
      answer:
        "Max pain is the strike price at which the most options would expire worthless, minimizing the total payout to option holders. It is calculated by totaling intrinsic value across all strikes and finding the strike with the minimum payout.",
    },
    {
      question: "Does max pain actually predict where a stock will close?",
      answer:
        "Max pain has mixed predictive power. It has some pull on quiet, low-volume expirations with concentrated open interest, but is routinely overridden by real catalysts and directional flow, making it a secondary reference rather than a primary signal.",
    },
    {
      question: "How is max pain different from gamma walls?",
      answer:
        "Gamma walls are derived from actual dealer hedging flows that mechanically force buying and selling in real time. Max pain is a static payout calculation with no mechanism forcing price to that level, making gamma walls the more mechanically grounded read.",
    },
  ],

  /* ── SPX Slayer ──────────────────────────────────────────────────── */

  "spx-slayer-dashboard-guide": [
    {
      question: "What is the SPX Slayer dashboard?",
      answer:
        "SPX Slayer is a three-column 0DTE command center showing the GEX/VEX matrix on the left, graded play setups in the center, and Largo AI commentary on the right, with a hero bar displaying live SPX price, VIX, VWAP, and net GEX.",
    },
    {
      question: "How do you read the SPX Slayer dashboard?",
      answer:
        "Read top-down: check the hero bar for the five-second pulse on SPX, VIX, and regime, then the technical strip for key levels, the left column for gamma positioning, the center for actionable plays, and the right for AI narrative context.",
    },
  ],

  "spx-slayer-play-grades-explained": [
    {
      question: "What do SPX Slayer play grades mean?",
      answer:
        "SPX Slayer grades rate setups from A+ to D based on confluence, measuring how many independent signals (GEX regime, VWAP posture, EMA stack, institutional flow, risk-to-reward, and AI verdict) agree that the trade is worth taking.",
    },
    {
      question: "How does SPX Slayer's grading system work?",
      answer:
        "The engine evaluates candidates through sequential gates including GEX regime compatibility, VWAP posture, EMA alignment, institutional flow bias, risk-to-reward ratio, and an AI verdict, producing a score from 0-100 and a confidence percentage.",
    },
    {
      question: "How should you size trades based on SPX Slayer grades?",
      answer:
        "A+ and A grades get standard size. B grades get half size. C grades get quarter size or skip. D grades are no-trade. The grade reflects how many independent signals agree, and position size should match that level of agreement.",
    },
  ],

  "spx-slayer-gex-matrix-guide": [
    {
      question: "What is the GEX matrix?",
      answer:
        "The GEX matrix is a strike-by-expiry heatmap showing signed dollar gamma exposure at each intersection, with green cells indicating dealer long gamma (stabilizing) and red cells indicating short gamma (amplifying).",
    },
    {
      question: "How do you read the GEX matrix?",
      answer:
        "Look for King nodes (the largest gamma concentration per expiry column), column-level walls showing which expirations drive the aggregate wall, and the gamma flip where exposure crosses zero, especially in the 0DTE column for intraday trading.",
    },
    {
      question: "What is a King node on the GEX matrix?",
      answer:
        "A King node is the single largest absolute gamma concentration within a specific expiry column, marked with a star. It often coincides with the call wall or put wall but can differ, since the wall is the largest across all expirations.",
    },
  ],

  "spx-slayer-lotto-power-hour": [
    {
      question: "What is a lotto play in 0DTE trading?",
      answer:
        "A lotto play is an early-session (7:00-10:30 AM ET) asymmetric trade targeting strikes roughly 25 points out of the money with a 3:1 reward-to-risk ratio, exploiting peak morning gamma when intraday moves can be outsized.",
    },
    {
      question: "What is the Power Hour in 0DTE options?",
      answer:
        "The Power Hour engine fires from 2:45-3:15 PM ET, targeting strikes roughly 8 points out of the money with maximum $0.50 premium, exploiting extreme late-session theta decay on contracts with less than an hour to expiry.",
    },
    {
      question: "How do lotto plays differ from regular 0DTE trades?",
      answer:
        "Lotto plays use wider strikes and larger targets for low-probability, high-payoff setups during peak morning gamma. The main engine trades standard OTM distances during core hours with the richest positioning data and most independent signal inputs.",
    },
  ],

  /* ── Thermal ─────────────────────────────────────────────────────── */

  "thermal-heatmap-reading-guide": [
    {
      question: "How do you read a dealer gamma heatmap?",
      answer:
        "Start with the KeyLevelBox for the gamma flip, walls, and max pain, then check the exposure profile shape and King node, layer on HELIX flow and dark pool overlays, and use ExpiryScope to isolate 0DTE versus monthly gamma contributions.",
    },
    {
      question: "What is the Thermal exposure profile?",
      answer:
        "The exposure profile collapses the strike-by-expiry matrix into a single chart showing net gamma by strike, with horizontal bars extending left (negative/red) or right (positive/green), marking the spot price, gamma flip, and King node.",
    },
    {
      question: "What do wall breaks and flip crosses mean on a heatmap?",
      answer:
        "A wall break means price has moved through a call wall or put wall, signaling momentum rather than a fade. A flip cross means price has crossed the gamma flip, switching the session's regime from positive to negative gamma or vice versa.",
    },
  ],

  "thermal-four-lenses-explained": [
    {
      question: "What are GEX, VEX, DEX, and CHARM in options?",
      answer:
        "GEX shows gamma exposure (where dealers buy and sell as price moves), VEX shows vanna exposure (how hedging shifts with IV changes), DEX shows delta exposure (directional lean), and CHARM shows time-decay effects on dealer hedging.",
    },
    {
      question: "When should you use the VEX lens instead of GEX?",
      answer:
        "Use the VEX (vanna exposure) lens when implied volatility is moving sharply, such as on FOMC days, macro releases, or earnings-heavy sessions, to see where second-order hedging pressure from a volatility shock will hit.",
    },
    {
      question: "What does the CHARM lens show?",
      answer:
        "CHARM maps how delta changes purely from time passing, without any price movement. It matters most in the afternoon of expiration day, showing where time-driven delta drift creates pinning pressure that pulls price toward heavy-OI strikes.",
    },
  ],

  "thermal-strike-selection-guide": [
    {
      question: "How do you use gamma levels to select option strikes?",
      answer:
        "Place short call strikes at or past the call wall where dealer selling creates resistance, and short put strikes at or past the put wall where dealer buying creates support. Use the gamma flip as a filter for whether to fade or follow.",
    },
    {
      question: "How do you pick iron condor strikes using gamma data?",
      answer:
        "Place the short call at the call wall and short put at the put wall to bracket the session inside the zone where dealer hedging defends both boundaries. Add long strike wings 15-20 points past each wall to cap the risk.",
    },
    {
      question: "When should you not trust a gamma wall for strike selection?",
      answer:
        "Distrust walls when cell values are thinning across snapshots, when heavy directional flow is pushing directly at the wall on the HELIX overlay, or when a high-impact catalyst like FOMC or CPI is scheduled during the session.",
    },
  ],

  /* ── HELIX ───────────────────────────────────────────────────────── */

  "helix-flow-scanner-guide": [
    {
      question: "What is the HELIX options flow scanner?",
      answer:
        "HELIX is an institutional options flow scanner that filters the raw tape for unusual activity, aggressive sweeps, and anomalies, displaying premium size, ask% conviction, sweep detection, open interest comparison, and gamma proximity signals.",
    },
    {
      question: "How do you use an options flow scanner effectively?",
      answer:
        "Set the premium floor at $500K or higher, scan for names with high Ask% (above 60%) and SWEEP execution rules, click into the per-ticker drill-down for the full picture, and cross-check for gamma wall proximity and dark pool correlation.",
    },
  ],

  "helix-flow-signals-explained": [
    {
      question: "What is the Tide bar in options flow?",
      answer:
        "The Tide bar shows the aggregate directional lean of institutional options flow for the current session -- BULLISH, BEARISH, or NEUTRAL -- based on cumulative premium weight of calls versus puts across all qualifying trades.",
    },
    {
      question: "What does Ask% mean in options flow?",
      answer:
        "Ask% is the share of total premium that traded at the ask price. Above 60% signals conviction buying where the institution crossed the spread to get filled, while below 40% signals less urgency or selling at the bid.",
    },
    {
      question: "What is the difference between SWEEP, BLOCK, and FLOOR trades?",
      answer:
        "SWEEP orders hit the ask across multiple exchanges simultaneously for urgent execution. BLOCK trades are large single-venue prints with size conviction. FLOOR trades are executed on the physical trading floor, typically for large or complex multi-leg orders.",
    },
  ],

  "helix-dark-pool-analysis": [
    {
      question: "How do you read dark pool data on a flow scanner?",
      answer:
        "Look for repeated blocks at one price level indicating methodical accumulation, block size relative to the name's normal volume, and timing relative to options flow, since dark pool prints frequently precede options activity rather than follow it.",
    },
    {
      question: "What does dark pool activity near a gamma wall mean?",
      answer:
        "Dark pool accumulation at the put wall creates double support from both dealer hedging and institutional demand. Distribution near the call wall adds a second resistance layer on top of the gamma ceiling, strengthening the level.",
    },
    {
      question: "How do you spot institutional accumulation using dark pools?",
      answer:
        "The textbook accumulation pattern is dark pool blocks at a consistent price over hours or days, followed by unusual opening call purchases with high Ask%, often sweeps, on the same ticker, indicating the institution built a core stock position and is adding leveraged upside.",
    },
  ],

  /* ── Night Hawk ──────────────────────────────────────────────────── */

  "night-hawk-evening-edition-guide": [
    {
      question: "What is the Night Hawk Evening Edition?",
      answer:
        "The Night Hawk Evening Edition is a post-close playbook publishing five ranked overnight trade ideas with conviction tiers, composite scores, entry/target/stop levels, and specific options contracts for the next trading session.",
    },
    {
      question: "How does Night Hawk's conviction tier system work?",
      answer:
        "Night Hawk tiers plays A, B, or C based on score band placement, signal breadth, and earnings risk. A+ is only earned after 10 graded outcomes with an 80% or higher win rate and is never assigned at build time.",
    },
    {
      question: "What is the Night Hawk morning confirmation?",
      answer:
        "At 9:15 AM ET, a cron job re-evaluates every play against current conditions and stamps each as CONFIRMED, DEGRADED, INVALIDATED, or UNVERIFIED. Always check confirmation badges before the open, as an overnight play is meaningless if invalidated.",
    },
  ],

  "night-hawk-0dte-command-guide": [
    {
      question: "What is the 0DTE Command scanner?",
      answer:
        "The 0DTE Command scanner is an always-on intraday engine that hunts the entire tape for same-day expiration trades across SPY, QQQ, NVDA, and any name where flow, structure, and positioning align, running continuously from pre-market through the close.",
    },
    {
      question: "What are the hard entry gates for 0DTE plays?",
      answer:
        "Key gates include tape alignment (G-1), no entries before 10:00 ET (G-2), a score floor of 65 (G-3), VIX-adjusted thresholds (G-4), and minimum 2 independent confirmations (G-12). Any single gate failure blocks the trade and the reason is shown.",
    },
    {
      question: "What risk rules does the 0DTE system enforce?",
      answer:
        "Every committed play follows fixed rules: a -50% stop (cut when premium loses half its entry value), a +100% target (trim when premium doubles), a 15:30 ET time stop (hard exit before the close), and 55% chase protection to prevent stale entries.",
    },
  ],

  "night-hawk-cortex-evidence-system": [
    {
      question: "What is the Cortex evidence system?",
      answer:
        "The Cortex composes evidence from eight independent data sources including GEX walls, wall lifecycle, flow quality, sector heat, catalysts, VEX/charm, dark pool confluence, and opening harvest, where any single source can veto an entry but no single source can force one.",
    },
    {
      question: "How does the Cortex prevent bad trades?",
      answer:
        "The Cortex uses veto asymmetry: a dominant opposing dealer wall or a $1M+ opposing sweep cluster blocks any entry regardless of how high the supporting score is. The system is precision-first, designed to keep you out of bad trades.",
    },
    {
      question: "What is evidence decay in trading systems?",
      answer:
        "Every Cortex evidence item carries an exponential half-life. Fresh evidence contributes its full weight, but decays over time. After three half-lives the item self-silences to absent rather than pretending a stale reading is still valid.",
    },
  ],

  /* ── Largo AI ────────────────────────────────────────────────────── */

  "largo-ai-terminal-guide": [
    {
      question: "What is an AI desk analyst for options trading?",
      answer:
        "Largo AI is a desk analyst wired into live market data with access to over 70 tools including GEX structure, options flow, dealer positioning, and the Night Hawk edition. It composes grounded answers from real numbers rather than guessing.",
    },
    {
      question: "What questions work best with an AI trading terminal?",
      answer:
        "Specific, data-grounded questions work best, such as 'What is the gamma regime for SPY right now?' or 'Is there unusual flow in NVDA today?' Vague questions like 'What should I trade?' produce weaker answers since no tool can answer them.",
    },
    {
      question: "How do you verify AI trading answers?",
      answer:
        "Check the tool trace chips under each answer to see which live data sources were actually fetched. If the chips show get_gex and get_spx_structure, the answer is grounded in fresh positioning data. If no tools ran, treat the output as general commentary only.",
    },
  ],

  "largo-ai-market-analysis-tips": [
    {
      question: "How do you get better answers from an AI market analysis tool?",
      answer:
        "Ask specific, falsifiable questions that name the data you want, build multi-step investigations across follow-up turns, and always check the tool trace chips to verify which data sources grounded the answer.",
    },
    {
      question: "Can AI tools replace reading trading dashboards?",
      answer:
        "Dashboards are better for fast visual scanning and monitoring the whole state at a glance. AI tools are better for cross-referencing data from multiple surfaces, investigating anomalies, and getting composed reads that combine positioning, flow, and volatility.",
    },
  ],

  /* ── Vector ──────────────────────────────────────────────────────── */

  "vector-scanner-guide": [
    {
      question: "What is a cross-ticker gamma scanner?",
      answer:
        "The Vector scanner extends dealer gamma exposure analysis across the entire universe of tickers, providing ranked setups with GEX ladders, gamma regime posture, wall integrity scores, and confluence zones for each name.",
    },
    {
      question: "What is a gamma confluence zone?",
      answer:
        "A gamma confluence zone is where multiple independent price levels -- gamma walls, the gamma flip, max pain, fib golden pockets, and session levels -- stack within approximately 0.15% of the current price, creating a high-probability trade location.",
    },
    {
      question: "What is a wall integrity score?",
      answer:
        "The wall integrity score (0-100) rates how trustworthy a gamma wall is by blending strength (how much gamma it concentrates), persistence (how many snapshots it has held across), and isolation (how far it towers over the next wall).",
    },
  ],

  /* ── Technical concepts ──────────────────────────────────────────── */

  "vwap-trading-explained": [
    {
      question: "What is VWAP in trading?",
      answer:
        "VWAP (Volume-Weighted Average Price) is the average price weighted by volume for the session, representing where real institutional money changed hands. It resets daily and serves as the benchmark institutional desks use to judge execution quality.",
    },
    {
      question: "How do you trade using VWAP?",
      answer:
        "In range-bound sessions with positive GEX, fade moves away from VWAP for mean-reversion. On trending days, use VWAP as a trend filter: price staying on one side of VWAP confirms the trend, and pullbacks to VWAP that hold become continuation entries.",
    },
    {
      question: "Why do institutions use VWAP as a benchmark?",
      answer:
        "Portfolio managers judge execution quality against VWAP because it represents the true volume-weighted average where real money transacted, unlike simple averages that weight every candle equally regardless of how much trading actually occurred.",
    },
  ],

  "options-expiration-explained": [
    {
      question: "What happens when options expire?",
      answer:
        "In-the-money equity options are auto-exercised by the OCC and become stock positions, while index options like SPX settle in cash. Out-of-the-money options expire worthless, and the premium the buyer paid is lost while the seller keeps their credit.",
    },
    {
      question: "Why does options expiration affect stock prices?",
      answer:
        "As expiration approaches, gamma at at-the-money strikes explodes, forcing more aggressive dealer hedging that creates pinning effects, max pain pull, and potential gamma unwind when expiring contracts roll off and the stabilizing force disappears.",
    },
    {
      question: "How does 0DTE change options expiration?",
      answer:
        "With 0DTE contracts, every session is an expiration event. Theta decay that used to take a week compresses into hours, and the gamma effect is equally compressed, making intraday dealer positioning the dominant force rather than multi-day cycles.",
    },
  ],

  "how-to-read-options-chain": [
    {
      question: "How do you read an options chain?",
      answer:
        "Read the options chain by checking bid/ask spread for liquidity, comparing volume to open interest for new versus closing positions, noting IV skew across strikes for sentiment, and scanning the Greeks columns for delta exposure and theta decay.",
    },
    {
      question: "What does volume versus open interest tell you on an options chain?",
      answer:
        "When volume at a strike significantly exceeds open interest, new positions are being opened -- fresh directional bets. When volume is high but OI drops, existing positions are being closed, which is less meaningful as a forward-looking signal.",
    },
    {
      question: "How do you spot unusual activity on an options chain?",
      answer:
        "Look for volume exceeding open interest at specific strikes (new positions), sweep orders hitting the ask across multiple exchanges (urgency), and large block prints of 1,000+ contracts at or near the ask (institutional conviction).",
    },
  ],

  "open-interest-options-explained": [
    {
      question: "What is open interest in options?",
      answer:
        "Open interest (OI) is the total number of outstanding option contracts at a given strike and expiration. It increases when new positions are opened and decreases when positions are closed, mapping where dealer gamma concentrates.",
    },
    {
      question: "Why does open interest matter for options trading?",
      answer:
        "Large open interest at specific strikes is where dealer gamma concentrates, creating mechanical hedging pressure that forms call walls (resistance) and put walls (support) -- the direct link between chain data and the gamma levels that move markets.",
    },
    {
      question: "What does high volume with increasing open interest mean?",
      answer:
        "High volume with increasing open interest means new positions are being opened -- fresh directional or hedging bets. This is the strongest options activity signal, indicating new money entering with conviction at that specific strike.",
    },
  ],

  "vix-trading-guide": [
    {
      question: "What does the VIX measure?",
      answer:
        "The VIX measures the market's 30-day implied volatility expectation for the S&P 500, derived from SPX option prices. It tells you what option premiums suggest about expected future market movement, not what has already happened.",
    },
    {
      question: "What do different VIX levels mean for trading?",
      answer:
        "VIX below 15 signals complacency with cheap premiums, 15-20 is normal uncertainty, 20-30 indicates elevated fear with rich premiums, and above 30 is crisis territory where daily 3-5% moves become normal and premium selling carries enormous risk.",
    },
    {
      question: "How does VIX relate to dealer gamma exposure?",
      answer:
        "Rising VIX usually coincides with falling SPX prices pushing below the gamma flip into negative gamma, creating a feedback loop where dealer hedging amplifies declines, which pushes VIX higher, which forces more aggressive hedging.",
    },
  ],

  "pin-risk-options-explained": [
    {
      question: "What is pin risk in options?",
      answer:
        "Pin risk occurs when the underlying closes very near a short strike at expiration, creating assignment uncertainty. A difference of just pennies can mean the difference between no position and a large unexpected stock exposure.",
    },
    {
      question: "How do you avoid pin risk in options?",
      answer:
        "Avoid pin risk by closing short options before the final 30 minutes of the session, using cash-settled instruments like SPX that have no stock assignment, and avoiding short strikes at round numbers that carry the heaviest open interest.",
    },
    {
      question: "Why do stocks pin at certain strikes near expiration?",
      answer:
        "Stocks pin because gamma at the at-the-money strike becomes enormous near expiration, forcing dealers to buy as price dips below the strike and sell as it rises above, creating a gravitational pull toward strikes with heavy open interest.",
    },
  ],

  "options-volume-analysis": [
    {
      question: "How do you analyze options volume for trading signals?",
      answer:
        "Analyze options volume by reading ask% (above 60% signals buyer conviction), identifying sweep orders across multiple exchanges (urgency), spotting institutional block trades, and comparing volume to open interest to determine if positions are opening or closing.",
    },
    {
      question: "What is the difference between a sweep and a block trade in options?",
      answer:
        "A sweep order hits the ask price across multiple exchanges simultaneously for urgent execution, signaling conviction. A block trade is a single large print negotiated off the order book, signaling institutional size but not necessarily the same time urgency.",
    },
    {
      question: "What does ask percentage tell you about options flow?",
      answer:
        "Ask percentage measures the share of total volume that traded at or near the ask price. Above 60% on call flow is solidly bullish (buyers crossing the spread), while below 40% suggests selling or less urgency.",
    },
  ],

  "how-to-trade-spx-options": [
    {
      question: "How do you trade SPX options as a beginner?",
      answer:
        "Start by reading dealer positioning — gamma flip, GEX sign, and call/put walls — before picking direction. Then choose 0DTE or weekly structure, use defined-risk spreads, and size for SPX notional (one point is roughly ten SPY points).",
    },
    {
      question: "What is the difference between SPX and SPY options?",
      answer:
        "SPX is cash-settled European-style index options with favorable tax treatment for many accounts and enormous liquidity. SPY is ETF-settled with smaller notional per point. SPX dealer gamma is the dominant force on index sessions.",
    },
    {
      question: "Should you trade 0DTE or weekly SPX options?",
      answer:
        "Use 0DTE when you have a clear intraday regime read and can watch the position. Use weekly SPXW when you need more time for a thesis or want to sell premium via condors and credit spreads in a positive-GEX range.",
    },
  ],

  "market-maker-hedging-explained": [
    {
      question: "How do market makers hedge options?",
      answer:
        "Market makers delta hedge by buying or selling the underlying as price moves to stay neutral on the options they sold. That continuous mechanical flow creates gamma flip levels, call and put walls, and intraday pins on SPX.",
    },
    {
      question: "Why does market maker hedging move stock prices?",
      answer:
        "When aggregate dealer gamma is large, required hedge rebalancing happens at a scale that overwhelms discretionary flow. In positive gamma dealers dampen moves; in negative gamma they amplify them.",
    },
    {
      question: "What is the relationship between hedging and GEX?",
      answer:
        "GEX aggregates how much dealers must hedge across the chain. Positive GEX means hedging works against price; negative GEX means hedging works with price — the core regime read for index day trading.",
    },
  ],

  "best-0dte-trading-strategies": [
    {
      question: "What are the best 0DTE trading strategies?",
      answer:
        "The best 0DTE strategy depends on dealer gamma that day: fade walls in positive GEX above the flip, ride momentum below the flip in negative GEX, sell iron condors in tight positive-GEX ranges, and take one structured open scalp when gamma peaks.",
    },
    {
      question: "When should you fade vs follow on 0DTE?",
      answer:
        "Fade toward call and put walls when GEX is positive and spot is above the gamma flip. Follow momentum with directional spreads when GEX is negative and price sits below the flip — hedging accelerates the move.",
    },
    {
      question: "Is 0DTE iron condor a good strategy?",
      answer:
        "Iron condors work on 0DTE when walls bracket price, IV is elevated, and GEX is positive. Skip or cut size when gamma flips negative or a macro catalyst can break the range — short premium without a regime read is how 0DTE accounts blow up.",
    },
  ],

  /* ── Instruments & mechanics — FAQ coverage for the 6 articles that lacked it,
        targeting the real long-tail queries these pages already earn impressions for
        (Search Console, 90d). Answers are grounded in each article's own content. ── */

  "spx-vs-spy-options-explained": [
    {
      question: "Are SPX options cash settled?",
      answer:
        "Yes. SPX is an index, not a fund, so SPX options settle in cash at expiration — the in-the-money value is paid out and no shares change hands. SPY options settle in shares of the SPY ETF, which is why SPY can be assigned and SPX cannot.",
    },
    {
      question: "Are SPX options American or European style?",
      answer:
        "SPX options are European-style: they can only be exercised at expiration, so there is no early-assignment risk. SPY options are American-style and can be exercised — and therefore assigned — any time before expiration.",
    },
    {
      question: "What is the difference between SPX and SPXW?",
      answer:
        "SPXW denotes SPX Weeklys — the same cash-settled, European-style S&P 500 index options, but with weekly and daily expirations (including 0DTE) and PM settlement, versus the traditional AM-settled monthly SPX contract.",
    },
  ],

  "options-tax-treatment-1256": [
    {
      question: "What is the 60/40 rule for options taxes?",
      answer:
        "Under Section 1256, gains and losses are treated as 60% long-term and 40% short-term regardless of how long the position was held. This is educational only and not tax advice — rules are fact-specific and change, so confirm your own situation with a qualified tax professional.",
    },
    {
      question: "Which options qualify for Section 1256 treatment?",
      answer:
        "Broad-based index options such as SPX and SPXW generally qualify as Section 1256 contracts, as do futures options. Single-stock and ETF options — including SPY — generally follow standard capital-gains treatment instead. This is educational only, not tax advice.",
    },
  ],

  "options-assignment-exercise-explained": [
    {
      question: "When do options get assigned?",
      answer:
        "A short option is assigned whenever the long holder exercises. That is most common at or near expiration when the option is in-the-money, but American-style options can be assigned early — most often around ex-dividend dates or when deep in-the-money.",
    },
    {
      question: "What is the difference between exercise and assignment?",
      answer:
        "Exercise is the buyer's decision to invoke the contract; assignment is what happens to the seller when the buyer exercises. The buyer chooses; the seller has no say and simply finds out they have been assigned.",
    },
    {
      question: "Can you avoid being assigned?",
      answer:
        "Close the short position before it is exercised to remove the risk entirely. European-style, cash-settled index options (like SPX) cannot be assigned early at all — only at expiration.",
    },
  ],

  "wheel-strategy-cash-secured-puts": [
    {
      question: "How does the wheel strategy work?",
      answer:
        "Sell a cash-secured put; if the stock stays up, keep the premium and repeat. If you are assigned, you own the shares and sell covered calls against them for more premium; if the shares are called away, you restart with a put. It is a repeatable income loop that requires being willing to actually own the stock.",
    },
    {
      question: "Is the wheel strategy profitable?",
      answer:
        "The wheel generates steady premium income in flat-to-rising markets, but it carries the stock's full downside while you hold assigned shares — the premium collected rarely offsets a large drawdown, so it works best on names you are genuinely willing to own.",
    },
  ],

  "straddles-strangles-options-explained": [
    {
      question: "What is the difference between a straddle and a strangle?",
      answer:
        "A straddle buys a call and a put at the same strike, usually at-the-money. A strangle buys them at different out-of-the-money strikes — cheaper to put on, but it needs a bigger move to become profitable.",
    },
    {
      question: "When should you use a straddle?",
      answer:
        "Use a long straddle when you expect a large move but not its direction — around earnings or a known catalyst — and only when implied volatility is not already priced so rich that the expected move is fully baked in.",
    },
  ],

  "butterfly-spread-strategy-guide": [
    {
      question: "What is a butterfly spread?",
      answer:
        "A butterfly is a three-strike, defined-risk options structure — buy one, sell two, buy one at equally spaced strikes — that profits most when price pins at or near the middle strike by expiration. It is a lower-probability, higher-reward version of a premium-selling range trade.",
    },
    {
      question: "What is the maximum profit on a butterfly spread?",
      answer:
        "Maximum profit occurs if the underlying closes exactly at the middle (short) strike at expiration. It equals the distance between adjacent strikes minus the net debit paid to open the position; the most you can lose is that net debit.",
    },
  ],
};

/**
 * Retrieve the FAQ items for a given article slug.
 * Returns an empty array when no FAQs are defined (the caller can skip rendering).
 */
export function getArticleFaqs(slug: string): { question: string; answer: string }[] {
  return ARTICLE_FAQS[slug] ?? [];
}
