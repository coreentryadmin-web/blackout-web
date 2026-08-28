import type { ReactNode } from "react";
"use client";

import Link from "next/link";
import { MarkdownBody } from "@/components/learn/MarkdownBody";

const BODY = `You've got options when it comes to options tools. Here's the honest case for this one — no hype, just what BlackOut does differently and why it matters.

## The problem with most trading tools

Most platforms give you *more*: more indicators, more alerts, more data to drown in. But more inputs don't make you a better trader — they make you a busier one. What actually moves the needle is knowing the one thing that drives the market intraday, and acting only when the odds are on your side. That's the entire design philosophy behind BlackOut.

## 1. You see what the desks see

Retail traders watch price. Professional desks watch dealer positioning — the hedging flows that pin the market at some levels and send it flying through others. BlackOut Thermal maps that live: the gamma flip, the call wall, the put wall, updated tick by tick. It's the same lens the institutions trade through, on your screen, before the bell. *(New to this? Start with [What Is Dealer Gamma Exposure?](/learn/what-is-dealer-gamma-exposure))*

## 2. Signal, not noise

Our engine scans **12,400+ contracts daily** and grades every setup **A–F**. Only the highest-conviction setups make it through our filters. You don't get forty alerts a day to sift through — you get the handful that actually passed. In a world of information overload, ruthless filtering is the feature.

## 3. We log every trade publicly

This is the one most tools won't do. Every setup BlackOut flags is logged publicly, with full transparency — **including the ones that don't work.** No hindsight edits, no quietly deleted losers, no cherry-picked wins in a screenshot. If you want to know how the calls actually played out, the record is right there — see the [public grading methodology & live stats](/methodology). That accountability is rare in this space, and it's on purpose.

## 4. No lock-in, no routing

BlackOut is intelligence, not a brokerage. There's no broker lock-in and no order routing — you trade in your own account, on your own terms. We give you the read; you pull the trigger.

## 5. Built for how you actually trade

Six tools, one desk: **SPX Slayer** (0DTE desk), **HELIX** (institutional flow), **BlackOut Thermal** (dealer gamma heatmap), **Largo** (AI desk analyst), **Night Hawk** (swing setups), and **Vector** (cross-ticker radar). Start with just the 0DTE desk, or run the full stack — it scales to how you trade.

## Who it's for (and who it isn't)

BlackOut is built for SPX, 0DTE, and swing traders who want to trade *structure* instead of guessing — people willing to wait for an edge rather than force a trade. If you want a bot that promises guaranteed wins, this isn't that, and it never will be. If you want the same positioning data the desks use and an honest public record, you're in the right place.

## Start where it makes sense

The 0DTE desk starts at **$49/month**, or get all six modules plus the community from **$199/month**. Cancel anytime — no contracts.

> *BlackOut provides educational tools and market analysis only and does not provide investment advice. Options and equities trading involve substantial risk and are not suitable for every investor.*`;

export function WhyBlackoutContent({ breadcrumbs }: { breadcrumbs?: ReactNode }) {
  return (
    <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
      {breadcrumbs}
      <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-300">
        Why BlackOut
      </p>
      <h1 className="font-syne text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl">
        Why BlackOut?
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-secondary sm:text-lg">
        Why traders choose BlackOut: live dealer gamma, A–F graded 0DTE setups, and every trade logged publicly.
      </p>

      <div className="mt-12">
        <MarkdownBody content={BODY} />
      </div>

      <div className="mt-12 flex flex-wrap gap-4">
        <Link
          href="/pricing"
          className="inline-flex items-center rounded-lg bg-cyan-400 px-6 py-3 font-mono text-sm font-semibold text-black transition hover:bg-cyan-300"
        >
          See the plans →
        </Link>
        <Link
          href="/learn/dealer-gamma-options-flow-guide"
          className="inline-flex items-center rounded-lg border border-white/20 px-6 py-3 font-mono text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/5"
        >
          Explore the Academy →
        </Link>
      </div>
    </section>
  );
}
