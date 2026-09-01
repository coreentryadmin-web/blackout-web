import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { NightHawkDeskThemeProvider } from "@/features/nighthawk/components/NightHawkDeskThemeProvider";
import { NightHawkDeskThemeToggle } from "@/features/nighthawk/components/NightHawkDeskThemeToggle";
import { VectorPickLogBoard } from "@/features/nighthawk/components/VectorPickLogBoard";
import { VECTOR_BOARD_DEV_FIXTURE } from "@/features/nighthawk/lib/vector-board-dev-fixture";
import "../nighthawk-v2.css";
import "../nighthawk-desk-theme.css";
import "../vector-board-controls.css";

export const metadata: Metadata = {
  title: "Vector Board Preview (dev)",
  robots: { index: false, follow: false },
};

/**
 * Local UI preview — no Clerk, no DB. Visit /vector-board-preview while `npm run dev` is running.
 * Returns 404 in production builds.
 */
export default function VectorBoardPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <NightHawkDeskThemeProvider>
      <div className="nh-v2-page nighthawk-page-shell nighthawk-page-shell-fill flex min-h-screen flex-col bg-[#060608]">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-2">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-amber-300">
              Dev preview · fixture data
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-sky-200/70">
              Open <code className="rounded bg-white/5 px-1">http://localhost:3000/vector-board-preview</code>{" "}
              while <code className="rounded bg-white/5 px-1">npm run dev</code> is running — no Clerk or DB needed.
            </p>
          </div>
          <NightHawkDeskThemeToggle />
        </header>
        <main className="flex min-h-0 flex-1 flex-col px-3 py-3">
          <VectorPickLogBoard fixtureData={VECTOR_BOARD_DEV_FIXTURE} />
        </main>
      </div>
    </NightHawkDeskThemeProvider>
  );
}
