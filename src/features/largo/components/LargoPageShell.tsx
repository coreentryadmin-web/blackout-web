"use client";

import { clsx } from "clsx";
import { useRef } from "react";
import { LargoNativeTerminal } from "@/features/largo/components/LargoNativeTerminal";
import { LargoTerminal } from "@/features/largo/components/LargoTerminal";
import { PageHeader } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";
import { useFullscreen } from "@/hooks/useFullscreen";

/**
 * /terminal page frame — full-viewport chat on web; edge-to-edge native iOS shell.
 */
export function LargoPageShell() {
  const nativeShell = useIosNativeShell();
  // Full-screen targets the whole terminal surface (§6 "Full-screen mode"), so
  // the ref lives here on the shell and the toggle is threaded into the terminal.
  const shellRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, supported: fullscreenSupported, toggle } = useFullscreen(shellRef);

  return (
    <div
      ref={shellRef}
      className={clsx(
        "largo-page-shell ios-native-page ios-native-page-largo",
        nativeShell && "largo-page-shell-native",
        isFullscreen && "largo-page-shell-fullscreen"
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
            // NO STATUS BADGE HERE, DELIBERATELY.
            //
            // This slot held `<Badge tone="accent" dot>AI Online</Badge>` — a hardcoded literal. No
            // prop, no state, no health read: it rendered a green liveness dot unconditionally, and
            // would have kept rendering it with the Anthropic key removed entirely.
            //
            // Measured on production 2026-08-23 at 1440x900 and 430x932: "AI ONLINE" lit, green,
            // while EVERY Largo turn was failing at round 0 with an HTTP 400 "your credit balance is
            // too low". The badge cannot be false, so it carries no information — and during the one
            // event it exists to communicate, it actively misinformed.
            //
            // The status endpoint rendered directly BELOW this header already states the principle:
            // "a row of dots that are green because they are hard-coded green says the opposite the
            // first time a member sees one lit during an outage" (status/route.ts). It honours that
            // for all six PRODUCT dots, each derived from that system's own reader. The AI's own dot
            // was the one exception, one component higher.
            //
            // Omitted rather than replaced, per the product contract's rule for exactly this case:
            // a value that cannot be calibrated is OMITTED, never fabricated. Nothing today measures
            // whether the model can answer — `/status` deliberately makes no Anthropic call ("NO
            // ANTHROPIC CALL, no tool loop, no cost"), and inferring liveness from the API key being
            // present is what produced this defect. The real signal becomes available once the tool
            // loop reports `upstream_error` (see ToolLoopStopReason): a badge could then read the
            // recent turns' stop reasons and be true. That is deliberately NOT wired here — it would
            // be an ordering dependency on an unmerged PR, which CLAUDE.md has an incident about.
            //
            // The live status strip below (LIVE/CLOSED, data age, N/6 systems online) is unaffected
            // and still carries the real, derived status a member should read.
          />
        )}
        {nativeShell ? (
          <LargoNativeTerminal />
        ) : (
          <LargoTerminal
            fullPage
            nativeShell={false}
            onToggleFullscreen={() => void toggle()}
            isFullscreen={isFullscreen}
            fullscreenSupported={fullscreenSupported}
          />
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
