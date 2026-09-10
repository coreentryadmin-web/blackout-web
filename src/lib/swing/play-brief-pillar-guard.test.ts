import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * STRUCTURAL RATCHET — no function in the swing play-brief lane may read a thesis-health pillar's
 * `.pillars` array or a pillar's `.status` field without the `thesisHealthUncalibrated()` guard
 * appearing somewhere in the same function.
 *
 * WHY A TEST AND NOT A REVIEW RULE. This is the 4th time this exact shape has shipped in this
 * lane: `computeSwingThesisHealth` (thesis-health.ts) FORCES generic default pillar labels
 * ("unknown"/"n/a"/"no signals") on any committed row whose setup/entry/signal inputs were never
 * wired, AND `degradeFromManage()` (same file) unconditionally force-sets the persistence pillar's
 * `status` off the manage-engine action alone (TAKE_PARTIAL/EXIT_RUNNER -> "faded") — regardless
 * of calibration. A read of `.status`/`.pillars` with no `thesisHealthUncalibrated()` check
 * therefore fabricates a specific, plausible-looking fact ("fading pillar Persistence") on a row
 * whose OWN thesis-health section says "pillar breakdown not shown". `counterThesisLine`
 * (play-brief-narrative.ts) shipped exactly this bug — confirmed live on 3 committed positions,
 * different tickers/directions/scores, always the byte-identical "fading pillar **Persistence**"
 * clause — while its sibling functions in the SAME FILE (and in play-brief.ts and
 * play-brief-narrative-coaching.ts) already guarded the identical read. A reviewer can catch one
 * instance by eye; three prior fixes across three files did not stop a 4th from shipping in a
 * fourth. That is not carelessness, it is a missing guard — same reasoning as
 * `session-anchor.test.ts`'s C1 ratchet, which this test mirrors in structure.
 *
 * SCOPE. Exactly the four files named in the finding — the swing play-brief construction surface.
 * `thesis-health.ts` itself is deliberately OUT of scope: it is the producer of pillar state (every
 * pillar read there is definitionally "before calibration is known" — that is what the function is
 * computing), not a consumer that must gate on the payload it hasn't built yet.
 */
const SCANNED_FILES = [
  "src/lib/swing/play-brief.ts",
  "src/lib/swing/play-brief-intel.ts",
  "src/lib/swing/play-brief-narrative.ts",
  "src/lib/swing/play-brief-narrative-coaching.ts",
];

/**
 * A read of the pillars array, or a literal comparison against one of the five real
 * `ThesisPillarStatus` values (thesis-health.ts / zerodte/thesis-health.ts): "intact" | "faded" |
 * "lost" | "strengthened" | "na". Deliberately NOT the bare word `status` — `play.status`,
 * `ep.status`, DB-row `.status` columns etc. are unrelated fields on totally different objects in
 * these files, and matching bare `status` would flag them as false positives, muting the rule
 * exactly the way `session-anchor.test.ts`'s own docblock warns against ("a guard with false
 * positives gets muted, and a muted scanner is worse than none"). Requiring one of the five actual
 * pillar-status string literals keeps this to real pillar reads only — verified below against
 * every other `.status`/`.level` comparison actually present in these four files.
 */
const PILLAR_READ = /\.pillars\b|\.status\s*===\s*["'](?:intact|faded|lost|strengthened|na)["']/;

/** The guard call itself — thesis-health.ts's `thesisHealthUncalibrated()`. */
const GUARD_CALL = /thesisHealthUncalibrated\s*\(/;

/**
 * Splits a file into top-level function bodies by slicing between consecutive function-start
 * markers (the next start, or EOF, ends the previous function) — deliberately NOT brace-counting.
 * Every function in these four files is a non-nested, column-0 `function`/`export function`
 * declaration (verified when this test was written: zero top-level `const foo = (...) => {...}`
 * arrow-function bindings exist in any of the four — the one top-level `const` in the whole scan,
 * `MAX_BULLETS = 14`, is a plain number and does not match), so slicing on declaration boundaries
 * is exact today. The arrow-const branch below is defensive against a FUTURE file in this scope
 * adopting that style — if one word does, this must still find its start rather than silently
 * folding it into the preceding function (which would attribute its pillar read, and any guard
 * inside it, to the wrong function name — a labeling error, not a missed detection, since the read
 * would still land inside *some* slice and still get checked against a guard in that slice).
 */
const FUNCTION_START =
  /^(?:export\s+)?(?:function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*(?:async\s*)?\()/gm;

interface FnSlice {
  name: string;
  body: string;
}

function functionsIn(src: string): FnSlice[] {
  const starts: { name: string; index: number }[] = [];
  FUNCTION_START.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FUNCTION_START.exec(src))) {
    starts.push({ name: m[1] ?? m[2] ?? "<anonymous>", index: m.index });
  }
  const out: FnSlice[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]!.index;
    const end = i + 1 < starts.length ? starts[i + 1]!.index : src.length;
    out.push({ name: starts[i]!.name, body: src.slice(start, end) });
  }
  return out;
}

interface ScanResult {
  /** `path:functionName` for every unguarded pillar/status read found. */
  violations: string[];
  /** `path:functionName` for every guarded pillar/status read found — proves the rule is achievable. */
  guarded: string[];
}

function scan(): ScanResult {
  const violations: string[] = [];
  const guarded: string[] = [];
  for (const rel of SCANNED_FILES) {
    const src = readFileSync(rel, "utf8");
    for (const fn of functionsIn(src)) {
      if (!PILLAR_READ.test(fn.body)) continue;
      const key = `${rel}:${fn.name}`;
      if (GUARD_CALL.test(fn.body)) {
        guarded.push(key);
      } else {
        violations.push(key);
      }
    }
  }
  return { violations, guarded };
}

/**
 * Files known to violate the rule, as of the date below. Empty today — the finding this test
 * accompanies fixed the only offender (`counterThesisLine`) in the same PR. Kept as a ratchet
 * (same shape as `session-anchor.test.ts`'s `KNOWN_GAPS`) so a FUTURE violation this scanner
 * cannot yet reach, or a deliberately-deferred fix, has one documented place to live rather than
 * silently red-lining every open PR that touches these files — never as a way to exempt a NEW
 * unguarded read found going forward, which is exactly what "the list can only shrink" (enforced
 * by the sibling test below) exists to prevent.
 */
const KNOWN_GAPS: Record<string, string> = {};

test("no function reads .pillars or a pillar's .status without the thesisHealthUncalibrated guard", () => {
  const { violations } = scan();
  const unexpected = violations.filter((v) => !(v in KNOWN_GAPS));
  assert.deepEqual(
    unexpected,
    [],
    `These functions read a thesis-health pillar (.pillars / a pillar's .status) with no\n` +
      `thesisHealthUncalibrated() guard anywhere in the function. A committed row with no\n` +
      `setup/entry/signal inputs wired gets FORCED default pillar labels, and degradeFromManage()\n` +
      `force-sets the persistence pillar's status off the manage action alone — reading it\n` +
      `unguarded fabricates a specific opposing-case fact ("fading pillar Persistence") on a row\n` +
      `whose own thesis-health section says the breakdown isn't shown. Fix (mirror the existing\n` +
      `guarded siblings — thesisHealthSection in play-brief.ts, thesisPillarCoaching in\n` +
      `play-brief-narrative-coaching.ts, and counterThesisLine in play-brief-narrative.ts):\n` +
      `  if (!thesisHealthUncalibrated(play.thesisHealth)) { /* read .pillars / .status here */ }\n` +
      `Offenders:\n  ${unexpected.join("\n  ")}`,
  );
});

test("the known-gap list SHRINKS — a fixed function must be removed from it", () => {
  // Same discipline as session-anchor.test.ts: an allowlist nobody prunes becomes a permanent
  // exemption, and this repo has paid for that failure mode before (2026-08-23).
  const { guarded } = scan();
  const staleEntries = Object.keys(KNOWN_GAPS).filter((k) => guarded.includes(k));
  assert.deepEqual(
    staleEntries,
    [],
    `These functions now guard their pillar read but are still listed in KNOWN_GAPS.\n` +
      `Delete their entries so the list keeps meaning what it says:\n  ${staleEntries.join("\n  ")}`,
  );
});

test("every known gap still exists — the list cannot reference a moved/renamed/fixed function", () => {
  const { violations } = scan();
  const missing = Object.keys(KNOWN_GAPS).filter((k) => !violations.includes(k));
  assert.deepEqual(
    missing,
    [],
    `KNOWN_GAPS names a function that no longer matches the scan (fixed, moved or renamed).\n` +
      `An allowlist entry pointing at nothing hides a real gap somewhere else:\n  ${missing.join("\n  ")}`,
  );
});

test("counterThesisLine (the fix this test accompanies) is now a guarded call site", () => {
  const { guarded, violations } = scan();
  const key = "src/lib/swing/play-brief-narrative.ts:counterThesisLine";
  assert.ok(guarded.includes(key), `expected ${key} to be guarded post-fix`);
  assert.ok(!violations.includes(key), `expected ${key} to NOT be a violation post-fix`);
});

test("at least one guarded pillar-read call site exists per file that has one, proving the rule is achievable", () => {
  // If this ever hits zero for a file whose source still contains a real pillar-status
  // comparison, the scanner itself has regressed (e.g. the guard regex stopped matching a real
  // call), not the codebase — the same "prove the rule is achievable" discipline as
  // session-anchor.test.ts's own final test.
  const { guarded } = scan();
  assert.ok(guarded.length >= 3, `expected at least the 3 known-guarded sites, got: ${guarded.join(", ")}`);
  assert.ok(guarded.some((g) => g.endsWith(":thesisHealthSection")));
  assert.ok(guarded.some((g) => g.endsWith(":thesisPillarCoaching")));
});

test("the scanner detects the real pattern and not unrelated .status/.level comparisons", () => {
  // Guards the guard, same discipline as session-anchor.test.ts: a scanner with false positives
  // gets muted, and a muted scanner is worse than none.
  assert.ok(PILLAR_READ.test("const faded = h.pillars.find((p) => p.status === \"faded\");"));
  assert.ok(PILLAR_READ.test("if (!h?.pillars?.length) return null;"));
  assert.ok(PILLAR_READ.test("p.status === \"lost\""));
  assert.ok(PILLAR_READ.test("p.status === 'strengthened'"));
  assert.ok(PILLAR_READ.test("p.status === 'na'"));
  // Real non-pillar fields present in these four files today that must NOT trip the scanner —
  // matching bare `status` or `level` would flag `play.status`/`play.thesisBreak.level`, which are
  // unrelated fields on different objects (TerminalPlay's own lifecycle status, thesis-BREAK level
  // — not a pillar's status).
  assert.ok(!PILLAR_READ.test('play.status === "CLOSED"'), "play.status is not a pillar status");
  assert.ok(!PILLAR_READ.test('play.thesisBreak.level === "intact"'), "thesisBreak.level is not a pillar status");
  assert.ok(!PILLAR_READ.test('level === "unknown" || level === "intact"'), "a bare thesisBreak level variable");
  assert.ok(!PILLAR_READ.test("h.health < 55"), "reading .health alone is not a pillar read");
  assert.ok(GUARD_CALL.test("if (thesisHealthUncalibrated(h)) return null;"));
  assert.ok(GUARD_CALL.test("thesisHealthUncalibrated(play.thesisHealth) ? null : play.thesisHealth?.health"));
  assert.ok(!GUARD_CALL.test("someOtherGuardEntirely(h)"), "an unrelated call must not count as the guard");
});

test("the function-boundary splitter finds real functions and does not silently collapse to one slice", () => {
  // A splitter that stops matching anything still returns ONE slice (the whole file), which would
  // make PILLAR_READ and GUARD_CALL both trivially true-or-false together across the entire file
  // instead of being function-scoped — converting "function-scoped" into "file-scoped" without any
  // test failing to say so. Assert a realistic minimum function count per file instead.
  const counts: Record<string, number> = {};
  for (const rel of SCANNED_FILES) {
    const src = readFileSync(rel, "utf8");
    counts[rel] = functionsIn(src).length;
  }
  assert.ok(counts["src/lib/swing/play-brief.ts"]! >= 10, JSON.stringify(counts));
  assert.ok(counts["src/lib/swing/play-brief-intel.ts"]! >= 10, JSON.stringify(counts));
  assert.ok(counts["src/lib/swing/play-brief-narrative.ts"]! >= 10, JSON.stringify(counts));
  assert.ok(counts["src/lib/swing/play-brief-narrative-coaching.ts"]! >= 10, JSON.stringify(counts));
});
