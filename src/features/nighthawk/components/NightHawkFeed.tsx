"use client";

import useSWR from "swr";
import { useEffect, useState } from "react";
import { fetchNightHawkEdition } from "@/lib/api";
import { ZeroDteDeck, HorizonDeck, LegacyDeck } from "@/features/nighthawk/command-deck/containers";
import { IosNativeSegment } from "@/components/ios/IosNativeSegment";
import {
  NIGHTHAWK_VIEWS,
  NIGHTHAWK_VIEW_META,
  DEFAULT_NIGHTHAWK_VIEW,
  parseNightHawkView,
  type NightHawkView,
} from "@/features/nighthawk/lib/nighthawk-view";

/**
 * Night Hawk — one surface, four views (0DTE / Swings / LEAPS / Legacy), single-select. Each view renders the
 * COMMAND DECK: a two-panel matrix terminal (plays left, live breakdown right). Selecting a view scopes the
 * ENTIRE desk to it and only that view's data is fetched. The choice persists in the URL (?view=).
 */
export function NightHawkFeed() {
  const [view, setView] = useState<NightHawkView>(DEFAULT_NIGHTHAWK_VIEW);

  // Hydrate the selected view from the URL on mount (client-only — keeps SSR output stable).
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("view");
    if (raw) setView(parseNightHawkView(raw));
  }, []);

  function selectView(next: NightHawkView) {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next.toLowerCase());
    window.history.replaceState(null, "", url.toString());
  }

  const isLegacy = view === "LEGACY";
  // Legacy edition — fetched ONLY when the Legacy view is active (scope-to-selected rule).
  const { data: edition } = useSWR(isLegacy ? "nighthawk-edition" : null, fetchNightHawkEdition, {
    refreshInterval: 120_000,
  });

  return (
    <div className="nighthawk-content-canvas flex min-h-0 flex-1 flex-col">
      <IosNativeSegment
        value={view}
        onChange={selectView}
        accent="#ff2d55"
        aria-label="Night Hawk view"
        className="ios-native-desk-segment mb-3"
        segments={NIGHTHAWK_VIEWS.map((v) => ({ id: v, label: NIGHTHAWK_VIEW_META[v].label }))}
      />
      <p className="mb-3 text-xs text-mute">{NIGHTHAWK_VIEW_META[view].blurb}</p>

      <div className="nighthawk-single-view flex min-h-[560px] w-full max-w-none flex-1 flex-col">
        {view === "ZERO_DTE" && <ZeroDteDeck />}
        {view === "SWING" && <HorizonDeck horizon="SWING" />}
        {view === "LEAPS" && <HorizonDeck horizon="LEAPS" />}
        {isLegacy && <LegacyDeck edition={edition} />}
      </div>
    </div>
  );
}
