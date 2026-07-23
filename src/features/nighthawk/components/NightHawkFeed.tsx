"use client";

import useSWR from "swr";
import { useEffect, useState } from "react";
import { fetchNightHawkEdition, fetchNightHawkPlayStatus, fetchNightHawkRecord } from "@/lib/api";
import type { PlaybookPlay, PlayMorningStatus } from "@/features/nighthawk/lib/types";
import { ZeroDteBoard } from "@/features/nighthawk/components/ZeroDteBoard";
import { PlayDetailModal } from "@/features/nighthawk/components/PlayDetailModal";
import { PlaybookBoard } from "@/features/nighthawk/components/PlaybookBoard";
import { HorizonLaneBoard } from "@/features/nighthawk/components/HorizonLaneBoard";
import { IosNativeSegment } from "@/components/ios/IosNativeSegment";
import {
  NIGHTHAWK_VIEWS,
  NIGHTHAWK_VIEW_META,
  DEFAULT_NIGHTHAWK_VIEW,
  parseNightHawkView,
  type NightHawkView,
} from "@/features/nighthawk/lib/nighthawk-view";

/**
 * Night Hawk — one surface, four views (0DTE / Swings / LEAPS / Legacy), single-select. Selecting a view
 * scopes the ENTIRE desk to it; only the selected view's data is fetched/rendered. The choice is persisted
 * in the URL (?view=) so a refresh or shared link lands on the same board.
 */
export function NightHawkFeed() {
  const [selectedPlay, setSelectedPlay] = useState<PlaybookPlay | null>(null);
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

  // Legacy (evening playbook) data — fetched ONLY when the Legacy view is active, so the other views don't
  // pull the edition/record/status they never render (the "scope the whole desk to the selected one" rule).
  const { data: edition, error: editionError, isLoading: editionLoading } = useSWR(
    isLegacy ? "nighthawk-edition" : null,
    fetchNightHawkEdition,
    { refreshInterval: 120_000 }
  );
  const editionFor = edition?.edition_for ?? undefined;
  const { data: playStatus } = useSWR(
    isLegacy && editionFor ? ["nighthawk-play-status", editionFor] : null,
    () => fetchNightHawkPlayStatus(editionFor),
    { refreshInterval: 60_000 }
  );
  const { data: record, isLoading: recordLoading } = useSWR(
    isLegacy ? "nighthawk-record" : null,
    () => fetchNightHawkRecord(30),
    { refreshInterval: 300_000 }
  );

  const confirmByTicker = new Map<string, PlayMorningStatus>();
  if (playStatus?.available && playStatus.plays) {
    for (const p of playStatus.plays) confirmByTicker.set(p.ticker.toUpperCase(), p);
  }

  return (
    <div className="nighthawk-content-canvas">
      <IosNativeSegment
        value={view}
        onChange={selectView}
        accent="#ff2d55"
        aria-label="Night Hawk view"
        className="ios-native-desk-segment mb-3"
        segments={NIGHTHAWK_VIEWS.map((v) => ({ id: v, label: NIGHTHAWK_VIEW_META[v].label }))}
      />
      <p className="mb-3 text-xs text-slate-400">{NIGHTHAWK_VIEW_META[view].blurb}</p>

      <div className="nighthawk-single-view flex w-full max-w-none flex-col">
        {view === "ZERO_DTE" && <ZeroDteBoard />}
        {view === "SWING" && <HorizonLaneBoard horizon="SWING" />}
        {view === "LEAPS" && <HorizonLaneBoard horizon="LEAPS" />}
        {isLegacy && (
          <PlaybookBoard
            lean
            edition={edition}
            loading={editionLoading}
            editionError={
              editionError
                ? "Edition failed to load — auto-retrying every 2 minutes. Check connection or refresh."
                : undefined
            }
            onPlaySelect={setSelectedPlay}
            confirmByTicker={confirmByTicker}
            playStatusAvailable={Boolean(playStatus?.available)}
            morningConfirmCheckedAt={playStatus?.checked_at}
            record={record}
            recordLoading={recordLoading}
          />
        )}
      </div>

      <PlayDetailModal
        play={selectedPlay}
        editionFor={edition?.edition_for ?? null}
        onClose={() => setSelectedPlay(null)}
        morningConfirm={selectedPlay ? confirmByTicker.get(selectedPlay.ticker.toUpperCase()) : undefined}
        morningConfirmCheckedAt={playStatus?.checked_at}
      />
    </div>
  );
}
