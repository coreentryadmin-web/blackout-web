import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { WebPageJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";
import { MarkdownBody } from "@/components/learn/MarkdownBody";

export const metadata: Metadata = publicPageMetadata(
  "About BlackOut Trades | Options Analytics Platform",
  "BlackOut Trades maps dealer gamma exposure, options flow, and dark pool activity to give traders the positioning picture the desks trade on. Analytics and education only.",
  "/about"
);

/* ---------------------------------------------------------------------------
 * Content body (markdown rendered by the shared MarkdownBody component)
 * Same inline-content pattern as WhyBlackoutContent.
 * -------------------------------------------------------------------------*/

const WHAT_WE_DO = `BlackOut Trades is an options analytics platform built on one idea: the data that moves the market should be available to everyone, not just the desks.

We map **dealer gamma exposure**, **institutional options flow**, and **dark pool activity** into a single positioning picture — the same lens professional desks trade through. Then we grade every setup, log every outcome publicly, and explain the reasoning in plain language. No black boxes, no hidden ledgers.

We are **not a broker**. BlackOut does not execute trades, route orders, or manage money. Everything on the platform is analytics and education — you make your own decisions in your own account.`;

const TOOLS = `## The Tools

Seven modules, one desk — use them individually or together:

- **SPX Slayer** — The 0DTE command center. Live dealer gamma, A–F graded setups, and real-time positioning for same-day SPX options. Starts at $49/month.
- **Thermal** — GEX, VEX, DEX, and CHARM heatmaps that show where dealer hedging will accelerate or dampen price movement.
- **HELIX** — Institutional flow scanner. Surfaces unusual activity, block prints, and dark pool transactions so you see what the smart money is doing.
- **Night Hawk** — Overnight playbook plus an intraday 0DTE scanner. Identifies setups before the bell and tracks them through the session.
- **Largo AI** — An AI desk analyst that synthesizes positioning, flow, and structure into actionable context.
- **Vector** — Cross-ticker gamma scanner that finds names where dealer positioning is setting up the next move.
- **Meridian** — Earnings intelligence: expected move, historical reaction, and positioning ahead of every print.

All seven ship with Premium ($199/month or $1,999/year). [See all plans](/pricing).`;

const APPROACH = `## Our Approach

**Data-driven, not opinion-driven.** Every number on the desk comes from verifiable market data feeds and our own models built on top of them. When the data says sit, we sit.

**Transparent track records.** Every setup BlackOut flags is logged publicly, graded, and time-stamped — including the losers. See the [public grading methodology & live stats](/methodology) for how each product is scored. No hindsight edits, no deleted trades, no cherry-picked screenshots. The record speaks for itself.

**Education-first.** Options are complex. We publish a full [Learning Academy](/learn) — from [getting started](/learn/getting-started) to a deep [dealer gamma and options flow guide](/learn/dealer-gamma-options-flow-guide) — because an informed trader makes better decisions than a subscriber who just follows alerts.`;

const DISCLAIMER = `## Not Financial Advice

BlackOut Trades provides educational tools and market analysis only. Nothing on the platform constitutes investment advice, a recommendation to trade, or an offer to buy or sell securities. Options and equities trading involve substantial risk of loss and are not suitable for every investor. Past performance of any setup, grade, or signal does not guarantee future results. Always do your own research and consult a licensed financial professional before trading.`;

export default function AboutPage() {
  return (
    <MarketingPageShell>
      <WebPageJsonLd
        title="About BlackOut Trades"
        description="Options analytics platform mapping dealer gamma exposure, options flow, and dark pool activity."
        path="/about"
      />

      <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
        <Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "About", href: "/about" },
      ]} />
        <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-300">
          About
        </p>
        <h1 className="font-syne text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl">
          About BlackOut Trades
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-secondary sm:text-lg">
          The positioning picture the desks trade on — now on your screen.
        </p>

        <div className="mt-12 space-y-10">
          <MarkdownBody content={WHAT_WE_DO} />
          <MarkdownBody content={TOOLS} />
          <MarkdownBody content={APPROACH} />
          <MarkdownBody content={DISCLAIMER} />
        </div>

        <div className="mt-12 flex flex-wrap gap-4">
          <Link
            href="/pricing"
            className="inline-flex items-center rounded-lg bg-cyan-400 px-6 py-3 font-mono text-sm font-semibold text-black transition hover:bg-cyan-300"
          >
            See the plans →
          </Link>
          <Link
            href="/learn/getting-started"
            className="inline-flex items-center rounded-lg border border-white/20 px-6 py-3 font-mono text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/5"
          >
            Get started →
          </Link>
        </div>
      </section>
    </MarketingPageShell>
  );
}
