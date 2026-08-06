"use client";

import { clsx } from "clsx";
import { PageShell, PageHeader, FreshnessChip } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { NightHawkFeed } from "@/features/nighthawk/components/NightHawkFeed";
import { NighthawkRadarBackdrop } from "@/features/nighthawk/components/NighthawkRadarBackdrop";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";
import type { NightHawkSeedProps } from "@/features/nighthawk/lib/nighthawk-seed-props";

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
            : "min-h-0 flex-1 px-2 pb-4 pt-4 md:px-3"
        )}
      >
        {!nativeShell && (
          <PageHeader
            kicker="Overnight playbook"
            title="Night Hawk"
            badge={
              <span className="flex items-center gap-2">
                <ProductMark product="nighthawk" size={44} animated={false} />
                <FreshnessChip status="live" label="Night Hawk" />
              </span>
            }
            className="nh-v2-page-header mb-3 shrink-0 [&_.t-kicker]:font-bold [&_.t-kicker]:text-sky-300"
          />
        )}
        <NightHawkFeed seed={seed ?? null} />
      </div>
    </PageShell>
  );
}
