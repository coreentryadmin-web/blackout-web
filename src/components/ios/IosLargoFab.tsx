"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";
import { getIosRouteKey } from "@/lib/ios-tool-routes";
import { iosHapticImpact } from "@/lib/ios-haptics";

/** Contextual Ask Largo — floats above the tab bar on every desk except Largo itself. */
export function IosLargoFab() {
  const path = usePathname();
  const nativeShell = useIosNativeShell();

  if (!nativeShell || path.startsWith("/terminal")) return null;

  const context = getIosRouteKey(path);
  const href =
    context === "other" || context === "largo"
      ? "/terminal"
      : `/terminal?context=${encodeURIComponent(context)}`;

  return (
    <Link
      href={href}
      prefetch={false}
      scroll={false}
      className="ios-largo-fab"
      aria-label="Ask Largo about this desk"
      title="Ask Largo"
      onClick={() => iosHapticImpact("Light")}
    >
      <span aria-hidden>✦</span>
    </Link>
  );
}
