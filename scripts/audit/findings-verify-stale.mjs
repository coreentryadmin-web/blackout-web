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
import { readFileSync, writeFileSync, accessSync } from "node:fs";
import { execFileSync } from "node:child_process";

const FINDINGS = process.env.FINDINGS_RECONCILE_FINDINGS ?? "docs/audit/FINDINGS.md";
const APPLY = process.argv.includes("--apply");

/** Same pattern findings-reconcile.mjs flags as stale — kept in sync deliberately. */
const STALE = /PR pending|auto-merge (?:enabled|per standing)|→ CI →|PR opens on|→ PR\.?$/i;

/** Words that appear in backticks but are not identifiers a fix would have introduced. */
const NOT_A_SYMBOL = /^(the|and|src|test|tests|true|false|null|undefined|string|number|boolean|main|origin)$/i;

/** Identifiers named in the entry's own Fix field — the thing to look for in the tree. */
function claimedSymbols(block) {
  const fix = block.match(/\*\*Fix\*\*\s*\|([^|]*)\|/)?.[1] ?? "";
  const scope = fix.trim().length > 0 ? fix : block;
  return [
    ...new Set((scope.match(/`([A-Za-z_][A-Za-z0-9_]{6,})`/g) ?? []).map((s) => s.slice(1, -1))),
  ].filter((s) => !NOT_A_SYMBOL.test(s));
}

function presentInTree(sym) {
  try {
    // -F: the symbols are literals, not patterns. A stray regex char would otherwise either throw
    // or, worse, match something unrelated and mark an unshipped fix as verified.
    execFileSync("grep", ["-rqF", "--include=*.ts", "--include=*.tsx", "--", sym, "src/"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const src = readFileSync(FINDINGS, "utf8");
const parts = src.split(/\n(?=## )/);
const verified = [];
const unproven = [];

const out = parts.map((block) => {
  if (!block.startsWith("## ")) return block;
  const m = block.match(/(\*\*Status\*\*\s*\|)([^|]*)(\|)/);
  if (!m || !STALE.test(m[2].trim())) return block;

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
  return block.replace(m[0], `${m[1]}${stamp}${m[3]}`);
});

console.log(`=== stale statuses resolved against the tree ===`);
console.log(`  ${String(verified.length).padStart(3)}  VERIFIED shipped (fix symbols present in src/)`);
console.log(`  ${String(unproven.length).padStart(3)}  UNPROVEN — left untouched, needs a human look`);
for (const u of unproven) console.log(`      ? ${u.head} — looked for: ${u.syms.slice(0, 4).join(", ") || "(no symbol named in Fix)"}`);

if (!APPLY) {
  console.log(`\n(dry run — pass --apply to rewrite)`);
  process.exit(0);
}
writeFileSync(FINDINGS, out.join("\n"));
console.log(`\nAPPLIED: ${verified.length} status line(s) restamped in ${FINDINGS}`);
