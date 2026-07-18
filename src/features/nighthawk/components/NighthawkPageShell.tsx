"use client";

import { clsx } from "clsx";
import { PageShell, PageHeader } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { NightHawkFeed } from "@/features/nighthawk/components/NightHawkFeed";
import { NighthawkRadarBackdrop } from "@/features/nighthawk/components/NighthawkRadarBackdrop";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";

/** /nighthawk page frame — radar ambient + v2 column polish. */
export function NighthawkPageShell() {
  const nativeShell = useIosNativeShell();

  return (
    <PageShell
      fullBleed
      contentClassName={clsx(nativeShell ? "nighthawk-page-content-native !py-0" : "!py-0")}
      className={clsx(
        "ios-native-page ios-native-page-nighthawk nh-v2-page nighthawk-page-shell",
        nativeShell && "nighthawk-page-shell-native"
      )}
    >
      {!nativeShell && <NighthawkRadarBackdrop />}
      <div
        className={clsx(
          "nighthawk-page-root flex max-w-none flex-col",
          nativeShell
            ? "nighthawk-page-inner-native min-h-[calc(100dvh-var(--ios-header-offset)-var(--ios-tab-offset))]"
            : "min-h-[calc(100svh-var(--nav-offset)-var(--ios-tab-offset,0px))] px-2 pb-4 pt-4 md:px-3"
        )}
      >
        {!nativeShell && (
          <PageHeader
            kicker="Overnight playbook"
            title="Night Hawk"
            subtitle="Tomorrow's ranked setups — published after the close, ready before the open."
            badge={<ProductMark product="nighthawk" size={44} animated={false} />}
            className="nh-v2-page-header mb-3 shrink-0 [&_p]:text-sky-300"
          />
        )}
        <NightHawkFeed />
      </div>
    </PageShell>
  );
}
