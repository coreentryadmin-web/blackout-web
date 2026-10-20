import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { NighthawkEditionRow } from "@/lib/db";

// BUG: live repro 2026-10-20 — a recap-only (zero-play) edition published for TODAY, fetched via
// the default (no ?date=) path the live LegacyDeck board always uses, was stamped `stale: true`
// even though it's the correctly-and-on-time-published edition for the exact day it's being shown
// for. Root cause: the carry-forward branch that exists precisely for "today's own edition, still
// before its close" reads `fetchLatestPlayableNighthawkEdition()` (plays.length > 0 only), so a
// zero-play edition never qualifies there and falls through to the generic "latest" branch, which
// stamps `stale` from a date comparison that is true on every single day (the requested
// `editionFor` is always tomorrow's trading day). Both member-facing surfaces
// (containers.tsx bannerText, PlaybookBoard.tsx resolveEditionStatus) check `isStale` before their
// own `isRecapOnly`/`recapState` case, so this surfaced a false "tonight's not published yet"
// banner over a current, honest recap-only edition.

function row(over: Partial<NighthawkEditionRow>): NighthawkEditionRow {
  return {
    edition_for: "2026-10-20",
    session_date: "2026-10-20",
    published_at: "2026-10-19T21:41:46.000Z",
    recap_headline: "Quiet night across the board",
    recap_summary: "No scored dossiers after staging.",
    market_recap: {},
    plays: [],
    meta: {},
    ...over,
  };
}

const state = {
  latest: null as NighthawkEditionRow | null,
  playable: null as NighthawkEditionRow | null,
  byDate: null as NighthawkEditionRow | null,
  beforeClose: true,
};

/**
 * `resolve-edition.ts` imports `rowToNightHawkEdition` from `./edition-builder` — but that file
 * also assembles editions from LIVE data (dossiers, scoring, Claude-generated plays, SPX outcome
 * stats, ...) and transitively pulls in a provider chain that carries `import "server-only"`
 * (confirmed: `import("./edition-builder")` alone throws "This module cannot be imported from a
 * Client Component module" under plain Node/tsx, with no bundler-level substitution to suppress
 * it — the same constraint `helix-alert-rules-db.ts`'s own header comment documents). That makes
 * the whole of `edition-builder.ts` unimportable in this test process, independent of mocking
 * `@/lib/db`. resolve-edition.ts only uses ONE pure export from it, so this test supplies a
 * faithful, minimal stand-in instead of spreading the real module — mirrors
 * `rowToNightHawkEdition`'s documented contract as of 2026-10-20 (edition-builder.ts's own
 * `available`/`recap_only` doc comment above its definition): available when plays.length>0 OR a
 * recap was published; recap_only when plays.length===0 AND a recap was published.
 */
function hasRecapContent(row: { recap_headline: string | null; recap_summary: string | null; market_recap: Record<string, unknown> | null | undefined }): boolean {
  if (row.recap_headline && row.recap_headline.trim()) return true;
  if (row.recap_summary && row.recap_summary.trim()) return true;
  if (row.market_recap && Object.keys(row.market_recap).length > 0) return true;
  return false;
}

function fakeRowToNightHawkEdition(row: NighthawkEditionRow) {
  const plays = row.plays ?? [];
  const recapPresent = hasRecapContent(row);
  const recapOnly = plays.length === 0 && recapPresent;
  return {
    available: plays.length > 0 || recapPresent,
    edition_for: row.edition_for,
    published_at: row.published_at,
    recap_headline: row.recap_headline,
    recap_summary: row.recap_summary,
    market_recap: row.market_recap,
    plays: plays.map((p, i) => ({ ...(p as Record<string, unknown>), rank: (p as { rank?: number }).rank ?? i + 1 })),
    recap_only: recapOnly,
    recap_only_reason: recapOnly ? "test-fixture-reason" : null,
    funnel: null,
  };
}

before(async () => {
  const realDb = await import("../../../lib/db");
  mock.module("../../../lib/db", {
    namedExports: {
      ...realDb,
      fetchLatestNighthawkEdition: async () => state.latest,
      fetchLatestPlayableNighthawkEdition: async () => state.playable,
      fetchNighthawkEditionByDate: async () => state.byDate,
      fetchNighthawkPulledPlays: async () => [],
      fetchNighthawkEditionOutcomeOverlays: async () => [],
    },
  });

  mock.module("./edition-builder", {
    namedExports: {
      rowToNightHawkEdition: fakeRowToNightHawkEdition,
    },
  });

  const realSession = await import("./session");
  mock.module("./session", {
    namedExports: {
      ...realSession,
      // The real implementation reads the actual wall clock with no way for a caller to inject
      // "now" — stub it so the test is deterministic regardless of when it runs, while every
      // other export (todayEt, nextTradingDayEt, ...) stays real.
      isBeforeOrAtMarketCloseEt: (_sessionYmd: string | null | undefined) => state.beforeClose,
    },
  });
});

const mod = () => import("./resolve-edition");

test("resolveNighthawkEdition: a recap-only edition published for TODAY is not stamped stale while still before its own close", async () => {
  const { resolveNighthawkEdition } = await mod();

  state.latest = row({ edition_for: "2026-10-20" });
  state.playable = null; // the recap-only query finds nothing — plays.length is 0
  state.byDate = null; // tomorrow's edition (the requested editionFor) hasn't published
  state.beforeClose = true;

  const edition = await resolveNighthawkEdition("2026-10-21", null);

  assert.equal(edition.recap_only, true, "fixture must actually be recap-only for this test to mean anything");
  assert.equal(edition.edition_for, "2026-10-20");
  assert.notEqual(edition.stale, true, "a current, on-time recap-only edition must not be marked stale");
  assert.notEqual(edition.carry_until_close, true, "recap-only editions don't carry plays forward");
});

test("resolveNighthawkEdition: a recap-only edition from a PAST day (already closed) is still marked stale", async () => {
  const { resolveNighthawkEdition } = await mod();

  // Within MAX_EDITION_AGE_DAYS (4) of the requested date so this exercises the stale-stamping
  // branch itself, not the separate "too old, give up" empty-edition branch above it.
  state.latest = row({ edition_for: "2026-10-19" });
  state.playable = null;
  state.byDate = null;
  state.beforeClose = false; // 2026-10-19 is no longer "today" / already past close

  const edition = await resolveNighthawkEdition("2026-10-21", null);

  assert.equal(edition.recap_only, true);
  assert.equal(edition.stale, true, "an old recap-only edition must still be disclosed as stale, not silently served as current");
  assert.equal(edition.served_for, "2026-10-19");
});

test("resolveNighthawkEdition: a non-recap (has plays) edition from a past day still gets stamped stale (no regression)", async () => {
  const { resolveNighthawkEdition } = await mod();

  state.latest = row({
    edition_for: "2026-10-19",
    recap_headline: null,
    recap_summary: null,
    plays: [{ ticker: "NVDA", direction: "LONG" }],
  });
  state.playable = null; // simulate the playable carry branch not matching (different scenario)
  state.byDate = null;
  state.beforeClose = false;

  const edition = await resolveNighthawkEdition("2026-10-21", null);

  assert.equal(edition.recap_only, false);
  assert.equal(edition.stale, true);
});

test("resolveNighthawkEdition: an explicit ?date= lookup is untouched by this fix (exact-match path, no stale stamping)", async () => {
  const { resolveNighthawkEdition } = await mod();

  state.latest = row({ edition_for: "2026-10-20" });
  state.playable = null;
  state.byDate = row({ edition_for: "2026-10-16" });
  state.beforeClose = true;

  const edition = await resolveNighthawkEdition("2026-10-16", "2026-10-16");

  assert.equal(edition.edition_for, "2026-10-16");
  assert.notEqual(edition.stale, true, "an exact-date match is never stamped stale");
});
