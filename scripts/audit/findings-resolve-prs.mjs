/**
 * Resolve UNRECONCILED FINDINGS entries against the PRs they cite.
 *
 * WHY: 194 entries carry `> **status:** \`UNRECONCILED\`` because no outcome was ever written
 * down. Most are not open work — they are finished fixes whose entry simply never got a status
 * line. The single strongest piece of machine-checkable evidence in those entries is a PR
 * reference: if the entry says "fixed in #1596" and #1596 is MERGED, the fix shipped.
 *
 * WHY IT IS FUSSY ABOUT WHAT COUNTS AS A PR REFERENCE: a bare `#\d+` scan is actively dangerous
 * here. One entry discusses the minified **React error #418**; PR 418 also exists and is merged,
 * so a naive scan "proves" that finding was fixed by a coincidence of numbering. A false FIXED
 * stamp is strictly worse than leaving an entry unreconciled — it hides a real bug behind a green
 * label, and nobody re-reads a resolved entry. So a reference is only accepted when the prose
 * explicitly frames it as a PR ("PR #123", "fixed in #123", "(#123)"), and entries mentioning
 * React/error codes are skipped wholesale.
 *
 * Every accepted stamp records WHICH PR and its merge commit, so the claim is auditable rather
 * than asserted. Anything that does not resolve is left exactly as it was.
 *
 * Usage:
 *   node scripts/audit/findings-resolve-prs.mjs              # dry run — report only
 *   node scripts/audit/findings-resolve-prs.mjs --apply      # rewrite resolved statuses
 *   GITHUB_TOKEN must be set (read-only use of the PRs API).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const FINDINGS = process.env.FINDINGS_RECONCILE_FINDINGS ?? "docs/audit/FINDINGS.md";
const APPLY = process.argv.includes("--apply");
const REPO = "coreentryadmin-web/blackout-web";
const TOKEN = process.env.GITHUB_TOKEN;

/** A reference only counts when the prose says it is a PR. See the header for why. */
const PR_CONTEXT =
  /(?:\bPR\s*#|\bpull\s*#|(?:fixed|merged|shipped|landed|resolved|closed)\s+(?:in|by|via)?\s*#|\(#)(\d{3,5})\b/gi;

/** Entries that discuss numbered ERROR codes are excluded: "React #418" is not PR 418. */
const NUMBER_IS_NOT_A_PR = /React\s*#\d+|error\s*#\d+|minified\s*#\d+|issue\s*#\d+/i;

const stripAnnotations = (b) => b.replace(/^> \*\*(kind|status):\*\*.*$/gm, "");

/**
 * Fetch a PR's merge state via curl, not global fetch.
 *
 * Node's built-in fetch ignores HTTPS_PROXY, and this sandbox reaches GitHub only through the
 * agent proxy — so fetch fails for every request. The first version of this script treated a
 * failed request as "not merged", which is the safe direction but silently produced "0 resolved"
 * and looked like a finding about the data rather than a bug in the tool. Network failure is now
 * distinguished from a genuine not-merged answer and aborts the run.
 */
function prState(n, cache) {
  if (cache.has(n)) return cache.get(n);
  const args = [
    "-sS", "--fail-with-body", "-H", `Authorization: Bearer ${TOKEN}`,
    "-H", "Accept: application/vnd.github+json",
    `https://api.github.com/repos/${REPO}/pulls/${n}`,
  ];
  let out;
  try {
    const raw = execFileSync("curl", args, { encoding: "utf8", maxBuffer: 8 << 20, stdio: ["ignore", "pipe", "ignore"] });
    const d = JSON.parse(raw);
    out = d && d.number
      ? { ok: true, merged: Boolean(d.merged_at), sha: d.merge_commit_sha }
      : { ok: true, merged: false, sha: null }; // a real 404: that number is not a PR
  } catch (err) {
    const body = String(err.stdout ?? "");
    if (/"status":\s*"404"|Not Found/.test(body)) out = { ok: true, merged: false, sha: null };
    else out = { ok: false, merged: false, sha: null };
  }
  cache.set(n, out);
  return out;
}

const src = readFileSync(FINDINGS, "utf8");
const parts = src.split(/\n(?=## )/);
const cache = new Map();
const resolved = [];
const skippedNumeric = [];
let unresolved = 0;

const out = [];
let netFailures = 0;
for (const block of parts) {
  if (!block.startsWith("## ") || !/`UNRECONCILED`/.test(block)) {
    out.push(block);
    continue;
  }
  const body = stripAnnotations(block);
  const head = block.split("\n")[0].slice(3, 78);

  if (NUMBER_IS_NOT_A_PR.test(body)) {
    skippedNumeric.push(head);
    unresolved++;
    out.push(block);
    continue;
  }

  const refs = new Set();
  PR_CONTEXT.lastIndex = 0;
  let m;
  while ((m = PR_CONTEXT.exec(body))) refs.add(m[1]);
  if (refs.size === 0) {
    unresolved++;
    out.push(block);
    continue;
  }

  const merged = [];
  for (const n of refs) {
    const st = prState(n, cache);
    if (!st.ok) netFailures++;
    if (st.merged) merged.push({ n, sha: (st.sha || "").slice(0, 8) });
  }
  if (merged.length === 0) {
    unresolved++;
    out.push(block);
    continue;
  }

  const cite = merged.map((x) => `#${x.n}${x.sha ? ` (${x.sha})` : ""}`).join(", ");
  resolved.push({ head, cite });
  // Write the outcome as a real `| **Status** | ... |` TABLE ROW, not into the `> **status:**`
  // annotation. That annotation is regenerated metadata owned by findings-reconcile.mjs — storing
  // the resolution there means a later regeneration silently reverts it to UNRECONCILED. The table
  // row is the entry's own durable record, and it is what the reconciler reads to decide an entry
  // is reconciled at all. Caught by the reconciler's own idempotency test.
  const row =
    `| **Status** | FIXED — shipped in ${cite}, confirmed merged via the GitHub API on ` +
    `2026-08-08 by \`scripts/audit/findings-resolve-prs.mjs\`. The entry never carried a status ` +
    `line; the PR it cites did the work. |`;
  const sep = block.match(/^\|[-\s|]+\|$/m);
  let stamped;
  if (sep) {
    const at = block.indexOf(sep[0]) + sep[0].length;
    stamped = block.slice(0, at) + "\n" + row + block.slice(at);
  } else {
    // No table in this entry: still emit the COMPLETE `| **Status** | ... |` row. Stripping the
    // pipes to make it read as prose breaks findings-reconcile.mjs's statusOf(), which needs the
    // closing `|` to capture the value — that mistake silently left 54 of 65 entries unresolved.
    const nl = block.indexOf("\n");
    stamped = block.slice(0, nl) + "\n\n" + row + block.slice(nl);
  }
  out.push(stamped);
}

if (netFailures > 0) {
  // Refuse to report. A network failure looks identical to "not merged" in the output, and acting
  // on that would leave real fixes stamped as open — or worse, invite a re-run that "resolves"
  // nothing and gets read as evidence the entries are genuinely outstanding.
  console.error(`ABORT: ${netFailures} GitHub request(s) failed. Results would be indistinguishable from "not merged". Check GITHUB_TOKEN / proxy and re-run.`);
  process.exit(2);
}
console.log(`=== UNRECONCILED entries resolved against cited PRs ===`);
console.log(`  ${String(resolved.length).padStart(3)}  RESOLVED (cited PR is merged)`);
console.log(`  ${String(unresolved).padStart(3)}  left UNRECONCILED (no PR cited, PR not merged, or numeric ref is not a PR)`);
console.log(`  ${String(skippedNumeric.length).padStart(3)}  of those skipped because the entry discusses a numbered ERROR code, not a PR`);
for (const s of skippedNumeric) console.log(`        ! ${s}`);
if (!APPLY) {
  console.log(`\n(dry run — pass --apply to rewrite)`);
  for (const r of resolved.slice(0, 10)) console.log(`   ${r.cite.padEnd(24)} ${r.head}`);
  process.exit(0);
}
writeFileSync(FINDINGS, out.join("\n"));
console.log(`\nAPPLIED: ${resolved.length} entries restamped in ${FINDINGS}`);
