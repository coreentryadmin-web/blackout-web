"use client";

import { clsx } from "clsx";
import { PageShell } from "@/components/ui";
import { Heatmap } from "@/features/thermal/components/Heatmap";
import { IosIntelligenceHubSegment } from "@/components/ios/IosIntelligenceHubSegment";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";

/** /heatmap page frame — full desk on web; compact native iOS shell. */
export function ThermalPageShell() {
  const nativeShell = useIosNativeShell();

  return (
    <PageShell
      fullBleed
      className={clsx(
        "ios-native-page ios-native-page-thermal thermal-page-shell",
        nativeShell && "thermal-page-shell-native"
      )}
      contentClassName={clsx(
        nativeShell ? "thermal-page-content-native !py-0" : "!py-1 md:!py-2"
      )}
    >
      <div
        className={clsx(
          "thermal-page-inner",
          nativeShell ? "thermal-page-inner-native" : "px-4 md:px-6"
        )}
      >
        <IosIntelligenceHubSegment />
        <div className={nativeShell ? "mt-0" : "mt-1"}>
          <Heatmap nativeShell={nativeShell} />
        </div>
      </div>
    </PageShell>
  );
}
