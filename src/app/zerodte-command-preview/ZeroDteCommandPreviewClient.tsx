"use client";

import { useMemo } from "react";
import { NightHawkDeskThemeProvider } from "@/features/nighthawk/components/NightHawkDeskThemeProvider";
import { NightHawkDeskThemeToggle } from "@/features/nighthawk/components/NightHawkDeskThemeToggle";
import { CommandDeck } from "@/features/nighthawk/command-deck/CommandDeck";
import { terminalPlayFromZeroDte } from "@/features/nighthawk/command-deck/adapters";
import { zeroDteSources } from "@/features/nighthawk/command-deck/zerodte-sources";
import { ZERODTE_COMMAND_DEV_FIXTURE } from "@/features/nighthawk/lib/zerodte-command-dev-fixture";
import { NIGHTHAWK_COMPACT_LANE_LABEL } from "@/features/nighthawk/lib/nighthawk-view";

export function ZeroDteCommandPreviewClient() {
  const plays = useMemo(
    () => zeroDteSources(ZERODTE_COMMAND_DEV_FIXTURE).map(terminalPlayFromZeroDte),
    [],
  );

  return (
    <NightHawkDeskThemeProvider>
      <div className="nh-v2-page nighthawk-page-shell flex min-h-screen flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[color:var(--nh-desk-border,#ffffff1a)] px-4 py-2">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-amber-500">
              Dev preview · 0DTE Command deck
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-[color:var(--nh-desk-text-secondary,#94a3b8)]">
              Session stats strip · gate blocks · Vector cross-links — fixture data, no auth.
            </p>
          </div>
          <NightHawkDeskThemeToggle />
        </header>
        <main className="min-h-0 flex-1 p-2">
          <CommandDeck
            plays={plays}
            laneLabel={NIGHTHAWK_COMPACT_LANE_LABEL.ZERO_DTE}
            commandCenter
            deckHorizon="ZERO_DTE"
            sessionHeat="ACTIVE"
            boardAsOf={ZERODTE_COMMAND_DEV_FIXTURE.as_of ?? null}
            upstreamOk
            marketState={ZERODTE_COMMAND_DEV_FIXTURE.market_state ?? null}
            discoveryFunnel={ZERODTE_COMMAND_DEV_FIXTURE.discovery_funnel ?? null}
            sessionStats={ZERODTE_COMMAND_DEV_FIXTURE.session_stats ?? null}
            emptyHint="Fixture board empty."
          />
        </main>
      </div>
    </NightHawkDeskThemeProvider>
  );
}
