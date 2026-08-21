import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * CONTRACT C1, ENFORCED MECHANICALLY — a Largo-facing payload that stamps a UTC instant must also
 * carry an ET session anchor.
 *
 * WHY A TEST AND NOT A REVIEW RULE. In one night three separate lanes shipped the same defect:
 *   - #2418  OHLC bars carried an epoch and nothing else -> a dated close off by a full session.
 *   - #2420  Helix expiry rows carried a bare date -> a 1DTE row read as 0DTE, 12x too big.
 *   - #2422  Thermal's compare card stamps `as_of: new Date().toISOString()` -> same class.
 * A reviewer caught the third by eye. The first two were caught by accident. Three independent
 * lanes converging on one mistake is not carelessness, it is a missing guard.
 *
 * WHAT IS ACTUALLY WRONG. A UTC ISO instant is not itself incorrect — it is unambiguous and useful
 * for machine ordering. The defect is narrower: after ~20:00 ET the UTC **calendar date** is already
 * tomorrow, so a model asked "is this 0DTE?" and given only a UTC stamp resolves the session a full
 * day ahead. The fix is therefore ADDITIVE — keep the instant, add the ET session date — which is
 * exactly what #2420 did. This test does not ban `toISOString()`; it requires an anchor beside it.
 *
 * RATCHET, NOT A BIG BANG. 51 files predate the rule (11 found when it was written, 40 more when
 * ROOTS was widened from two directories to `src` on 2026-08-21 — see the ROOTS comment). Rewriting all of them at once would touch
 * five lanes' files simultaneously and cause exactly the merge conflicts the contract exists to
 * prevent. So they are listed explicitly below and the list can only shrink:
 *   - a NEW unanchored construction site fails immediately;
 *   - a listed file that has since been FIXED also fails, telling you to delete its entry.
 * The second rule is the one that keeps the list honest. An allowlist nobody prunes becomes a
 * permanent exemption, and this repo has been bitten by stale-by-omission before.
 */

/**
 * WHAT THE SCANNER LOOKS AT.
 *
 * This was `["src/lib/largo", "src/lib/bie"]` — where the three defects in the header were found.
 * Measured 2026-08-21: that reached **16** construction sites and could not see **40** others, so
 * the guard covered 29% of the surface while its failure message reads as a complete list. Two
 * of the misses are Largo-facing on their own (`/api/market/largo/context` stamps the context
 * payload; `bie-report`), and three fabricate rather than omit — `as_of: merged.polled_at ??
 * new Date().toISOString()` asserts the data was polled NOW when the upstream had no poll time.
 *
 * This file's own docblock names that failure mode: *"A guard with false NEGATIVES is worse than
 * no guard, because it converts 'unchecked' into 'checked and clean'."* It was true of the regex
 * and it was equally true of the search path. The rule was never "Largo and BIE stamp honestly" —
 * it is "a Largo-facing payload stamps honestly", and payloads are assembled in route handlers and
 * feature libs too.
 */
const ROOTS = ["src"];

/**
 * Constructs `as_of` / `asOf` from a UTC ISO string — a real runtime value, not a type.
 *
 * Matches BOTH the object-literal form (`as_of: new Date().toISOString()`) and the binding form
 * (`const as_of = new Date().toISOString()`). The binding form was missed by the first version of
 * this guard and hid a real site at `mini-panel.ts:46`, which renders member-visible Spot / Flip /
 * Call wall / Put wall rows. A guard with false NEGATIVES is worse than no guard, because it
 * converts "unchecked" into "checked and clean".
 */
const CONSTRUCTS_UTC_STAMP = /\b(as_of|asOf)\s*[:=]\s*[^,;]*toISOString\(\)/;

/**
 * A real ET anchor in the same module — a CALL to one of the shared helpers.
 *
 * Deliberately NOT the bare word `session_date`. That first version matched any occurrence, so a
 * file reading a `session_date` COLUMN out of the database (`session_date: row.session_date`)
 * counted as anchored and was silently exempted — `product-reads.ts` passed for exactly that
 * reason while still stamping UTC. Requiring the helper call means the file has actually derived
 * an ET session, not merely mentioned the word.
 */
const HAS_ET_ANCHOR = /etSessionDate\s*\(|etStamp\s*\(/;

/**
 * Files that construct a UTC stamp with no ET anchor, as of 2026-08-21. Each is a real gap and a
 * work item for its owning lane — NOT an exemption on the merits.
 */
const KNOWN_GAPS: Record<string, string> = {
  // ── Exposed 2026-08-21 when the guard was TIGHTENED. The first version matched the bare word
  // `session_date`, so a file merely READING a session_date column counted as anchored; and its
  // construction regex missed the `const as_of = ...` binding form. Six files were being exempted
  // by those two holes. They are gaps, not exemptions — the loose guard was reporting them clean.
  "src/lib/largo/morning-brief.ts": "coordinator",
  "src/lib/largo/play-similarity.ts": "coordinator",
  "src/lib/bie/answer-envelope.ts": "coordinator",
  "src/lib/bie/platform-context.ts": "coordinator",
  "src/lib/bie/full-platform-snapshot.ts": "coordinator — cross-product snapshot; anchor with the rest of the integration layer",
  "src/lib/bie/spx-desk-brief.ts": "coordinator (SPX lane)",
  "src/lib/bie/vector-full-state.ts": "vector lane",
  "src/lib/largo/slash-prompts.ts": "coordinator",
  "src/lib/largo/social-content-pack.ts": "coordinator — member-visible copy",
  // ── Exposed 2026-08-21 when ROOTS was WIDENED from ["src/lib/largo","src/lib/bie"] to ["src"].
  // 40 sites that were never scanned, listed here so `main` stays green and the ratchet keeps its
  // shrink-only shape rather than red-lining five lanes at once — the same "not a big bang" choice
  // the original 11 got. Each is a real gap and a work item for its owning lane, NOT an exemption.
  //
  // Deliberately a SEPARATE block appended below the original list: the entries above are being
  // deleted by PRs in flight, and keeping those lines where they are lets a one-line deletion merge
  // cleanly past these additions.
  //
  // Triage for whoever picks these up — they are not equally urgent:
  //   - `/api/market/largo/context` and `/api/admin/bie-report` assemble MODEL-facing payloads.
  //   - `lotto/today`, `spx/power-hour` and `cron/spx-evaluate` use
  //     `as_of: merged.polled_at ?? new Date().toISOString()`, which FABRICATES the anchor rather
  //     than omitting it — strictly worse, and the same shape as the fabricated `as_of` fixed in
  //     the Vector desk brief (#2427). A missing anchor is an absence a caller can notice.
  //   - the `/health`, `/ready`, `/boot` and `socket-health` routes stamp their OWN response time,
  //     where `as_of` genuinely does mean "now"; anchoring them is tidiness, not a correctness fix.
  "src/app/api/admin/bie-report/route.ts": "coordinator",
  "src/app/api/admin/playbook/fsm-today/route.ts": "coordinator",
  "src/app/api/cron/socket-health/route.ts": "coordinator",
  "src/app/api/cron/spx-evaluate/route.ts": "coordinator (SPX lane)",
  "src/app/api/cron/swing-active-refresh/route.ts": "coordinator (swings)",
  "src/app/api/health/route.ts": "coordinator",
  "src/app/api/market/banger/board/route.ts": "coordinator",
  "src/app/api/market/health/route.ts": "coordinator",
  "src/app/api/market/heatmap/route.ts": "coordinator",
  "src/app/api/market/largo/context/route.ts": "coordinator",
  "src/app/api/market/lotto/today/route.ts": "coordinator (0DTE)",
  "src/app/api/market/spx/power-hour/route.ts": "coordinator (SPX lane)",
  "src/app/api/worker/boot/route.ts": "coordinator",
  "src/app/api/worker/health/route.ts": "coordinator",
  "src/app/api/worker/ready/route.ts": "coordinator",
  "src/features/nighthawk/lib/option-chain-prompt.ts": "coordinator (Night Hawk)",
  "src/features/spx/lib/playbook-option-sim.ts": "coordinator (SPX lane)",
  "src/features/spx/lib/spx-commentary.ts": "coordinator (SPX lane)",
  "src/features/spx/lib/spx-desk-merge.ts": "coordinator (SPX lane)",
  "src/features/spx/lib/spx-desk-state.ts": "coordinator (SPX lane)",
  "src/features/spx/lib/spx-desk.ts": "coordinator (SPX lane)",
  "src/features/spx/lib/spx-play-engine.ts": "coordinator (SPX lane)",
  "src/features/spx/lib/spx-play-payload.ts": "coordinator (SPX lane)",
  "src/features/spx/lib/spx-signals.ts": "coordinator (SPX lane)",
  "src/features/spx/lib/spx-slayer-badge-map.ts": "coordinator (SPX lane)",
  "src/lib/admin-playbook-promotion.ts": "coordinator",
  "src/lib/market-health.ts": "coordinator",
  "src/lib/meridian/meridian-snapshot.ts": "meridian lane",
  "src/lib/nighthawk/cortex/compose.ts": "coordinator (Night Hawk)",
  "src/lib/nighthawk/cortex/sources/opening-harvest.ts": "coordinator (Night Hawk)",
  "src/lib/nighthawk/cortex/sources/wall-trend.ts": "coordinator (Night Hawk)",
  "src/lib/platform/index.ts": "coordinator",
  "src/lib/platform/zerodte-service.ts": "coordinator (0DTE)",
  "src/lib/platform/zerodte-sim-board.ts": "coordinator (0DTE)",
  "src/lib/providers/polygon-news.ts": "coordinator",
  "src/lib/swing/discovery.ts": "coordinator (swings)",
  "src/lib/swing/dossier.ts": "coordinator (swings)",
  "src/lib/thermal-discord-extras.ts": "thermal lane",
  "src/lib/zerodte/earnings.ts": "coordinator (0DTE)",
  "src/lib/zerodte/live-marks.ts": "coordinator (0DTE)",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    // `.tsx` too, now that ROOTS covers `src`: a payload assembled inside a server component is
    // exactly as model-facing as one assembled in a lib, and "the extension we happened to walk"
    // is not a principled boundary. No .tsx file offends today — this keeps it that way rather
    // than leaving a second reach gap of the same kind as the one that hid 40 sites.
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

function scan(): { anchored: string[]; unanchored: string[] } {
  const anchored: string[] = [];
  const unanchored: string[] = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const src = readFileSync(file, "utf8");
      if (!CONSTRUCTS_UTC_STAMP.test(src)) continue;
      (HAS_ET_ANCHOR.test(src) ? anchored : unanchored).push(file.replace(/\\/g, "/"));
    }
  }
  return { anchored, unanchored };
}

test("no NEW Largo payload stamps a UTC instant without an ET session anchor", () => {
  const { unanchored } = scan();
  const unexpected = unanchored.filter((f) => !(f in KNOWN_GAPS));
  assert.deepEqual(
    unexpected,
    [],
    `These files construct as_of/asOf from a UTC ISO string with no ET session anchor.\n` +
      `After ~20:00 ET the UTC calendar date is already tomorrow, so anything resolving a\n` +
      `session from this stamp is a full day ahead — the defect fixed in #2418, #2420 and #2422.\n` +
      `Fix (additive — keep the instant, add the anchor):\n` +
      `  import { etStamp, etSessionDate } from "@/lib/largo/temporal/bar-session-date";\n` +
      `  as_of: etStamp(Date.now()), session_date: etSessionDate(Date.now()),\n` +
      `Offenders:\n  ${unexpected.join("\n  ")}`
  );
});

test("the known-gap list SHRINKS — a fixed file must be removed from it", () => {
  // Without this, the allowlist becomes a permanent exemption and the rule quietly dies. A file
  // that now carries an anchor but is still listed is a stale entry, and stale-by-omission is a
  // failure mode this repo has paid for before.
  const { anchored } = scan();
  const staleEntries = anchored.filter((f) => f in KNOWN_GAPS);
  assert.deepEqual(
    staleEntries,
    [],
    `These files now carry an ET session anchor but are still listed in KNOWN_GAPS.\n` +
      `Delete their entries so the list keeps meaning what it says:\n  ${staleEntries.join("\n  ")}`
  );
});

test("every known gap still exists — the list cannot reference a moved or deleted file", () => {
  const { unanchored } = scan();
  const missing = Object.keys(KNOWN_GAPS).filter((f) => !unanchored.includes(f));
  assert.deepEqual(
    missing,
    [],
    `KNOWN_GAPS names files that no longer match the scan (moved, renamed or deleted).\n` +
      `An allowlist entry pointing at nothing hides a real gap somewhere else:\n  ${missing.join("\n  ")}`
  );
});

test("the scanner detects the real pattern and not a type declaration", () => {
  // Guards the guard. A scanner with false positives gets muted, and a muted scanner is worse
  // than none — so prove it fires on a construction and stays silent on a type.
  assert.ok(CONSTRUCTS_UTC_STAMP.test("  as_of: new Date().toISOString(),"));
  assert.ok(CONSTRUCTS_UTC_STAMP.test("  asOf: new Date(nowMs).toISOString(),"));
  // The BINDING form, missed by the first version of this guard (mini-panel.ts:46).
  assert.ok(CONSTRUCTS_UTC_STAMP.test("  const as_of = new Date().toISOString();"));
  assert.ok(!CONSTRUCTS_UTC_STAMP.test("  as_of: string;"), "a type declaration is not a stamp");
  assert.ok(!CONSTRUCTS_UTC_STAMP.test("  as_of?: string | null;"));
  assert.ok(!CONSTRUCTS_UTC_STAMP.test("  as_of: etStamp(Date.now()),"), "the correct form passes");
  assert.ok(HAS_ET_ANCHOR.test("session_date: etSessionDate(nowMs),"));
  assert.ok(HAS_ET_ANCHOR.test("as_of: etStamp(Date.now()),"));
  // Merely READING a session_date column is not deriving one — this was the false negative that
  // exempted product-reads.ts while it still stamped UTC.
  assert.ok(!HAS_ET_ANCHOR.test("    session_date: row.session_date,"), "a DB column read is not an anchor");
});

test("the scanner actually REACHES the whole payload surface, not just two directories", () => {
  // The 2026-08-21 widening: ROOTS was ["src/lib/largo","src/lib/bie"], which saw 16 construction
  // sites and missed 40 — including `/api/market/largo/context`, which stamps a model-facing
  // payload. A guard is only as good as its search path, and the search path had never been
  // audited because the regex was the part that had bugs. Assert the reach directly, so narrowing
  // ROOTS back (or "optimising" the walk) fails loudly instead of silently shrinking coverage.
  const files = ROOTS.flatMap((r) => walk(r));
  const reaches = (prefix: string) => files.some((f) => f.replace(/\\/g, "/").startsWith(prefix));
  assert.ok(reaches("src/lib/largo/"), "lib/largo — where the rule was written");
  assert.ok(reaches("src/lib/bie/"), "lib/bie");
  assert.ok(reaches("src/app/api/"), "route handlers assemble payloads too");
  assert.ok(reaches("src/features/"), "so do feature libs");
  assert.ok(
    files.some((f) => f.endsWith(".tsx")),
    "server components are not exempt by file extension"
  );
  // Test files are excluded on purpose: a fixture stamping a UTC instant is not a payload.
  assert.ok(!files.some((f) => /\.test\.tsx?$/.test(f)), "test files must stay out of the scan");
});

test("at least one file already does it right, so the rule is known-achievable", () => {
  // If this ever hits zero the rule has no working reference implementation and the guidance in
  // the failure message above is unproven.
  const { anchored } = scan();
  assert.ok(anchored.length > 0, "expected at least one anchored construction site");
});
