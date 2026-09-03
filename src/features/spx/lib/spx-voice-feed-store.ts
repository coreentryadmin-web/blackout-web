/**
 * Server-persisted SPX voice transition feed — mirrors the client Pulse/commentary rail
 * (spx-largo-feed-cache.ts) so Largo can answer "what changed on the desk this session?"
 */
import {
  composeBiasHeaderLine,
  deriveSpxBias,
  detectPlayVoiceEvents,
  detectSpxVoiceEvents,
  voiceSnapshotFromDesk,
  type SpxVoiceEvent,
  type SpxVoicePlayState,
  type SpxVoiceSnapshot,
} from "@/lib/bie/spx-live-voice";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { sharedListAppend, sharedListRange } from "@/lib/shared-cache";

export const SPX_VOICE_FEED_MAX = 120;
export const SPX_VOICE_FEED_TTL_SEC = 14 * 60 * 60;

export type SpxVoiceFeedEntry = {
  at: number;
  at_iso: string;
  kind: SpxVoiceEvent["kind"];
  tone: SpxVoiceEvent["tone"];
  line: string;
  key: string;
  session_date: string;
};

function feedKey(sessionDate: string): string {
  return `spx:voice-feed:${sessionDate}`;
}

let prevBySession: { sessionDate: string; snap: SpxVoiceSnapshot | null } = {
  sessionDate: "",
  snap: null,
};

let prevBiasKeyBySession: { sessionDate: string; key: string | null } = {
  sessionDate: "",
  key: null,
};

let prevPlayBySession: { sessionDate: string; play: SpxVoicePlayState } = {
  sessionDate: "",
  play: null,
};

/** Test-only reset of the in-process previous snapshot. */
export function resetSpxVoiceFeedObserverForTests(): void {
  prevBySession = { sessionDate: "", snap: null };
  prevBiasKeyBySession = { sessionDate: "", key: null };
  prevPlayBySession = { sessionDate: "", play: null };
}

export function voiceEventsToFeedEntries(
  events: SpxVoiceEvent[],
  sessionDate: string,
  atMs = Date.now()
): SpxVoiceFeedEntry[] {
  const atIso = new Date(atMs).toISOString();
  return events.map((e) => ({
    at: atMs,
    at_iso: atIso,
    kind: e.kind,
    tone: e.tone,
    line: e.line,
    key: e.key,
    session_date: sessionDate,
  }));
}

export async function appendSpxVoiceFeedEntries(
  sessionDate: string,
  entries: SpxVoiceFeedEntry[]
): Promise<number> {
  if (!entries.length) return 0;
  const key = feedKey(sessionDate);
  let len = 0;
  for (const entry of entries) {
    len = await sharedListAppend(key, entry, SPX_VOICE_FEED_TTL_SEC, SPX_VOICE_FEED_MAX);
  }
  return len;
}

export async function readSpxVoiceFeed(
  sessionDate: string,
  limit = 40
): Promise<SpxVoiceFeedEntry[]> {
  const rows = await sharedListRange<SpxVoiceFeedEntry>(feedKey(sessionDate));
  if (!rows.length) return [];
  return rows.slice(-Math.min(limit, SPX_VOICE_FEED_MAX));
}

/**
 * Diff the merged desk against the last observed snapshot for this session and persist
 * any new transition events. Fire-and-forget safe — never throws to callers.
 */
export async function observeSpxDeskVoiceTransitions(
  desk: SpxDeskPayload,
  sessionDate: string
): Promise<SpxVoiceFeedEntry[]> {
  if (!desk.available || desk.price == null || !Number.isFinite(desk.price) || desk.price <= 0) {
    return [];
  }

  const next = voiceSnapshotFromDesk(desk);
  if (prevBySession.sessionDate !== sessionDate) {
    prevBySession = { sessionDate, snap: next };
    return [];
  }

  const prev = prevBySession.snap;
  prevBySession = { sessionDate, snap: next };
  if (!prev) return [];

  const events: SpxVoiceEvent[] = [...detectSpxVoiceEvents(prev, next)];

  const bias = deriveSpxBias(next);
  if (prevBiasKeyBySession.sessionDate !== sessionDate) {
    prevBiasKeyBySession = { sessionDate, key: bias.key };
  } else if (prevBiasKeyBySession.key != null && prevBiasKeyBySession.key !== bias.key) {
    events.push({
      key: `bias:${bias.key}`,
      kind: "bias",
      tone: bias.direction === "bullish" ? "bull" : bias.direction === "bearish" ? "bear" : "warn",
      at: next.at,
      line: `🧭 ${composeBiasHeaderLine(next, bias)}`,
    });
    prevBiasKeyBySession = { sessionDate, key: bias.key };
  } else {
    prevBiasKeyBySession = { sessionDate, key: bias.key };
  }

  if (!events.length) return [];

  const entries = voiceEventsToFeedEntries(events, sessionDate, next.at);
  await appendSpxVoiceFeedEntries(sessionDate, entries);
  return entries;
}

export type SpxPlayVoiceSlice = {
  action?: string | null;
  direction?: "long" | "short" | null;
  open_play?: {
    direction: "long" | "short";
    entry_price: number | null;
    stop: number | null;
    target: number | null;
  } | null;
};

/** Play lifecycle transitions (armed / fired / closed) — parity with SpxCommentaryRail. */
export async function observeSpxPlayVoiceTransitions(
  play: SpxPlayVoiceSlice | null | undefined,
  sessionDate: string
): Promise<SpxVoiceFeedEntry[]> {
  const slice: SpxVoicePlayState = play
    ? {
        action: play.action,
        direction: play.direction ?? null,
        open_play: play.open_play ?? null,
      }
    : null;

  if (prevPlayBySession.sessionDate !== sessionDate) {
    prevPlayBySession = { sessionDate, play: slice };
    return [];
  }

  const prev = prevPlayBySession.play;
  prevPlayBySession = { sessionDate, play: slice };
  const events = detectPlayVoiceEvents(prev, slice, Date.now());
  if (!events.length) return [];

  const entries = voiceEventsToFeedEntries(events, sessionDate);
  await appendSpxVoiceFeedEntries(sessionDate, entries);
  return entries;
}
