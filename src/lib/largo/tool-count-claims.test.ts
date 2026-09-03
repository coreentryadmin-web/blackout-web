import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LARGO_TOOL_DEFS } from "@/lib/largo/tool-defs";
import { LARGO_CAPABILITIES } from "@/lib/largo/registry/capability-registry";

/**
 * PROSE THAT COUNTS THE TOOL SURFACE MUST TRACK THE TOOL SURFACE.
 *
 * The Phase 0 map found the same number written five different ways across the tree — 116, 120,
 * 126, 127 — against a real surface of 129, in comments that a reader has no reason to distrust.
 * None of it was load-bearing at runtime, which is exactly why it rotted: a stale comment cannot
 * fail, so nothing ever told anyone.
 *
 * It is not harmless. `tool-guard.ts`'s entitlement docstring argued its fail-OPEN policy from
 * "49 of 116 tools are catalogued … failing closed on the uncatalogued 67 would silently disable
 * most of Largo". Every one of the 129 is catalogued today, so a reader checking that reasoning
 * against reality finds the premise false and may conclude the policy is obsolete. It is not — but
 * the argument for it no longer stands on the numbers, and that is a dangerous thing to leave lying
 * around next to a security gate.
 *
 * WHAT THIS PINS. Each site below claims a count of the CURRENT surface. Renumbering them once
 * only resets the clock; this test is what stops them drifting again — add a tool, and CI names
 * every sentence that now lies.
 *
 * WHAT IT DELIBERATELY DOES NOT PIN — the distinction matters more than the check. A count that is
 * the DENOMINATOR OF A PAST MEASUREMENT is not a claim about today and must never be renumbered:
 * `largo-terminal.ts`'s "a mean of 21.9 (19%)" was measured against a 116-tool surface, and
 * rewriting 116 to 129 would silently falsify a real result. Those sites were rewritten to date
 * themselves instead, and are absent here on purpose. Likewise `tool-guard.test.ts`'s "the other
 * 127" is `129 - 2`, correct arithmetic that a blind renumber would have broken.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");

const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

/**
 * Sites asserting a count of the live surface. The pattern's one capture group is the number.
 * Deliberately anchored to enough surrounding words that it pins THAT sentence, not any stray
 * three-digit number in the file.
 */
const CLAIM_SITES: ReadonlyArray<{ file: string; label: string; pattern: RegExp }> = [
  {
    file: "src/lib/largo-terminal.ts",
    label: "capability hints are additive",
    pattern: /All (\d{2,4}) tools stay in the request/,
  },
  {
    file: "src/lib/largo-terminal.ts",
    label: "query plan does not filter",
    pattern: /the full (\d{2,4})-tool surface is still in/,
  },
  {
    file: "src/lib/largo/registry/capability-registry.ts",
    label: "registry header",
    pattern: /Largo is handed (\d{2,4}) tools/,
  },
  {
    file: "src/lib/largo/registry/capability-registry.ts",
    label: "ranking never filtering",
    pattern: /All (\d{2,4}) tools stay in\n/,
  },
  {
    file: "src/lib/largo/core/tool-guard.ts",
    label: "entitlement policy — catalogue coverage",
    pattern: /(\d{2,4}) of \d{2,4} today, and `registry\.test\.ts` holds/,
  },
  {
    file: "src/lib/largo/core/tool-guard.ts",
    label: "entitlement mix — premium vs admin",
    pattern: /(\d{2,4}) catalogued capabilities declare an entitlement/,
  },
  {
    file: "src/lib/largo/core/tool-guard.ts",
    label: "executor injection keeps the graph out",
    pattern: /free of the (\d{2,4})-tool dependency graph\. \*\//,
  },
  {
    file: "src/lib/providers/tool-result-cap.ts",
    label: "quotes tool-guard's own comment",
    pattern: /stays free of the (\d{2,4})-tool dependency graph"\)/,
  },
  {
    file: "src/lib/largo/tool-defs.ts",
    label: "deleted intent allowlist",
    pattern: /decided which of these (\d{2,4}) tools Claude was/,
  },
  {
    file: "src/lib/largo/core/tool-guard.test.ts",
    label: "admin capability pin",
    pattern: /(\d{2,4}) catalogued capabilities — one declares `admin`/,
  },
  {
    file: "scripts/audit/largo-truncation-probe.mjs",
    label: "lane list is a subset",
    pattern: /rather than all (\d{2,4}) —/,
  },
  {
    file: "src/lib/largo/registry/capability-registry.ts",
    label: "coverage pass — how the story ended",
    pattern: /coverage is (\d{2,4}) of \d{2,4}\n/,
  },
  {
    file: "src/lib/largo/core/plan.test.ts",
    label: "silence-means-no-proof still matters",
    pattern: /coverage is (\d{2,4}) of \d{2,4} —/,
  },
  {
    file: "docs/agents/briefs/largo.md",
    label: "charter — registry row",
    pattern: /capability-registry\.ts` — (\d{2,4}) tools/,
  },
  {
    file: "docs/agents/briefs/largo.md",
    label: "charter — count by product",
    pattern: /\| (\d{2,4}) tools total across/,
  },
  {
    file: "docs/agents/briefs/largo.md",
    label: "charter — Phase 0 inventory",
    pattern: /For each of the (\d{2,4}) tools, record/,
  },
  {
    file: "docs/agents/briefs/largo.md",
    label: "charter — probe every tool",
    pattern: /against every one of the (\d{2,4}) tools/,
  },
  {
    file: "docs/agents/briefs/largo.md",
    label: "charter — blast radius",
    pattern: /you own (\d{2,4}) tools through one transport layer/,
  },
];

test("every prose claim about the tool count matches the real tool count", () => {
  const actual = LARGO_TOOL_DEFS.length;

  // Sanity on the yardstick itself. If defs and capabilities ever diverge, "the tool count" stops
  // being one number and every claim below is ambiguous rather than merely wrong.
  assert.equal(
    LARGO_CAPABILITIES.length,
    actual,
    `defs (${actual}) and capabilities (${LARGO_CAPABILITIES.length}) disagree — fix registry.test.ts's 1:1 first`,
  );

  const wrong: string[] = [];
  for (const site of CLAIM_SITES) {
    const m = read(site.file).match(site.pattern);
    if (!m) continue; // absence is the OTHER test's job — see below
    if (Number(m[1]) !== actual) {
      wrong.push(`${site.file} (${site.label}): says ${m[1]}, actual ${actual}`);
    }
  }

  assert.deepEqual(
    wrong,
    [],
    `The tool surface changed and these sentences did not:\n  ${wrong.join("\n  ")}\n` +
      `\nUpdate each to ${actual}. If a site is the denominator of a PAST measurement, do not ` +
      `renumber it — date it and remove it from CLAIM_SITES instead.`,
  );
});

/**
 * The trap this repo has been bitten by before: an assertion that silently stops asserting.
 *
 * Every pattern above is keyed to a phrase. Reword the phrase and the match goes away — the loop
 * `continue`s, the test still passes, and the site drifts unwatched forever. So the patterns
 * matching AT ALL is itself pinned. A rewording is fine; a rewording that leaves this list stale
 * is not.
 */
test("every claim pattern still matches its site — no assertion may go quietly dead", () => {
  const dead = CLAIM_SITES.filter((s) => !s.pattern.test(read(s.file))).map(
    (s) => `${s.file} (${s.label}): /${s.pattern.source}/ matched nothing`,
  );

  assert.deepEqual(
    dead,
    [],
    `These claim patterns no longer match, so they are pinning nothing:\n  ${dead.join("\n  ")}\n` +
      `\nEither restore the phrase or update the pattern — do not delete the entry to get green.`,
  );
});

/**
 * L-10. `anthropicToolLoop` sends `raw.slice(0, MAX)`: it KEEPS THE HEAD and DISCARDS THE TAIL.
 * Seven places called that a "TAIL slice", which reads both ways — and the two readings are exact
 * opposites. Every one of them happened to reason correctly from it, but a payload designed on the
 * wrong reading puts its aggregates LAST, which is precisely the #2433 defect.
 *
 * Banned: "tail slice" / "TAIL-sliced". NOT banned: "tail-truncates" — truncating the tail can only
 * mean removing it. `tool-result-cap.ts` is exempt because it quotes the banned phrase in order to
 * correct it, and that correction is the reason this rule is writable at all.
 */
const AMBIGUITY_SCANNED: readonly string[] = [
  "src/lib/largo/fit-tool-result.ts",
  "src/lib/largo/nighthawk-edition-for-model.ts",
  "src/lib/largo/tool-defs.ts",
  "src/lib/largo-terminal.ts",
  "src/lib/providers/anthropic.ts",
  "scripts/audit/largo-truncation-probe.mjs",
  "docs/agents/briefs/largo.md",
  "docs/agents/briefs/helix.md",
  "docs/agents/briefs/spx-slayer.md",
];

/**
 * THE LIST ABOVE IS HAND-WRITTEN, AND A HAND-WRITTEN LIST IS EXACTLY WHAT ROTS.
 *
 * Worth recording plainly: the first draft of CLAIM_SITES missed four real sites — the two
 * historical measurements in `plan.ts` and `vector-analytics.ts`, and, worse, two live claims in
 * `capability-registry.ts` and `plan.test.ts` that asserted "51 of 118 catalogued" / "67 of 116
 * tools are uncatalogued" when the true figure is 0 uncatalogued. They were found by an ad-hoc
 * grep AFTER the enumerated test was already green — i.e. the enumerated test would have shipped
 * reporting a clean tree with four stale counts still in it.
 *
 * So this sweep does not depend on anyone remembering to add an entry. It scans the whole Largo
 * surface for the SHAPE these claims take — a three-digit number immediately followed by
 * "tools" / "capabilities" / "catalogued" — and requires each to be either the live count or
 * explicitly marked historical with a `then-` prefix. That pattern is deliberately narrow so it
 * cannot fire on `bytes: 300`, `slice(0, 120)`, `LARGO-110` or `Task #127`.
 *
 * The convention it enforces: writing `then-116` is how you say "this is the denominator of a past
 * measurement, do not renumber it". Anything else claiming a count must be current.
 */
const SWEEP_ROOTS: readonly string[] = [
  "src/lib/largo",
  "src/lib/largo-terminal.ts",
  "src/lib/providers/tool-result-cap.ts",
  "scripts/audit/largo-truncation-probe.mjs",
];

function sourceFilesUnder(rel: string, out: string[] = []): string[] {
  const full = join(REPO, rel);
  if (statSync(full).isDirectory()) {
    for (const name of readdirSync(full)) sourceFilesUnder(join(rel, name), out);
  } else if (/\.(ts|tsx|mjs)$/.test(rel)) {
    out.push(rel);
  }
  return out;
}

test("no unmarked stale tool count anywhere on the Largo surface — swept, not enumerated", () => {
  const actual = String(LARGO_TOOL_DEFS.length);
  const claim = /(?<!then-)\b(\d{3})[- ](?:tools?|capabilit(?:y|ies)|catalogued)\b/g;

  const files = SWEEP_ROOTS.flatMap((r) => sourceFilesUnder(r))
    // This file necessarily QUOTES the stale numbers in order to explain them, so scanning it
    // would make the guard permanently red on its own documentation.
    .filter((f) => !f.endsWith("tool-count-claims.test.ts"));

  const offenders: string[] = [];
  for (const file of files) {
    for (const line of read(file).split("\n")) {
      for (const m of line.matchAll(claim)) {
        if (m[1] === actual) continue;
        offenders.push(`${file}: ${line.trim().slice(0, 100)}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Stale tool counts, unmarked:\n  ${offenders.join("\n  ")}\n` +
      `\nEither correct them to ${actual}, or — if the number is the denominator of a PAST ` +
      `measurement — write it as "then-${m0(offenders)}" so it reads as history and stops being ` +
      `swept. Never renumber a measurement's denominator.`,
  );

  // The sweep must be able to see files at all. A roots list that silently resolves to nothing
  // would report a spotless tree forever.
  assert.ok(files.length > 50, `sweep found only ${files.length} files — the roots list is broken`);
});

/** Best-effort hint for the failure message; the guidance holds whatever number it picks. */
function m0(offenders: readonly string[]): string {
  return offenders[0]?.match(/\b(\d{3})\b/)?.[1] ?? "N";
}

test("the transport cap is never described as a 'tail slice' — it keeps the head", () => {
  const ambiguous = /tail[\s*_-]{0,4}slic/i;

  const offenders = AMBIGUITY_SCANNED.filter((f) => ambiguous.test(read(f))).map(
    (f) => `${f} — say what SURVIVES ("keeps the first N chars, discards the rest"), not what is cut`,
  );

  assert.deepEqual(offenders, [], `Ambiguous description of the transport cap:\n  ${offenders.join("\n  ")}`);

  // The scanner must be able to see the thing it bans, or it proves nothing. `tool-result-cap.ts`
  // carries the phrase deliberately, so it is the control: if the regex stops matching THERE, the
  // regex is broken, not the tree clean.
  assert.match(
    read("src/lib/providers/tool-result-cap.ts"),
    ambiguous,
    "control failed: the banned phrase is no longer detectable, so the clean result above is meaningless",
  );
});
