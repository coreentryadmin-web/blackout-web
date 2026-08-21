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
 * RATCHET, NOT A BIG BANG. 11 files predate the rule. Rewriting all of them at once would touch
 * five lanes' files simultaneously and cause exactly the merge conflicts the contract exists to
 * prevent. So they are listed explicitly below and the list can only shrink:
 *   - a NEW unanchored construction site fails immediately;
 *   - a listed file that has since been FIXED also fails, telling you to delete its entry.
 * The second rule is the one that keeps the list honest. An allowlist nobody prunes becomes a
 * permanent exemption, and this repo has been bitten by stale-by-omission before.
 */

const ROOTS = ["src/lib/largo", "src/lib/bie"];

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
  "src/lib/largo/slash-prompts.ts": "coordinator",
  "src/lib/largo/social-content-pack.ts": "coordinator — member-visible copy",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
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

test("at least one file already does it right, so the rule is known-achievable", () => {
  // If this ever hits zero the rule has no working reference implementation and the guidance in
  // the failure message above is unproven.
  const { anchored } = scan();
  assert.ok(anchored.length > 0, "expected at least one anchored construction site");
});
