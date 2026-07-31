"use client";

import { usePathname, useRouter } from "next/navigation";
import { IosNativeSegment } from "@/components/ios/IosNativeSegment";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";
import { isIosIntelligenceHubPath } from "@/lib/ios-tab-rail";

type IntelView = "flow" | "thermal";

function intelViewFromPath(path: string): IntelView {
  return path.startsWith("/heatmap") ? "thermal" : "flow";
}

/** Flow | Thermal switcher under the Intel tab — native iOS only. */
export function IosIntelligenceHubSegment() {
  const path = usePathname();
  const router = useRouter();
  const nativeShell = useIosNativeShell();

  if (!nativeShell || !isIosIntelligenceHubPath(path)) return null;

  const view = intelViewFromPath(path);

  return (
    <IosNativeSegment<IntelView>
      value={view}
      onChange={(next) => router.push(next === "thermal" ? "/heatmap" : "/flows")}
      accent="#bf5fff"
      variant="compact"
      aria-label="Intelligence desk"
      className="ios-intel-hub-segment ios-native-desk-segment"
      segments={[
        { id: "flow", label: "Flow" },
        { id: "thermal", label: "Thermal" },
      ]}
    />
  );
}
