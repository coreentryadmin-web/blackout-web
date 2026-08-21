/**
 * Find Largo-facing reads that publish a COUNTABLE EMPTY on a path that measured nothing.
 *
 * ── THE CLASS THIS FINDS ─────────────────────────────────────────────────────────────────────
 *
 * An unavailable payload that also carries `plays: []`, `blocked_total: 0`, `open_count: 0` tells
 * a model two contradictory things at once: "there is no data" and "here is the data, and it is
 * zero". Models read the number. In one morning this lane shipped four fixes for the same shape:
 *
 *   #2477  a ledger outage reported to members as a quiet session
 *   #2492  the same defect on `get_zerodte_plays`, the surface #2477 never reached
 *   #2495  `get_nighthawk_horizons` MANUFACTURED the empty array it then counted
 *   #2501  four tools' unavailable branches filled with zeros they had not measured
 *
 * Every one was found by reading code by eye. That does not scale to five lanes, so this makes the
 * question mechanical: show me every object literal that says `available: false` and still hands
 * out a number or a list.
 *
 * ── WHY A SCANNER AND NOT A CI RATCHET (YET) ─────────────────────────────────────────────────
 *
 * A ratchet needs an allowlist of known gaps. Several of the files it would list are fixed in PRs
 * that are open right now — and an allowlist entry that defers to an OPEN PR is a cross-PR
 * ordering dependency, which is precisely what made `main` red on 2026-08-21 (#2486): two
 * individually-green PRs merged in the wrong order and the shrink assertion fired downstream.
 *
 * So this ships read-only. Promoting it to a ratchet is a one-file change once the open fixes
 * land, and the coordinator owns that call because the allowlist would name four other lanes.
 *
 * ── WHAT IT DELIBERATELY DOES NOT FLAG ───────────────────────────────────────────────────────
 *
 * A MEASURED zero is not this defect. `{ available: true, plays: [] }` is a real answer — the
 * scanner only looks inside literals that say `available: false`, so a quiet session never trips
 * it. Comments and string literals are stripped first: `tool-defs.ts` explains this very class in
 * prose (`{whale_prints: 1, total_premium: 0}` is coherent, not a broken sum) and a scanner that
 * flagged its own documentation would be worse than useless.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_ROOTS = ["src/lib/largo", "src/lib/bie", "src/lib/zerodte", "src/lib/platform"];

/**
 * Remove comments and string literals so PROSE ABOUT the defect is never mistaken for the defect.
 * Order matters: block comments first, then line comments, then quoted strings — a `//` inside a
 * string would otherwise eat the rest of a real line.
 */
export function stripNonCode(src) {
  // Block comments are replaced by their OWN NEWLINES, not deleted. Deleting them collapses the
  // file and every line number reported afterwards is wrong — the first draft of this pointed at
  // a prose paragraph two hundred lines from the code it meant.
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const noLine = noBlock
    .split("\n")
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
  return noLine
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
}

/**
 * The object literal containing `index`, by brace matching — or null if it is not inside one.
 *
 * WHY NOT A LINE WINDOW. The first draft looked ten lines either side of `available: false` and
 * reported whatever empties it found. In `product-reads.ts` that flagged four clean
 * `{ available: false, error }` returns because an UNRELATED literal happened to sit nearby. A
 * guard with false positives teaches people to skim past it, which is worse than no guard.
 */
function enclosingLiteral(code, index) {
  let start = -1;
  let depth = 0;
  for (let i = index; i >= 0; i--) {
    if (code[i] === "}") depth++;
    else if (code[i] === "{") {
      if (depth === 0) { start = i; break; }
      depth--;
    }
  }
  if (start === -1) return null;
  depth = 0;
  for (let i = start; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") {
      depth--;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  return null;
}

/** Every `key: []` or `key: 0` in the SAME object literal as an `available: false`. */
export function findCountableEmpties(code) {
  const stripped = stripNonCode(code);
  const out = [];
  for (const m of stripped.matchAll(/available:\s*false/g)) {
    const literal = enclosingLiteral(stripped, m.index);
    if (!literal) continue;
    const empties = [...literal.matchAll(/(\w+):\s*(\[\]|0)\s*(?:,|\})/g)].map((x) => `${x[1]}: ${x[2]}`);
    if (!empties.length) continue;
    const line = stripped.slice(0, m.index).split("\n").length;
    out.push({ line, empties: [...new Set(empties)] });
  }
  return out;
}

export function walkTs(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walkTs(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p.replace(/\\/g, "/"));
  }
  return out;
}

/** @returns [{ file, sites: [{line, empties}] }] sorted by path. */
export function scanRoots(roots = DEFAULT_ROOTS) {
  const found = [];
  for (const root of roots) {
    for (const file of walkTs(root)) {
      const sites = findCountableEmpties(readFileSync(file, "utf8"));
      if (sites.length) found.push({ file, sites });
    }
  }
  return found.sort((a, b) => a.file.localeCompare(b.file));
}
