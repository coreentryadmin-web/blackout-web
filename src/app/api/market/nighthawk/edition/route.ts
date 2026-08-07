import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  requireDatabaseInProduction,
  fetchLatestNighthawkEdition,
  fetchLatestPlayableNighthawkEdition,
  fetchNighthawkEditionByDate,
  fetchNighthawkPulledPlays,
} from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { rowToNightHawkEdition } from "@/features/nighthawk/lib/edition-builder";
import { applyNighthawkPullOverlay } from "@/features/nighthawk/lib/pull-overlay";
import { assignNighthawkTier } from "@/features/nighthawk/lib/nighthawk-tiers";
import { isBeforeOrAtMarketCloseEt, nextTradingDayEt, todayEt } from "@/features/nighthawk/lib/session";
import { requireToolApi } from "@/lib/tool-access-server";
import type { NightHawkEdition } from "@/features/nighthawk/lib/types";
import { roundFloats } from "@/lib/round-floats";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { withServerCache, peekServerCache } from "@/lib/server-cache";
import {
  nighthawkEditionCacheTtlMs,
  nighthawkEditionReadMaxBlockMs,
} from "@/lib/providers/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Airtight no-store across the whole CDN chain (#77). The edition's `available` flag flips the
// user page between the recap and the "awaiting close" pending state, so a stale CDN copy serving
// available:false would re-show "Playbook pending" after a real edition published. `Cache-Control`
// covers browsers + most CDNs; `CDN-Cache-Control` is honored specifically by Cloudflare/Fastly even
// if they were configured to ignore the standard header. A direct no-store fetch already shows the
// fresh value — these headers stop any intermediary from caching the response.

const ENGINE_BASE = process.env.BLACKOUT_INTEL_URL?.replace(/\/$/, "") ?? "";

/**
 * Is `?date=` a real calendar date in `YYYY-MM-DD` form?
 *
 * The raw query string used to flow straight into `fetchNighthawkEditionByDate` AND into the
 * server-cache key. Two consequences, both measured live 2026-08-07:
 *   • `?date=not-a-date` returned **200** with today's edition flagged `stale: true` — a member
 *     following a bad link saw a "stale" banner over data that was current.
 *   • Every distinct garbage string minted its own cache entry
 *     (`nighthawk:edition:v1:${editionFor}:…`), an unbounded key space from an unvalidated input.
 *
 * The shape check alone is not enough: "2026-13-45" matches the regex and is not a date. Round-trip
 * through Date and compare so only real calendar days pass.
 */
function isValidEditionDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === value; // rejects 2026-02-30 style overflow
}

/**
 * Flag a PUBLISHED edition that carries zero plays.
 *
 * `available` stays TRUE: the edition really was published and the recap is real content the member
 * is entitled to — flipping it to false would show "publishes after the close" over a session that
 * has already published, which is a worse lie than the one being fixed. `no_plays` is the honest
 * third state so the UI can say "no plays cleared the bar" instead of rendering the
 * playbook-is-here framing around an empty list.
 *
 * Server-side half only. The member-facing copy is a follow-up — the API could not previously
 * EXPRESS this state, which is the part that had to change first.
 */
function markNoPlays(edition: NightHawkEdition): NightHawkEdition {
  if (edition.available && edition.plays.length === 0) return { ...edition, no_plays: true };
  return edition;
}

function emptyEdition(editionFor: string): NightHawkEdition {
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
      // Use the engine's real score when present — never fabricate a 0 that reads as a real
      // reading. A missing score becomes undefined so the UI renders "—".
      const score = Number(p.score);
      const realScore = Number.isFinite(score) ? score : undefined;
      return {
        rank: i + 1,
        ticker: String(p.ticker ?? "?").toUpperCase(),
        direction: String(p.direction ?? "LONG"),
        // Derive conviction from the real score instead of hardcoding "B"; leave it blank
        // when there is no score to derive from.
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
    // Carry the engine's real timestamp if it provides one; otherwise null (unknown publish
    // time) — never stamp `now` over possibly-old engine data, which would assert freshness.
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

// PR-N4: merge the morning-confirm PULLED latch (nighthawk_play_outcomes.pulled) onto
// the served payload — an INVALIDATED play is presented as PULLED with its reason, at
// its published rank, on every serve path (never hidden, never deleted; the edition row
// itself stays unmutated). Fail-soft: a latch-read failure serves the edition unstamped
// (the play-status Redis badge still carries the INVALIDATED signal for the UI) —
// members must never lose the whole edition because the overlay lookup errored.
async function withPullOverlay(edition: NightHawkEdition): Promise<NightHawkEdition> {
  if (!edition.edition_for || !edition.plays?.length) return edition;
  try {
    const pulledRows = await fetchNighthawkPulledPlays(edition.edition_for);
    return applyNighthawkPullOverlay(edition, pulledRows);
  } catch (err) {
    console.warn("[nighthawk/edition] pull-overlay read failed — serving unstamped:", err);
    return edition;
  }
}

let lastGoodEdition: NightHawkEdition | null = null;

async function resolveNighthawkEdition(
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
    return await withPullOverlay(edition);
  }

  const exact = await fetchNighthawkEditionByDate(editionFor);
  if (exact) {
    return await withPullOverlay(markNoPlays(rowToNightHawkEdition(exact)));
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
      // Fail CLOSED on a non-finite age. `edAge > MAX` is false for NaN, so an unparseable
      // `editionFor` used to sail past this guard and serve the latest edition as merely "stale".
      // The date is validated at the handler now, but this guard must not depend on that: it is the
      // last thing standing between a bad clock and serving a 3-week-old playbook as current.
      if (!Number.isFinite(edAge) || edAge > MAX_EDITION_AGE_DAYS) {
        return emptyEdition(editionFor);
      }
    }

    if (edition.edition_for && edition.edition_for !== editionFor) {
      edition.stale = true;
      edition.served_for = edition.edition_for;
    }
    return await withPullOverlay(edition);
  }

  const legacy = await fetchLegacyPlays();
  if (legacy) return legacy;

  return emptyEdition(editionFor);
}

export async function GET(req: NextRequest) {
  const authResult = await authorizeCronOrTierApi(req, "premium");
  if (authResult instanceof Response) return authResult;

  // Launch gate — locked to non-admins until this tool ships.
  const locked = await requireToolApi("nighthawk");
  if (locked) return locked;

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  const explicitDate = req.nextUrl.searchParams.get("date");
  if (explicitDate != null && !isValidEditionDate(explicitDate)) {
    return NextResponse.json(
      { error: "date must be YYYY-MM-DD" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }
  const editionFor = explicitDate ?? nextTradingDayEt(todayEt());
  const cacheKey = `nighthawk:edition:v1:${editionFor}:${explicitDate ?? "_live"}`;

  try {
    const instant = await peekServerCache<NightHawkEdition>(cacheKey);
    if (instant) {
      void withServerCache(cacheKey, nighthawkEditionCacheTtlMs(), () => resolveNighthawkEdition(editionFor, explicitDate), {
        maxBlockMs: nighthawkEditionReadMaxBlockMs(),
        staleOnInflight: true,
        fallback: async () => lastGoodEdition ?? emptyEdition(editionFor),
      }).catch(() => undefined);
      return NextResponse.json(roundFloats(instant), { headers: NO_STORE_HEADERS });
    }

    const edition = await withServerCache(
      cacheKey,
      nighthawkEditionCacheTtlMs(),
      () => resolveNighthawkEdition(editionFor, explicitDate),
      {
        maxBlockMs: nighthawkEditionReadMaxBlockMs(),
        staleOnInflight: true,
        fallback: async () => lastGoodEdition ?? emptyEdition(editionFor),
      }
    );
    if (edition.available !== false) lastGoodEdition = edition;
    return NextResponse.json(roundFloats(edition), { headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error("[nighthawk/edition] unhandled error:", err);
    return NextResponse.json(
      { available: false, degraded: true, edition_for: editionFor, plays: [], recap_summary: "Edition temporarily unavailable." },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
