> **kind:** FINDING

## Learn docs: execution-language overclaim on the 0DTE time stop, absolute freshness claims, and two residual internal-name leaks — FIXED

| **Status** | Fixed in this PR |

**Execution-language overclaim (the main finding):** two Learn articles described BlackOut's own
15:30 ET 0DTE time stop as literally executing a trade: "the 15:30 ET time stop **closes all
0DTE positions** 30 minutes before the 4:00 PM close" (Pin Risk guide) and "Any open 0DTE
position **is closed** by 3:30 PM Eastern" (theta-risk guide). BlackOut is analytics-only — no
order routing, no broker execution (the homepage says so explicitly: "No order routing, no
broker lock-in — pure intelligence delivered to your screen") — so it can only mark a TRACKED
play closed in its own ledger and alert the member; it cannot literally close a position at
their broker. Reworded both to "BlackOut marks [the play] closed ... and alerts you to exit at
your own broker."

**Also investigated, found NOT a genuine contradiction:** a QA report worried the Pin Risk
article's "you are never holding a short equity option" sentence contradicted the 0DTE Command
guide's description of long-premium directional plays (calls/puts, -50%/+100% rules). Verified
against `src/lib/zerodte/plan.ts` (direction is bearish/bullish bias via buying puts/calls, never
a sold option) and `src/lib/zerodte/terminal-ladder.ts` (the time-stop logic only marks a
tracked play's grading outcome, never routes an order) — Night Hawk's own committed plays are
never short equity options, so there was no real strategy contradiction. The Pin Risk sentence
was genuinely confusing (it read as describing BlackOut's own plays when it was really general
options-education advice), so it was rewritten to explicitly separate "BlackOut's own tracked
plays are long-premium, so this risk never applies to them" from "if you also trade equity 0DTE
directly, the same time-stop discipline protects you."

**Absolute freshness claims:** "Live, tick-by-tick — zero delay" (homepage, `/vs/others`) and
"update the instant the market moves ... never a stale snapshot" (FAQ) contradict the platform's
own Risk Disclaimer ("third-party market data may be delayed, inaccurate, or incomplete").
Reworded to "real-time streaming where the underlying feed supports it" with a pointer to the
visible freshness indicator, rather than promising zero delay / instant / never-stale.

**Two residual internal-component-name leaks** missed by the earlier vocabulary-leak pass
(#3312): `KeyLevelBox` (Using Thermal for Strike Selection guide) → "Key Levels panel";
`TickerDrawer` (HELIX flow scanner guide) → "ticker detail view". Found via re-running the same
regex sweep (`\b[A-Z][a-zA-Z]*(Rail|Panel|Strip|...)\b`) against the merged `main`, which turned
up two hits the first pass's manual section-by-section read didn't catch.

**Also fixed, same theme:** two more hardcoded "6 engines"/"6 live engines" literals
(`RedesignHome.tsx`'s "them vs us" list, `/vs/others`'s comparison table) now derive from
`MARKETING_PRODUCTS.length`, same pattern as #3317's fix to the homepage headline.

**Test:** `src/lib/learn/no-execution-claims.test.ts` (new) — regression-guards the exact broken
phrasing (deliberately narrow: a broad "closes...position" heuristic false-positives on ordinary
options-education prose like "SPY closes at $550.02"); verified fails pre-fix / passes post-fix.
`articles.test.ts`, `guide-seo.test.ts`, `faq/content.test.ts`, `RedesignHome.seo.test.ts`,
`marketing-hash-nav.test.ts` (24 tests total) still pass. `npx tsc --noEmit`: clean.
