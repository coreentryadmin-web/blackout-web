import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { WebPageJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";
import { TrackRecordEmbed } from "@/components/embeds/TrackRecordEmbed";
import { buildPublicTrackRecord } from "@/lib/track-record-public";

// Public track record — re-published 2026-08 after a period as admin-only.
// Reuses buildPublicTrackRecord(), the same aggregation the internal premium
// desk reads, so this number can never disagree with what members see.
// See docs/marketing/SEO-GROWTH.md finding #2 for the full rationale.
export const dynamic = "force-dynamic";

export const metadata: Metadata = publicPageMetadata(
  "SPX Track Record — Every Play Graded A–F | BlackOut",
  "BlackOut's live SPX 0DTE track record: every closed play graded A-F, logged the moment it closes. Win rate and counts, wins and losses both — no cherry-picked highlight reel.",
  "/track-record"
);

export default async function TrackRecordPage() {
  const record = await buildPublicTrackRecord();

  return (
    <MarketingPageShell showChart={false}>
      <WebPageJsonLd
        title="SPX Track Record — BlackOut Trades"
        description="Live, public SPX 0DTE track record — every graded play logged, wins and losses both."
        path="/track-record"
      />
      <Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "Track Record", href: "/track-record" },
      ]} />

      <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
        <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-300">
          Track Record
        </p>
        <h1 className="font-syne text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl">
          The graded record, in the open.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-secondary sm:text-lg">
          Every SPX Slayer play is logged the moment it closes — scored by its original
          grade, wins and losses both. Not a highlight reel. This is the exact aggregation
          the premium desk itself reads.
        </p>

        <div className="mt-10 max-w-md">
          <TrackRecordEmbed record={record} />
        </div>

        <p className="mt-8 max-w-2xl font-mono text-xs leading-relaxed text-sky-300/70">
          Aggregate counts only — no per-trade prices, dates, or entries are published here
          (that level of detail is reserved for members). Past performance does not
          guarantee future results; this is not financial advice.
        </p>

        <div className="mt-10 flex flex-wrap gap-4">
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
