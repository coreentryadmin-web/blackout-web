/**
 * Restamp FINDINGS.md entries whose status was written mid-flight, by CHECKING THE CODE.
 *
 * WHY: 50 entries carry a status like "FIXED AND VERIFIED. PR pending → CI → auto-merge per
 * standing policy." That sentence describes the moment the entry was written, not an outcome. Days
 * later nobody can tell from the file whether the PR landed — so the work reads as open forever.
 * This is not hypothetical: the 2026-08-08 backlog listed "two Vector TA bugs, explicitly unfixed"
 * off exactly these statuses, when both (`filterRthBarsSec`, `trendAtBarStart`) had been on `main`
 * for days.
 *
 * HOW IT DECIDES — evidence, not assumption. The entry's own **Fix** field names the identifiers
 * the fix introduced. If those identifiers are present in `src/` today, the fix shipped. If they
 * are absent, the entry is LEFT ALONE and reported: a missing symbol might mean the PR never
 * merged, or that the fix was later refactored, and neither is safe to guess at. The script never
 * marks anything fixed on the strength of the status text alone — that text is the problem.
 *
 * Deliberately conservative: it only ever rewrites a status that already MATCHED the stale
 * pattern, and only to record what was verified plus how. It cannot invent a status for an entry
 * that never had one (those stay `UNRECONCILED` for findings-reconcile.mjs to flag).
 *
 * Usage:
 *   node scripts/audit/findings-verify-stale.mjs            # dry run — report only
 *   node scripts/audit/findings-verify-stale.mjs --apply     # rewrite verified statuses
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const FINDINGS = process.env.FINDINGS_RECONCILE_FINDINGS ?? "docs/audit/FINDINGS.md";
const APPLY = process.argv.includes("--apply");

/**
 * Same pattern findings-reconcile.mjs flags as stale — kept in sync deliberately.
 *
 * Built by joining an array rather than written as one flat literal so the precedence is visible:
 * `$` binds only to its own alternative, so ONLY the "→ PR" case is end-anchored. Written flat it
 * reads as though the anchor applied to every branch (CodeQL "missing regular expression anchor").
 * The behaviour was already right; the expression lied about it, exactly as it did in
 * findings-reconcile.mjs — this file copied the flat form from there before that was fixed.
 */
const STALE = new RegExp(
  [
    "PR pending",
    "auto-merge (?:enabled|per standing)",
    "→ CI →",
    "PR opens on",
    "→ PR\\.?$", // anchored ON PURPOSE: a status ENDING "→ PR" is a hand-off note, not an outcome
  ].join("|"),
  "i"
);

/** Words that appear in backticks but are not identifiers a fix would have introduced. */
const NOT_A_SYMBOL = /^(the|and|src|test|tests|true|false|null|undefined|string|number|boolean|main|origin)$/i;

/**
 * Does this backticked token actually look like CODE?
 *
 * Requires an uppercase letter (camelCase/PascalCase) or an underscore. A plain lowercase English
 * word in backticks — `detected`, `commit`, `expiry` — is prose the author emphasised, and grep
 * finds it in any codebase regardless of whether the fix shipped. Spot-checking pulled `detected`
 * out of a Fix section as "evidence", which is worth nothing: the whole method rests on the symbol
 * being distinctive enough that its presence means something.
 */
const LOOKS_LIKE_CODE = (s) => /[A-Z]/.test(s) || s.includes("_");

/**
 * Identifiers named in the entry's own FIX section — the thing to look for in the tree.
 *
 * Reads the `| **Fix** |` table cell, and failing that the prose `**Fix.**` section (up to the
 * next bold heading). Scoping to the fix is the whole basis of the evidence: a symbol named
 * anywhere else in the entry is usually describing the BUG — pre-existing code that is present in
 * `src/` whether or not the fix ever shipped.
 *
 * The earlier fallback was `scope = block`, i.e. the entire entry. Once this script learned the
 * prose status format, that fallback fired on all 18 newly-visible entries — every one of which
 * uses a prose Fix section — and reported them "VERIFIED" on the strength of symbols that prove
 * nothing. Returning [] when no fix section is found is the correct failure: the entry is then
 * reported UNPROVEN and left alone, which is the direction that cannot manufacture a green label
 * over a live bug.
 */
function claimedSymbols(block) {
  const cell = block.match(/\*\*Fix\*\*\s*\|([^|]*)\|/)?.[1];
  const prose = block.match(/^\*\*Fix\.?\*\*[:\s]*([\s\S]*?)(?=\n\*\*[A-Z]|\n## |$)/m)?.[1];
  const scope = (cell && cell.trim()) || (prose && prose.trim()) || "";
  if (!scope) return [];
  return [
    ...new Set((scope.match(/`([A-Za-z_][A-Za-z0-9_]{6,})`/g) ?? []).map((s) => s.slice(1, -1))),
  ].filter((s) => !NOT_A_SYMBOL.test(s) && LOOKS_LIKE_CODE(s));
}

function presentInTree(sym) {
  try {
    // Search src/ AND scripts/: plenty of these findings are about the audit and ops tooling, and
    // their fixes land in scripts/ (shouldRetryWatchdogFetch, auditGridApis, softFetchJson … all
    // live there). Searching only src/ reported six such entries UNPROVEN when the named symbol was
    // sitting in the tree — a safe direction to be wrong in, but wrong.
    //
    // -F: the symbols are literals, not patterns. A stray regex char would otherwise either throw
    // or, worse, match something unrelated and mark an unshipped fix as verified.
    execFileSync(
      "grep",
      ["-rqF", "--include=*.ts", "--include=*.tsx", "--include=*.mjs", "--include=*.cjs", "--", sym, "src/", "scripts/"],
      { stdio: "ignore" }
    );
    return true;
  } catch {
    return false;
  }
}

const src = readFileSync(FINDINGS, "utf8");
const parts = src.split(/\n(?=## )/);
const verified = [];
const unproven = [];

/** Drop the annotation lines findings-reconcile.mjs injects, so they can never be read back as
 *  the entry's own status. The prose matcher is line-anchored and those lines start with "> ", so
 *  this is belt-and-braces — but the annotation format is not this script's to depend on. */
const stripAnnotations = (b) => b.replace(/^> \*\*(kind|status):\*\*.*$/gm, "");

/**
 * Locate the entry's status, in EITHER shape it is written in.
 *
 * Returns the matched text plus a rewrite() that replaces only the status VALUE, leaving the
 * surrounding syntax (table pipes, or the `**Status.**` prefix) intact.
 *
 * This tool originally read only the `| **Status** | ... |` table row. findings-reconcile.mjs had
 * the same gap and it was worth 76 entries there — the file also records outcomes as prose
 * (`**Status.** PR pending.`), so ~14 stale statuses were invisible to the one tool built to
 * resolve them. Same bug, same file, second tool: worth fixing at the source rather than again.
 */
function findStatus(block) {
  const row = block.match(/(\*\*Status\*\*\s*\|)([^|]*)(\|)/);
  if (row) {
    return { text: row[2].trim(), rewrite: (s) => block.replace(row[0], `${row[1]}${s}${row[3]}`) };
  }
  // Line-anchored so a "**Status.**" mentioned mid-sentence cannot match.
  const prose = block.match(/^(\*\*Status\.?\*\*[:\s]*)(.+)$/m);
  if (prose) {
    return { text: prose[2].trim(), rewrite: (s) => block.replace(prose[0], `${prose[1]}${s.trim()}`) };
  }
  return null;
}

const out = parts.map((block) => {
  if (!block.startsWith("## ")) return block;
  const st = findStatus(stripAnnotations(block));
  if (!st || !STALE.test(st.text)) return block;

  const head = block.split("\n")[0].slice(3, 80);
  const syms = claimedSymbols(block);
  const hits = syms.filter(presentInTree);
  if (hits.length === 0) {
    unproven.push({ head, syms });
    return block; // leave it exactly as-is — absence of evidence is not evidence of absence
  }

  verified.push({ head, hits: hits.slice(0, 3) });
  // Do NOT quote the old status text here. It contains the very phrases STALE matches, so a
  // second run would re-match its own output and restamp forever, nesting quotes each pass. The
  // fact that it WAS stale is recorded by the "restamped from a mid-flight status" wording alone.
  const stamp =
    ` FIXED — shipped and verified present in \`main\` on 2026-08-08 by ` +
    `\`scripts/audit/findings-verify-stale.mjs\` (found: ${hits.slice(0, 3).map((h) => `\`${h}\``).join(", ")}). ` +
    `Restamped from a mid-flight status that was never revisited. `;
  // Rewrite against the ORIGINAL block so the annotation lines survive.
  const orig = findStatus(block);
  return orig ? orig.rewrite(stamp) : block;
});

console.log(`=== stale statuses resolved against the tree ===`);
console.log(`  ${String(verified.length).padStart(3)}  VERIFIED shipped (fix symbols present in src/ + scripts/)`);
console.log(`  ${String(unproven.length).padStart(3)}  UNPROVEN — left untouched, needs a human look`);
for (const u of unproven) console.log(`      ? ${u.head} — looked for: ${u.syms.slice(0, 4).join(", ") || "(no symbol named in Fix)"}`);

if (!APPLY) {
  console.log(`\n(dry run — pass --apply to rewrite)`);
  process.exit(0);
}
writeFileSync(FINDINGS, out.join("\n"));
console.log(`\nAPPLIED: ${verified.length} status line(s) restamped in ${FINDINGS}`);
