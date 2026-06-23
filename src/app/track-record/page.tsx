import type { Metadata } from "next";
import { TrackRecordEmbed } from "@/components/embeds/TrackRecordEmbed";
import { buildPublicTrackRecord } from "@/lib/track-record-public";
import { SITE } from "@/lib/site";

// Public page (NOT in middleware isProtectedRoute => no auth). Live aggregate.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const r = await buildPublicTrackRecord();
  const headline = r.available
    ? `${r.win_rate_pct}% win rate across ${r.total_closed} verified SPX plays`
    : `${SITE.name} — SPX Sniper track record`;
  return {
    title: `Track Record — ${SITE.name}`,
    description: headline,
    alternates: { canonical: `${SITE.url}/track-record` },
    openGraph: {
      title: `${SITE.name} — SPX Sniper Track Record`,
      description: headline,
      url: `${SITE.url}/track-record`,
      siteName: SITE.name,
    },
    twitter: {
      card: "summary_large_image",
      title: `${SITE.name} — SPX Sniper Track Record`,
      description: headline,
    },
  };
}

export default async function TrackRecordPage() {
  const record = await buildPublicTrackRecord();
  const embedSnippet = `<iframe src="${SITE.url}/embed/track-record" width="420" height="520" frameborder="0" style="border:0;border-radius:12px;" title="BlackOut SPX Track Record"></iframe>`;

  return (
    <main className="page-shell px-4 py-16 flex flex-col items-center">
      <div className="w-full max-w-md">
        <p className="font-mono text-[10px] tracking-[0.4em] text-bull uppercase mb-3 text-center">
          Verified Performance
        </p>
        <h1 className="font-anton text-3xl text-white text-center mb-8 leading-tight">
          The numbers, public &amp; unedited
        </h1>
        <TrackRecordEmbed record={record} />

        <div className="mt-8">
          <p className="font-mono text-[10px] tracking-widest uppercase text-sky-300 mb-2">
            Embed this card
          </p>
          <pre className="text-[10px] font-mono text-cyan-400 bg-black/60 border border-border rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">
{embedSnippet}
          </pre>
        </div>
      </div>
    </main>
  );
}
