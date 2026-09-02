import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPageShell } from "@/components/landing/MarketingPageShell";
import { WebPageJsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { publicPageMetadata } from "@/lib/page-metadata";
import { MEMBERSHIP_PRICING, usd } from "@/lib/pricing";

export const metadata: Metadata = publicPageMetadata(
  "BlackOut vs Other Options Trading Platforms",
  "How BlackOut compares to typical options-analytics platforms: live tick-by-tick data vs delayed snapshots, graded track record vs cherry-picked alerts, one desk vs scattered tabs and Discords.",
  "/vs/others"
);

type Row = { feature: string; blackout: string; others: string };

// Same claims as the homepage's "them vs us" section (sec-edge) — general,
// defensible statements about how this category of tool typically works,
// not claims about any specific named competitor.
const ROWS: Row[] = [
  { feature: "Data freshness", blackout: "Live tick-by-tick — quote age shown on every read", others: "Delayed snapshots, manual refresh" },
  { feature: "Alert accountability", blackout: "Every setup graded A–F with a logged track record", others: "Cherry-picked alerts, no receipts" },
  { feature: "Where the tools live", blackout: "6 engines, one screen, one membership", others: "Scattered across 5 tabs and 3 Discords" },
  { feature: "Entry verification", blackout: "AI verification engine gates every play", others: "Gut-feel callouts, no grading" },
  { feature: "Underlying data", blackout: "Institutional flow, GEX, dark pool — streamed live", others: "Stale data repackaged as “signals”" },
  { feature: "Reporting cadence", blackout: "Real-time P&L marks, not end-of-day summaries", others: "Monthly PDF recaps" },
  { feature: "Entry price", blackout: usd(MEMBERSHIP_PRICING.community) + "/mo (SPX Slayer)", others: "Varies — often $99–$300+/mo for a comparable single-lens tool" },
];

export default function VsOthersPage() {
  return (
    <MarketingPageShell showChart={false}>
      <WebPageJsonLd
        title="BlackOut vs Other Options Trading Platforms"
        description="How BlackOut compares to typical options-analytics platforms for traders."
        path="/vs/others"
      />

      <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
        <Breadcrumbs items={[
        { name: "Home", href: "/" },
        { name: "BlackOut vs Others", href: "/vs/others" },
      ]} />
        <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.25em] text-cyan-300">
          Comparison
        </p>
        <h1 className="font-syne text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl">
          Built like a trading desk. Not a Discord server.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-secondary sm:text-lg">
          Most options-analytics tools give you one lens, delayed, in a tab you have to
          remember to check. Here&apos;s the actual difference.
        </p>

        <div className="mt-10 overflow-x-auto rounded-2xl border border-white/[0.08] bg-[#050608]/60 backdrop-blur-md">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/[0.08]">
                <th className="px-5 py-4 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
                  Feature
                </th>
                <th className="px-5 py-4 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-300">
                  BlackOut
                </th>
                <th className="px-5 py-4 text-left font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
                  Everywhere else
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, i) => (
                <tr
                  key={row.feature}
                  className={i < ROWS.length - 1 ? "border-b border-white/[0.04]" : ""}
                >
                  <td className="px-5 py-3.5 text-white/90">{row.feature}</td>
                  <td className="px-5 py-3.5 text-white/80">{row.blackout}</td>
                  <td className="px-5 py-3.5 text-white/60">{row.others}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 font-mono text-[11px] leading-relaxed text-sky-300/60">
          General category comparison, not a claim about any specific named competitor —
          pricing and features vary by platform; verify current details directly with
          whichever tool you&apos;re evaluating.
        </p>

        <div className="mt-12 flex flex-wrap gap-4">
          <Link
            href="/pricing"
            className="inline-flex items-center rounded-lg bg-cyan-400 px-6 py-3 font-mono text-sm font-semibold text-black transition hover:bg-cyan-300"
          >
            See BlackOut plans →
          </Link>
          <Link
            href="/why-blackout"
            className="inline-flex items-center rounded-lg border border-white/20 px-6 py-3 font-mono text-sm font-semibold text-white transition hover:border-white/40 hover:bg-white/5"
          >
            Why BlackOut →
          </Link>
        </div>

        <p className="mt-10 font-mono text-[11px] leading-relaxed text-sky-300/50">
          Educational and informational only — not financial advice.
        </p>
      </section>
    </MarketingPageShell>
  );
}
