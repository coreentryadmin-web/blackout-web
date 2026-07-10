"use client";

import { clsx } from "clsx";
import { LargoNativeTerminal } from "@/features/largo/components/LargoNativeTerminal";
import { LargoTerminal } from "@/features/largo/components/LargoTerminal";
import { PageHeader, Badge } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";
import { largoEnabled } from "@/lib/largo-env";

/**
 * /terminal page frame — full-viewport chat on web; edge-to-edge native iOS shell.
 */
export function LargoPageShell() {
  const nativeShell = useIosNativeShell();

  if (!largoEnabled()) {
    return (
      <div className="largo-page-shell ios-native-page ios-native-page-largo">
        <main id="main" className="largo-page-main p-8 text-center">
          <p className="t-kicker text-purple-light/80 mb-2">Production only</p>
          <h1 className="font-syne text-2xl text-purple-light font-bold mb-3">Largo is disabled on staging</h1>
          <p className="font-mono text-sm text-sky-300/70 max-w-md mx-auto">
            Staging is for playbook shadow, matrix, and trade-alert validation — not Anthropic desk AI.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "largo-page-shell ios-native-page ios-native-page-largo",
        nativeShell && "largo-page-shell-native"
      )}
    >
      <main
        id="main"
        className={clsx("largo-page-main", nativeShell && "largo-page-main-native")}
      >
        {!nativeShell && (
          <PageHeader
            className="largo-page-header"
            kicker="AI desk analyst"
            title={
              <span className="flex items-center gap-3">
                <ProductMark product="largo" size={36} />
                Largo
              </span>
            }
            subtitle="Live desk intel · grounded in platform data"
            badge={
              <Badge tone="accent" dot>
                AI Online
              </Badge>
            }
          />
        )}
        {nativeShell ? (
          <LargoNativeTerminal />
        ) : (
          <LargoTerminal fullPage nativeShell={false} />
        )}
        {!nativeShell && (
          <p className="font-mono text-[10px] text-sky-300/60 text-center pt-1">
            Educational. Not advice. You decide.
          </p>
        )}
      </main>
    </div>
  );
}
