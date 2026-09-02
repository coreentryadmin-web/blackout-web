"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { PageShell, PageHeader, Button } from "@/components/ui";
import { PricingBackdrop } from "@/components/landing/PricingBackdrop";
import { SyncMembershipButton } from "@/components/SyncMembershipButton";
import { PlanLadder } from "@/components/upgrade/PlanLadder";
import { FeatureComparison } from "@/components/upgrade/FeatureComparison";
import { AuthProofRail } from "@/components/auth/AuthProofRail";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";

/**
 * /upgrade — App Store safe membership page; compact on native shell.
 *
 * `frame={false}` drops the in-app PageShell/backdrop so the page can be framed
 * by the marketing chrome (MarketingPageShell) instead — used now that /upgrade
 * lives in the (marketing) route group. Two page frames would emit duplicate
 * `<main id="main">`, so exactly one owner renders the frame.
 */
export function UpgradePageShell({
  frame = true,
  syncSlot,
}: {
  frame?: boolean;
  /** Server-rendered sync gate — defaults to client button for legacy callers. */
  syncSlot?: ReactNode;
}) {
  const nativeShell = useIosNativeShell();

  const body = (
      <div
        className={clsx(
          "content-rail mx-auto max-w-5xl py-8 pb-20 text-center md:py-16",
          nativeShell && "upgrade-page-inner-native py-4 pb-8"
        )}
      >
        {!nativeShell && (
          <div className="mb-14 text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-bull">
              Premium access
            </p>
            <h1 className="mt-4 font-syne text-4xl font-bold leading-tight text-white md:text-5xl lg:text-6xl">
              Unlock the{" "}
              <span className="text-bull">full floor.</span>
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-white/50 md:text-lg">
              One membership opens every instrument — live flow, SPX structure,
              AI analyst, and the full product desk.
            </p>
          </div>
        )}

        {nativeShell && (
          <div className="upgrade-native-hero mb-6 text-left">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400">
              Premium access
            </p>
            <h1 className="mt-2 font-syne text-2xl font-bold text-white">Unlock the desk</h1>
            <p className="mt-2 text-sm leading-relaxed text-sky-300">
              One membership opens every instrument — live flow, SPX structure, AI analyst, and
              the full product desk.
            </p>
          </div>
        )}

        <div className={clsx("mx-auto max-w-3xl", nativeShell && "max-w-none")}>
          {!nativeShell && <AuthProofRail variant="upgrade" />}
        </div>

        <div className="show-in-ios-app mx-auto mt-12 max-w-md rounded-2xl border border-white/10 bg-[rgba(8,9,14,0.55)] px-6 py-7 text-center backdrop-blur-md upgrade-native-membership-card">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-bull">Membership</p>
          <p className="mt-3 text-sm leading-relaxed text-secondary">
            Your membership is managed on the web. Once active, sign in here to access the full
            desk.
          </p>
          <Button href="/dashboard" variant="outline" size="sm" className="mt-5">
            Open SPX desk
          </Button>
        </div>

        <div className="hide-in-ios-app">
          <PlanLadder />
        </div>

        <div className="hide-in-ios-app mx-auto mt-8 flex max-w-sm items-center justify-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-5 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-white/30">
            Already paid?
          </span>
          {syncSlot ?? <SyncMembershipButton />}
        </div>

        <div className="hide-in-ios-app">
          <FeatureComparison />
        </div>

        {!nativeShell && (
          <div className="mt-10 space-y-2">
            <Link
              href="/"
              className="font-mono text-xs text-secondary transition-colors duration-base hover:text-white"
            >
              ← Back to home
            </Link>
            <p className="hide-in-ios-app font-mono text-[10px] text-mute">
              Pay with the same email as your BlackOut account at checkout, then sync access above.
              Educational tools only — not financial advice.
            </p>
          </div>
        )}
      </div>
  );

  if (!frame) return body;

  return (
    <PageShell
      backdropSlot={<PricingBackdrop />}
      className={clsx(nativeShell && "upgrade-page-shell-native ios-native-page-upgrade")}
      contentClassName={clsx(nativeShell && "upgrade-page-content-native")}
    >
      {body}
    </PageShell>
  );
}
