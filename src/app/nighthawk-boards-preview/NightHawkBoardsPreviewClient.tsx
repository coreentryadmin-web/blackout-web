"use client";

import { NightHawkDeskThemeProvider } from "@/features/nighthawk/components/NightHawkDeskThemeProvider";
import { NightHawkDeskThemeToggle } from "@/features/nighthawk/components/NightHawkDeskThemeToggle";
import { VectorPickLogBoard } from "@/features/nighthawk/components/VectorPickLogBoard";
import { LegacyPickLogBoard } from "@/features/nighthawk/components/LegacyPickLogBoard";
import { VECTOR_BOARD_DEV_FIXTURE } from "@/features/nighthawk/lib/vector-board-dev-fixture";
import {
  LEGACY_BOARD_DEV_PLAYS,
  LEGACY_BOARD_DEV_SESSION,
} from "@/features/nighthawk/lib/legacy-board-dev-fixture";
import { legacyEditionSessionDates } from "@/features/nighthawk/lib/legacy-board-calendar";

export function NightHawkBoardsPreviewClient() {
  const calendarDates = legacyEditionSessionDates(14);

  return (
    <NightHawkDeskThemeProvider>
      <div className="nh-v2-page nighthawk-page-shell flex min-h-screen flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[color:var(--nh-desk-border,#ffffff1a)] px-4 py-2">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-amber-500">
              Dev preview · Vector vs Legacy X Ads parity
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-[color:var(--nh-desk-text-secondary,#94a3b8)]">
              Fixture data — same toolbar, table, scorecard, calendar, and detail rail shell.
            </p>
          </div>
          <NightHawkDeskThemeToggle />
        </header>
        <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 xl:grid-cols-2">
          <section className="flex min-h-[70vh] min-w-0 flex-col rounded-lg border border-white/10">
            <h2 className="shrink-0 border-b border-white/10 px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-sky-200">
              Vector · X Ads table
            </h2>
            <div className="flex min-h-0 flex-1 flex-col">
              <VectorPickLogBoard fixtureData={VECTOR_BOARD_DEV_FIXTURE} />
            </div>
          </section>
          <section className="flex min-h-[70vh] min-w-0 flex-col rounded-lg border border-white/10">
            <h2 className="shrink-0 border-b border-white/10 px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-sky-200">
              Legacy · X Ads table
            </h2>
            <div className="flex min-h-0 flex-1 flex-col">
              <LegacyPickLogBoard
                plays={LEGACY_BOARD_DEV_PLAYS}
                editionFor={LEGACY_BOARD_DEV_SESSION}
                editionLabel={LEGACY_BOARD_DEV_SESSION}
                todaySession={LEGACY_BOARD_DEV_SESSION}
                selectedEditionDate={null}
                onSelectedEditionDateChange={() => undefined}
                calendarDates={calendarDates}
              />
            </div>
          </section>
        </main>
      </div>
    </NightHawkDeskThemeProvider>
  );
}
