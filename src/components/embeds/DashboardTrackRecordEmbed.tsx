"use client";

import useSWR from "swr";
import { TrackRecordEmbed } from "@/components/embeds/TrackRecordEmbed";
import { emptyTrackRecord, type PublicTrackRecord } from "@/lib/track-record-public";

// Client wrapper that fetches the PUBLIC aggregate track record and renders the
// shared presentational card. Referenced by DashboardEmbeds.tsx. Aggregate,
// PII-free data only — same payload as the public /track-record page.
export function DashboardTrackRecordEmbed({ className }: { className?: string }) {
  const { data } = useSWR<PublicTrackRecord>(
    "/api/public/track-record",
    (url: string) => fetch(url, { cache: "no-store" }).then((r) => r.json()),
    { refreshInterval: 300_000, revalidateOnFocus: false }
  );

  return <TrackRecordEmbed record={data ?? emptyTrackRecord()} className={className} />;
}

export default DashboardTrackRecordEmbed;
