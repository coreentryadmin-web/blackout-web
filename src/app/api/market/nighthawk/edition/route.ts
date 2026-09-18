import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireDatabaseInProduction } from "@/lib/db";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import {
  emptyEdition,
  resolveNighthawkEdition,
} from "@/features/nighthawk/lib/resolve-edition";
import { nextTradingDayEt, todayEt } from "@/features/nighthawk/lib/session";
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

let lastGoodEdition: NightHawkEdition | null = null;

/**
 * Serve when the real computation blew past `maxBlockMs` (a transient DB/read hiccup, not a
 * confirmed "nothing published" result — resolveNighthawkEdition never got to finish, let alone
 * return its own honest empty state). Falling back to a BARE `emptyEdition()` here made a timeout
 * indistinguishable from a genuinely quiet day: both render "Tonight's edition publishes after the
 * close" with `available: false` and no signal that anything went wrong. Live-observed 2026-09-08
 * mid-session (well before close, with a real published edition already confirmed live moments
 * before and after): one request in the middle returned exactly this shape.
 *
 * `lastGoodEdition` (this process's own last successful read) is served AS-IS when it is for the
 * SAME `editionFor` being requested — real, if momentarily stale, content the member is entitled
 * to see plainly. Only the genuinely-unknown case (no prior good read in this process either)
 * gets stamped `degraded` — the UI already has a dedicated notice for it ("Served from a degraded
 * fallback…", PlaybookBoard.tsx) that nothing on this path had ever triggered.
 *
 * When `lastGoodEdition.edition_for` does NOT match the date now being requested (captured just
 * before a midnight-ET day rollover, or from an unrelated `?date=` lookup earlier in this same
 * process), it must be restamped `stale`/`served_for` at SERVE time here — trusting whatever flag
 * was baked in at CAPTURE time is not enough, because that read had no reason to flag itself stale
 * when it was originally resolved (its own `edition_for` matched the date requested AT THAT TIME).
 * Without this, a prior trading day's plays would replay here looking exactly like tonight's live
 * board — the same "prior session plays masquerading as tonight's" failure `resolveNighthawkEdition`
 * itself already guards against two paths up (the `edition.edition_for !== editionFor` check below).
 */
function timeoutFallbackEdition(editionFor: string): NightHawkEdition {
  if (lastGoodEdition) {
    if (lastGoodEdition.edition_for && lastGoodEdition.edition_for !== editionFor) {
      return { ...lastGoodEdition, stale: true, served_for: lastGoodEdition.edition_for };
    }
    // BUG FIX (2026-09-18, Ask Largo standing mandate, live repro 2026-09-18 edition): `stale`'s
    // ONLY assignment site is resolveNighthawkEdition's own `edition.edition_for !== editionFor`
    // check (resolve-edition.ts) — so by construction it means EXACTLY "this is a carried-forward
    // date-mismatched edition", nothing else. But `lastGoodEdition` can itself have been CAPTURED
    // with `stale:true` already baked in (from an earlier resolve, when the date being requested
    // THEN genuinely didn't match) — that flag is a fact about the moment it was captured, not
    // about now. Once the requested `editionFor` naturally catches up to match
    // `lastGoodEdition.edition_for` (the branch below), the dates DO match, so `stale` must be
    // false by the flag's own definition — but returning `lastGoodEdition` unmodified served the
    // old baked-in `true` unchanged, showing members a false "tonight's not published yet" banner
    // over a correct, current, on-time edition. Explicitly clear both fields here rather than
    // trusting whatever was captured, for the same reason the doc comment above already gives for
    // the mismatched-date branch: capture-time flags are not enough, only serve-time truth is.
    if (lastGoodEdition.stale) {
      return { ...lastGoodEdition, stale: false, served_for: undefined };
    }
    return lastGoodEdition;
  }
  return { ...emptyEdition(editionFor), degraded: true };
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
      // BUG (found 2026-09-16): lastGoodEdition is documented below as "this process's own last
      // successful read", but this fire-and-forget refresh — the path EVERY request takes once the
      // cache is warm — used to discard its resolved value entirely. Only the cold-cache-miss branch
      // a few lines down ever assigned lastGoodEdition, so under normal continuous traffic (the peek
      // hits almost every request once warm) it froze at whatever this process's very first resolve
      // was and never picked up later overlay changes (pulled plays, outcome pins) applied on every
      // fresh resolve. Mirror the same guard the cold-miss branch uses below.
      void withServerCache(cacheKey, nighthawkEditionCacheTtlMs(), () => resolveNighthawkEdition(editionFor, explicitDate), {
        maxBlockMs: nighthawkEditionReadMaxBlockMs(),
        staleOnInflight: true,
        fallback: async () => timeoutFallbackEdition(editionFor),
        shouldCache: (value) => (value as NightHawkEdition).available !== false,
      }).then((edition) => {
        if (edition.available !== false) lastGoodEdition = edition;
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
        fallback: async () => timeoutFallbackEdition(editionFor),
        shouldCache: (value) => (value as NightHawkEdition).available !== false,
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
