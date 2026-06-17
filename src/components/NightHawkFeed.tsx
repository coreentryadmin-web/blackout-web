"use client";

import useSWR from "swr";
import { fetchNightHawkPlays } from "@/lib/api";
import { EngineStatusBar } from "@/components/desk/EngineStatusBar";
import { NightHawkRadar } from "@/components/desk/NightHawkRadar";
import { NightHawkEmbeds } from "@/components/embeds/NightHawkEmbeds";
import { PlatformEmpty } from "@/components/platform/PlatformEmpty";

export function NightHawkFeed() {
  const { data, isLoading, error } = useSWR("nighthawk", fetchNightHawkPlays, {
    refreshInterval: 60_000,
  });

  const plays = data?.plays ?? [];
  const live = !error;

  return (
    <div className="desk-layout space-y-5">
      <EngineStatusBar />
      <NightHawkEmbeds />

      {isLoading ? (
        <div className="grid md:grid-cols-3 gap-4 animate-pulse">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-48 bg-grey-900/80 rounded" />
          ))}
        </div>
      ) : plays.length === 0 ? (
        <PlatformEmpty
          variant="nighthawk"
          title="NO ACTIVE PLAYS"
          description="Night Hawk scans every 20 minutes during RTH. Swing dossiers drop when setups qualify."
        />
      ) : (
        <NightHawkRadar plays={plays} live={live} />
      )}
    </div>
  );
}
