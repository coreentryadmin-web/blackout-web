"use client";

import dynamic from "next/dynamic";
import { clsx } from "clsx";
import { PageShell } from "@/components/ui";
import { NighthawkRadarBackdrop } from "@/features/nighthawk/components/NighthawkRadarBackdrop";
import { NightHawkLoadingSkeleton } from "@/features/nighthawk/components/NightHawkLoadingSkeleton";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";
import type { NightHawkSeedProps } from "@/features/nighthawk/lib/nighthawk-seed-props";

const NightHawkFeed = dynamic(
  () =>
    import("@/features/nighthawk/components/NightHawkFeed").then((m) => m.NightHawkFeed),
  {
    ssr: false,
    loading: () => <NightHawkLoadingSkeleton />,
  }
);

/** /nighthawk page frame — radar ambient + v2 column polish. */
export function NighthawkPageShell({ seed }: { seed?: NightHawkSeedProps | null }) {
  const nativeShell = useIosNativeShell();

  return (
    <PageShell
      fullBleed
      contentClassName={clsx(
        nativeShell
          ? "nighthawk-page-content-native !py-0"
          : "nighthawk-page-content !py-0 flex min-h-0 flex-1 flex-col"
      )}
      className={clsx(
        "ios-native-page ios-native-page-nighthawk nh-v2-page nighthawk-page-shell",
        nativeShell ? "nighthawk-page-shell-native" : "nighthawk-page-shell-fill"
      )}
    >
      {!nativeShell && <NighthawkRadarBackdrop />}
      <div
        className={clsx(
          "nighthawk-page-root flex max-w-none flex-col",
          nativeShell
            ? "nighthawk-page-inner-native min-h-[calc(100dvh-var(--ios-header-offset)-var(--ios-tab-offset))]"
            : "min-h-0 flex-1 px-2 py-4 md:px-3"
        )}
      >
        {/* PageHeader (kicker "Overnight playbook" + duplicate "Night Hawk" title + a THIRD
            "Night Hawk" label on the FreshnessChip badge) removed per explicit product direction
            (2026-08-28): the page's own top nav already reads BLACKOUT, and the view toggle
            immediately below already identifies the system (0DTE/Swings/Bangers/Vector/Legacy) —
            three redundant labels for the same fact pushed the actual trade queue below the
            fold. The global nav already carries the page identity; nothing here replaces it. */}
        <NightHawkFeed seed={seed ?? null} />
      </div>
    </PageShell>
  );
}
