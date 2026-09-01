"use client";

import useSWR from "swr";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import { fetchNightHawkEdition } from "@/lib/api";
import { IosNativeSegment } from "@/components/ios/IosNativeSegment";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";
import {
  NIGHTHAWK_VIEWS,
  NIGHTHAWK_VIEW_META,
  DEFAULT_NIGHTHAWK_VIEW,
  parseNightHawkView,
  type NightHawkView,
} from "@/features/nighthawk/lib/nighthawk-view";
import type { NightHawkSeedProps } from "@/features/nighthawk/lib/nighthawk-seed-props";
import type { BoardResp } from "@/features/nighthawk/command-deck/zerodte-sources";
import { NIGHTHAWK_GOTO_SWING_EVENT, type NightHawkGotoSwingDetail } from "@/features/nighthawk/lib/goto-swing";
import { NightHawkDeskThemeToggle } from "@/features/nighthawk/components/NightHawkDeskThemeToggle";
import { NightHawkLoadingSkeleton } from "@/features/nighthawk/components/NightHawkLoadingSkeleton";

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
  { loading: () => <NightHawkLoadingSkeleton /> }
);
const BangerBoard = dynamic(
  () => import("@/features/nighthawk/components/BangerBoard").then((m) => m.BangerBoard),
  { loading: () => <NightHawkLoadingSkeleton /> }
);
const VectorPickLogBoard = dynamic(
  () => import("@/features/nighthawk/components/VectorPickLogBoard").then((m) => m.VectorPickLogBoard),
  { loading: () => <NightHawkLoadingSkeleton /> }
);

/**
 * Night Hawk — one surface, five views (0DTE / Swings / Bangers / Vector / Legacy), single-select.
 * ZERO_DTE/SWING/LEGACY render the COMMAND DECK (a two-panel matrix terminal: plays left, live breakdown
 * right); BANGER renders BangerBoard (Engine B); VECTOR renders VectorPickLogBoard (closed contract-pick
 * analysis log). Selecting a view scopes the ENTIRE desk to it and only
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
  // Set by a Legacy play's "moved to Swings Open" link (dispatchGotoSwing) — HorizonDeck uses it
  // to auto-select that ticker's row once the SWING view mounts/refetches.
  const [swingFocusTicker, setSwingFocusTicker] = useState<string | null>(null);

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
    const raw = new URLSearchParams(window.location.search).get("view");
    if (raw) setView(parseNightHawkView(raw));
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
  // Legacy edition — fetched ONLY when the Legacy view is active (scope-to-selected rule).
  const { data: edition, error: editionError } = useSWR(isLegacy ? "nighthawk-edition" : null, fetchNightHawkEdition, {
    refreshInterval: 120_000,
  });

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
        {isLegacy && <LegacyDeck edition={edition} error={editionError} />}
      </div>
    </div>
  );
}
