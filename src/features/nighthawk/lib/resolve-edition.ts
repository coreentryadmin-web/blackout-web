// Shared edition resolution + read-time overlays — the SAME logic the member-facing
// `/api/market/nighthawk/edition` route runs, extracted so any other reader of a Night Hawk
// Legacy edition (Largo included) sees the identical freshness/absence/overlay picture a member
// does, instead of a bare, unmarked DB row.
//
// WHY THIS FILE EXISTS (found during a Largo Night Hawk Legacy composer audit, 2026-09-18):
// `run-tool.ts`'s `get_nighthawk_edition` case called `marketPlatform.nighthawk
// .getLatestNightHawkEdition()` / `getNightHawkEditionForDate()` directly — `rowToNightHawkEdition`
// over a bare DB row, with NONE of the logic below applied. Two real consequences for what Largo
// told members, both silent (no error, no absence marker — the tool just answered with less than
// the real picture):
//
//   1. **Invalidated plays looked live.** `pulled`/`pulled_reason` (a morning-confirm INVALIDATED
//      verdict) and `tier`/`morning_checked_at` (the pinned tier assignment) are read-time overlays
//      per `types.ts`'s own field comments ("merged at read time by pull-overlay.ts" /
//      "merged at read time from publish_context") — the published `plays` JSONB never carries them.
//      Skipping `withEditionOverlays` meant Largo could describe a play the desk had already pulled
//      as an ordinary live pick, with nothing in the payload to say otherwise.
//   2. **Freshness/absence went undisclosed.** The member route's `resolveNighthawkEdition` marks
//      `carry_until_close` (a prior session's plays served because tonight's hasn't published and
//      the prior session hasn't closed), `stale`+`served_for` (an older edition served because
//      today's genuinely isn't published), `no_plays` (a real publish with zero surviving plays),
//      and `degraded` (fallback to the legacy engine). The bare DB read computes NONE of these —
//      `rowToNightHawkEdition` alone never sets any of them — so a stale or carried-forward answer
//      read as an ordinary fresh one, exactly the "absence must be disclosed, never silent" failure
//      the Largo product contract (`docs/audit/LARGO-PRODUCT-CONTRACT.md`) names as a violation.
//
// This module is the DB-only core of the route's `resolveNighthawkEdition` (no Next.js request,
// response-cache, or process-local `lastGoodEdition` fallback state — those stay in the route,
// which needs them for its own serving/caching concerns). Both the route and Largo's tool now call
// this so the two paths cannot silently diverge again.

import {
  fetchLatestNighthawkEdition,
  fetchLatestPlayableNighthawkEdition,
  fetchNighthawkEditionByDate,
  fetchNighthawkEditionOutcomeOverlays,
  fetchNighthawkPulledPlays,
} from "@/lib/db";
import { rowToNightHawkEdition } from "./edition-builder";
import { applyNighthawkPullOverlay } from "./pull-overlay";
import { applyEditionOutcomeOverlay, buildOutcomeOverlayMap } from "./edition-outcome-overlay";
import { assignNighthawkTier } from "./nighthawk-tiers";
import { isBeforeOrAtMarketCloseEt, nextTradingDayEt, todayEt } from "./session";
import type { NightHawkEdition } from "./types";

const ENGINE_BASE = process.env.BLACKOUT_INTEL_URL?.replace(/\/$/, "") ?? "";

/** Flag a PUBLISHED edition that carries zero plays — see `NightHawkEdition.no_plays`'s own doc. */
export function markNoPlays(edition: NightHawkEdition): NightHawkEdition {
  if (edition.available && edition.plays.length === 0) return { ...edition, no_plays: true };
  return edition;
}

export function emptyEdition(editionFor: string): NightHawkEdition {
  return {
    available: false,
    edition_for: editionFor,
    published_at: null,
    recap_headline: null,
    recap_summary: "Tonight's edition publishes after the close. Five ranked plays land here automatically.",
    market_recap: null,
    plays: [],
  };
}

async function fetchLegacyPlays(): Promise<NightHawkEdition | null> {
  if (!ENGINE_BASE) return null;
  try {
    const apiKey = process.env.BLACKOUT_INTEL_API_KEY ?? "";
    const res = await fetch(`${ENGINE_BASE}/api/nighthawk/plays`, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      plays?: Array<Record<string, unknown>>;
      generated_at?: unknown;
      as_of?: unknown;
      scanned_at?: unknown;
    };
    const plays = (data.plays ?? []).slice(0, 5).map((p, i) => {
      const score = Number(p.score);
      const realScore = Number.isFinite(score) ? score : undefined;
      return {
        rank: i + 1,
        ticker: String(p.ticker ?? "?").toUpperCase(),
        direction: String(p.direction ?? "LONG"),
        conviction: realScore != null
          ? assignNighthawkTier({ score: realScore, confirmingSignals: null, earningsRisk: false }).tier
          : "",
        play_type: "stock" as const,
        thesis: String(p.summary ?? ""),
        key_signal: String(p.summary ?? ""),
        entry_range: "—",
        target: "—",
        stop: "—",
        options_play: "—",
        score: realScore,
        flow_streak_days: Number(p.streak_days ?? 0) || undefined,
        iv_rank: Number(p.iv_rank ?? 0) || undefined,
      };
    });
    if (!plays.length) return null;
    const editionFor = nextTradingDayEt(todayEt());
    const engineTs = data.generated_at ?? data.as_of ?? data.scanned_at;
    const publishedAt = typeof engineTs === "string" && !Number.isNaN(new Date(engineTs).getTime())
      ? new Date(engineTs).toISOString()
      : null;
    return {
      available: true,
      edition_for: editionFor,
      published_at: publishedAt,
      recap_headline: "Legacy engine plays",
      recap_summary: "Served from BlackOut intel engine fallback — degraded source.",
      market_recap: null,
      plays,
      degraded: true,
    };
  } catch {
    return null;
  }
}

async function withPullOverlay(edition: NightHawkEdition): Promise<NightHawkEdition> {
  if (!edition.edition_for || !edition.plays?.length) return edition;
  try {
    const pulledRows = await fetchNighthawkPulledPlays(edition.edition_for);
    return applyNighthawkPullOverlay(edition, pulledRows);
  } catch (err) {
    console.warn("[nighthawk/resolve-edition] pull-overlay read failed — serving unstamped:", err);
    return edition;
  }
}

async function withOutcomeOverlay(edition: NightHawkEdition): Promise<NightHawkEdition> {
  if (!edition.edition_for || !edition.plays?.length) return edition;
  try {
    const rows = await fetchNighthawkEditionOutcomeOverlays(edition.edition_for);
    return applyEditionOutcomeOverlay(edition, buildOutcomeOverlayMap(rows));
  } catch (err) {
    console.warn("[nighthawk/resolve-edition] outcome-overlay read failed — serving without tier pins:", err);
    return edition;
  }
}

export async function withEditionOverlays(edition: NightHawkEdition): Promise<NightHawkEdition> {
  return withOutcomeOverlay(await withPullOverlay(edition));
}

/**
 * Resolve the edition for `editionFor`, applying the exact fallback ladder and overlays the
 * member route serves: carry-forward of a still-open prior session's playable edition, an exact
 * date match, a bounded-age "latest" fallback (marked `stale`+`served_for`), the legacy-engine
 * fallback (`degraded`), or the honest empty state — always with pull/tier overlays applied.
 *
 * `explicitDate` mirrors the route's own semantics: non-null means the caller asked for a SPECIFIC
 * date, which disables the "carry a still-open prior session forward" behavior (that behavior only
 * makes sense for "what's live right now", not for a historical lookup).
 */
export async function resolveNighthawkEdition(
  editionFor: string,
  explicitDate: string | null
): Promise<NightHawkEdition> {
  const activePlayable = await fetchLatestPlayableNighthawkEdition();

  if (
    !explicitDate &&
    activePlayable &&
    activePlayable.edition_for !== editionFor &&
    isBeforeOrAtMarketCloseEt(activePlayable.edition_for)
  ) {
    const edition = rowToNightHawkEdition(activePlayable);
    edition.carry_until_close = true;
    edition.served_for = activePlayable.edition_for;
    return await withEditionOverlays(edition);
  }

  const exact = await fetchNighthawkEditionByDate(editionFor);
  if (exact) {
    return await withEditionOverlays(markNoPlays(rowToNightHawkEdition(exact)));
  }

  const latest = await fetchLatestNighthawkEdition();
  if (latest) {
    const edition = markNoPlays(rowToNightHawkEdition(latest));

    const MAX_EDITION_AGE_DAYS = 4;
    if (edition.edition_for) {
      const edAge = Math.floor(
        (new Date(editionFor + "T00:00:00").getTime() - new Date(edition.edition_for + "T00:00:00").getTime())
          / 86_400_000
      );
      if (!Number.isFinite(edAge) || edAge > MAX_EDITION_AGE_DAYS) {
        return emptyEdition(editionFor);
      }
    }

    if (edition.edition_for && edition.edition_for !== editionFor) {
      edition.stale = true;
      edition.served_for = edition.edition_for;
    }
    return await withEditionOverlays(edition);
  }

  const legacy = await fetchLegacyPlays();
  if (legacy) return legacy;

  return emptyEdition(editionFor);
}
