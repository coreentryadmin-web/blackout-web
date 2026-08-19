import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Edition serve-path contracts: carry is live-only; stale fallback when edition_for mismatches.

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("edition route: carry_until_close only when date param is omitted (not historical ?date=)", () => {
  const src = read("src/app/api/market/nighthawk/edition/route.ts");
  assert.match(src, /const explicitDate = req\.nextUrl\.searchParams\.get\("date"\)/);
  assert.match(src, /!explicitDate &&[\s\S]*carry_until_close = true/);
});

test("edition route: latest fallback marks stale when served edition_for !== requested", () => {
  const src = read("src/app/api/market/nighthawk/edition/route.ts");
  assert.match(
    src,
    /if \(edition\.edition_for && edition\.edition_for !== editionFor\) \{\s*edition\.stale = true;/,
    "prior session plays must not masquerade as tonight's live board"
  );
});

// ── 2026-08-07 Legacy backlog: ?date= validation + zero-play editions ──────────

const ROUTE = "src/app/api/market/nighthawk/edition/route.ts";

test("?date= is validated and 400s rather than silently serving today as 'stale'", () => {
  // Live 2026-08-07: `?date=not-a-date` returned 200 with today's edition and `stale: true` — a bad
  // link showed a "stale" banner over data that was current.
  assert.match(read(ROUTE), /isValidEditionDate\(explicitDate\)/);
  assert.match(read(ROUTE), /status: 400/);
});

test("the validator rejects calendar overflow, not just the wrong shape", () => {
  // "2026-13-45" matches /^\d{4}-\d{2}-\d{2}$/ and is not a date. Re-implemented here to exercise
  // the exact rule the route states, since the handler itself needs a request to invoke.
  const isValid = (value: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return false;
    return d.toISOString().slice(0, 10) === value;
  };
  for (const good of ["2026-08-07", "2026-02-28", "2024-02-29"]) {
    assert.equal(isValid(good), true, `${good} must pass`);
  }
  for (const bad of ["not-a-date", "", "2026-8-7", "20260807", "2026-13-01", "2026-02-30", "2025-02-29", "2026-08-07T00:00:00Z"]) {
    assert.equal(isValid(bad), false, `${bad} must be rejected`);
  }
  // The route must carry this exact rule, not just a shape regex.
  assert.match(read(ROUTE), /d\.toISOString\(\)\.slice\(0, 10\) === value/);
});

test("a non-finite edition age fails CLOSED", () => {
  // `edAge > MAX` is FALSE for NaN, so an unparseable date used to sail past the staleness guard and
  // serve the latest edition as merely "stale". Verified: NaN comparisons are false either way.
  assert.equal(Number.NaN > 4, false);
  assert.equal(Number.NaN <= 4, false);
  assert.match(read(ROUTE), /!Number\.isFinite\(edAge\) \|\| edAge > MAX_EDITION_AGE_DAYS/);
});

test("a published edition with zero plays is flagged, and stays available", () => {
  // available MUST stay true — flipping it would show "publishes after the close" over a session
  // that already published, a worse lie than the one being fixed. The recap is real content.
  assert.match(read(ROUTE), /function markNoPlays/);
  assert.match(read(ROUTE), /edition\.available && edition\.plays\.length === 0/);
  assert.match(read(ROUTE), /no_plays: true/);
  // Applied on BOTH published-row paths (exact-date hit and latest-fallback), not just one.
  assert.equal((read(ROUTE).match(/markNoPlays\(/g) ?? []).length, 3, "definition + both return paths");
});

test("pre-publish empty shells are not cached (ops-collect false-positive guard)", () => {
  assert.match(read(ROUTE), /shouldCache:.*available !== false/s);
});
