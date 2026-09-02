"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import { IosNativeSegment } from "@/components/ios/IosNativeSegment";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";
import {
  NIGHTHAWK_VIEWS,
  NIGHTHAWK_VIEW_META,
  DEFAULT_NIGHTHAWK_VIEW,
  resolveNightHawkView,
  type NightHawkView,
} from "@/features/nighthawk/lib/nighthawk-view";
import type { NightHawkSeedProps } from "@/features/nighthawk/lib/nighthawk-seed-props";
import type { BoardResp } from "@/features/nighthawk/command-deck/zerodte-sources";
import { NIGHTHAWK_GOTO_SWING_EVENT, type NightHawkGotoSwingDetail } from "@/features/nighthawk/lib/goto-swing";
import { NightHawkDeskThemeToggle } from "@/features/nighthawk/components/NightHawkDeskThemeToggle";
import { NightHawkLoadingSkeleton } from "@/features/nighthawk/components/NightHawkLoadingSkeleton";
import { VectorBoardLoadingSkeleton } from "@/features/nighthawk/components/VectorBoardLoadingSkeleton";

const ZeroDteDeck = dynamic(
  () => import("@/features/nighthawk/command-deck/containers").then((m) => m.ZeroDteDeck),
  { loading: () => <NightHawkLoadingSkeleton /> }
);
const HorizonDeck = dynamic(
  () => import("@/features/nighthawk/command-deck/containers").then((m) => m.HorizonDeck),
  { loading: () => <NightHawkLoadingSkeleton /> }
);
const LegacyDeck = dynamic(
  () => import("@/features/nighthawk/command-deck/containers").then((m) => m.LegacyDeck),
  { loading: () => <VectorBoardLoadingSkeleton /> }
);
const BangerBoard = dynamic(
  () => import("@/features/nighthawk/components/BangerBoard").then((m) => m.BangerBoard),
  { loading: () => <NightHawkLoadingSkeleton /> }
);
const VectorPickLogBoard = dynamic(
  () => import("@/features/nighthawk/components/VectorPickLogBoard").then((m) => m.VectorPickLogBoard),
  { loading: () => <VectorBoardLoadingSkeleton /> }
);

/**
 * Night Hawk — one surface, five views (0DTE / Swings / Bangers / Vector / Legacy), single-select.
 * ZERO_DTE/SWING/LEGACY render the COMMAND DECK (a two-panel matrix terminal: plays left, live breakdown
 * right); BANGER renders BangerBoard (Engine B); VECTOR and LEGACY render X Ads Manager table boards
 * (VectorPickLogBoard / LegacyPickLogBoard). Selecting a view scopes the ENTIRE desk to it and only
 * that view's data is fetched. The choice persists in the URL (?view=).
 *
 * LEAPS was removed from this toggle 2026-08-04 (no live signal adapter fed it, so it only ever rendered an
 * empty lane) — see the header comment in `nighthawk-view.ts` for the full note and revival path.
 */
export function NightHawkFeed({ seed }: { seed?: NightHawkSeedProps | null }) {
  const router = useRouter();
  const nativeShell = useIosNativeShell();
  // SSR may pass view from ?view=; client still re-reads URL on mount for soft-nav edge cases.
  const [view, setView] = useState<NightHawkView>(seed?.view ?? DEFAULT_NIGHTHAWK_VIEW);
  // Set by a Legacy play's "moved to Swings Open" link (dispatchGotoSwing), OR by an incoming
  // `?ticker=` cross-product deep link (e.g. from HELIX's context header, seed.ticker/page.tsx) —
  // HorizonDeck uses it to auto-select that ticker's row once the SWING view mounts/refetches.
  const [swingFocusTicker, setSwingFocusTicker] = useState<string | null>(seed?.ticker ?? null);

  /** Keep App Router URL in sync — raw replaceState breaks <Link> nav after view toggles. */
  const selectView = useCallback(
    (next: NightHawkView) => {
      setView(next);
      const url = new URL(window.location.href);
      url.searchParams.set("view", next.toLowerCase());
      router.replace(url.pathname + url.search, { scroll: false });
    },
    [router]
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("view");
    const ticker = params.get("ticker")?.trim();
    // Same soft-nav edge case as the pre-existing view re-read — a client-side transition to
    // /nighthawk?ticker=X (e.g. clicking HELIX's "Night Hawk →" link without a full page load)
    // never runs page.tsx's server seed. `resolveNightHawkView` is the SAME function that seed
    // uses, so the two entry points cannot silently drift on the "ticker defaults to SWING" rule.
    if (raw || ticker) setView(resolveNightHawkView(raw, ticker));
    if (ticker) setSwingFocusTicker(ticker.toUpperCase());
  }, []);

  useEffect(() => {
    function onGotoSwing(e: Event) {
      const ticker = (e as CustomEvent<NightHawkGotoSwingDetail>).detail?.ticker;
      if (!ticker) return;
      setSwingFocusTicker(ticker.toUpperCase());
      selectView("SWING");
    }
    window.addEventListener(NIGHTHAWK_GOTO_SWING_EVENT, onGotoSwing);
    return () => window.removeEventListener(NIGHTHAWK_GOTO_SWING_EVENT, onGotoSwing);
  }, [selectView]);

  const isLegacy = view === "LEGACY";

  return (
    <div className="nighthawk-content-canvas flex min-h-0 flex-1 flex-col">
      <div className="nighthawk-feed-header mb-1 flex shrink-0 items-center gap-2">
        <IosNativeSegment
          value={view}
          onChange={selectView}
          accent="#00D9A3"
          variant={nativeShell ? "compact" : "default"}
          aria-label="Night Hawk view"
          className="ios-native-desk-segment min-w-0 flex-1 shrink"
          segments={NIGHTHAWK_VIEWS.map((v) => ({ id: v, label: NIGHTHAWK_VIEW_META[v].label }))}
        />
        <NightHawkDeskThemeToggle />
      </div>
      <div
        className={clsx(
          "nighthawk-single-view flex w-full max-w-none flex-1 flex-col",
          "min-h-0"
        )}
      >
        {view === "ZERO_DTE" && (
          <ZeroDteDeck initialBoard={(seed?.board as BoardResp | null | undefined) ?? null} />
        )}
        {view === "SWING" && <HorizonDeck horizon="SWING" focusTicker={swingFocusTicker} />}
        {view === "BANGER" && <BangerBoard />}
        {view === "VECTOR" && <VectorPickLogBoard />}
        {isLegacy && <LegacyDeck />}
      </div>
    </div>
  );
}
