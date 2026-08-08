/**
 * FINDINGS.md reconciler — classify every entry, split the noise out, stamp what's missing.
 *
 * WHY: FINDINGS.md reached 351 entries / 1.1MB with 240 carrying no status line at all. Those 240
 * are NOT 240 open issues — they are routine pass logs ("all validators GREEN"), negative results
 * ("RULED OUT"), and ops notes, filed under formatting identical to real findings. That conflation
 * is why the file can no longer answer "what is open", and why a P1 (the BREAKOUT ranker measuring
 * worse than random) sat awaiting a decision while smaller work shipped around it.
 *
 * WHAT IT DOES NOT DO: decide whether a finding is fixed. It cannot — that needs reading code and
 * git history per entry. It classifies by KIND and flags what a human/next session must resolve.
 * Anything it cannot confidently classify stays a FINDING, because the failure mode of dropping a
 * real finding is far worse than leaving one extra entry in the file.
 *
 * Usage:
 *   node scripts/audit/findings-reconcile.mjs            # dry run — prints the distribution
 *   node scripts/audit/findings-reconcile.mjs --apply    # rewrites FINDINGS.md + RUN-LOG.md
 */
import { readFileSync, writeFileSync } from "node:fs";

// Overridable so the idempotency test can drive the real script over a throwaway UNTAGGED fixture.
// Pointing it at the live FINDINGS.md instead would prove nothing: that file is already tagged, so
// the tagging branch short-circuits and the test passes even with the corruption bug restored —
// which is exactly what happened on the first attempt at this test.
const FINDINGS = process.env.FINDINGS_RECONCILE_FINDINGS ?? "docs/audit/FINDINGS.md";
const RUNLOG = process.env.FINDINGS_RECONCILE_RUNLOG ?? "docs/audit/RUN-LOG.md";
const APPLY = process.argv.includes("--apply");

/** A pass log records that a scheduled validation ran and was green. Valuable as history, noise in
 *  a findings file — CLAUDE.md already forbids opening docs-only PRs for them. */
const PASS_LOG = [
  /all validators GREEN/i,
  /Post-close fix agent/i,
  /^##.*\bGREEN\b.*(pass|run|sweep|check)/i,
  /pre-open (validation|gate).*(GREEN|clean)/i,
];

/** A ruled-out cause. Must be kept and must never read as open work — the whole point is that
 *  nobody re-investigates it. */
const NEGATIVE = [/RULED OUT/i, /NEGATIVE RESULT/i, /INSUFFICIENT DATA/i, /no evidence found/i];

/** Infra/ops housekeeping — real, but not a product finding. */
const OPS = [/^##.*\[ops\]/i, /^##.*\[infra drift\]/i, /^##.*\[P\d, infra/i];

/** Strip the annotation lines this script itself injects, so classification reads the ORIGINAL
 *  entry. Without this the tags shift real content out of the 1500-char window below and a re-run
 *  reclassifies entries it already tagged (observed: one NEGATIVE-RESULT silently became a
 *  FINDING on the second --apply). The written file was unaffected — tagged blocks are returned
 *  untouched — but the printed distribution lied, which is worse than useless in an audit tool. */
function stripAnnotations(block) {
  return block.replace(/^> \*\*(kind|status):\*\*.*$/gm, "");
}

function classify(block) {
  const body = stripAnnotations(block);
  const head = body.split("\n")[0];
  const hay = `${head}\n${body.slice(0, 1500)}`;
  if (PASS_LOG.some((r) => r.test(hay))) return "PASS-LOG";
  if (NEGATIVE.some((r) => r.test(hay))) return "NEGATIVE-RESULT";
  if (OPS.some((r) => r.test(head))) return "OPS-NOTE";
  return "FINDING"; // conservative default
}

/**
 * An entry's recorded outcome, from EITHER of the two places this file has used for it.
 *
 * Most entries carry a `| **Status** | ... |` row. But 34 of them declare the outcome in the
 * heading instead — `## 2026-08-08 - [P1, SEO] ... — FIXED` — and then spend the table on
 * Severity/Blast radius/Fix/Verification. Those are the MOST thoroughly reconciled entries in the
 * file, not the least: they were written by the same PR that shipped the fix.
 *
 * Reading only the Status row therefore mislabelled every one of them `UNRECONCILED`, i.e. it told
 * the next session to go verify 34 findings whose fix commit is cited in their own body. Found
 * when #1928's entry pushed the ratchet over its ceiling — the honest fix was to stop miscounting,
 * not to raise the ceiling.
 */
const HEADING_OUTCOME =
  /[—–-]\s*(FIXED|RESOLVED|SHIPPED|MERGED|SUPERSEDED|WONTFIX|NO ACTION|RULED OUT|NEGATIVE RESULT)\s*$/i;

/**
 * A prose status line: `**Status.** FIXED on \`cursor/rth-stale-cron-4002\`.`
 *
 * The THIRD place this file records an outcome, after the `| **Status** |` table row and the
 * heading suffix. 76 of the entries still flagged UNRECONCILED use it — they are not missing a
 * status, the reader was missing a format. Same shape of bug as the heading case (worth 34), found
 * the same way: by opening an entry the tool called unreconciled and seeing a status in it.
 *
 * Anchored to the line start so a "**Status.**" mentioned mid-sentence elsewhere cannot match.
 */
const PROSE_STATUS = /^\*\*Status\.?\*\*[:\s]*(.+)$/m;

function statusOf(block) {
  const m = block.match(/\*\*Status\*\*\s*\|([^|]*)\|/);
  if (m) return m[1].trim();
  const head = block.split("\n")[0].trim();
  const h = head.match(HEADING_OUTCOME);
  if (h) return h[1].toUpperCase();
  // Ignore this script's own `> **status:**` annotation — it is regenerated metadata, and reading
  // it back as the entry's status would make every already-annotated entry look reconciled.
  const p = stripAnnotations(block).match(PROSE_STATUS);
  return p ? p[1].trim() : null;
}

/** A status written mid-flight that was never revisited. These are the ones that make a merged
 *  change look like outstanding work. */
// Precedence made explicit: `$` binds only to its own alternative, so the anchored "→ PR." case is
// grouped separately from the unanchored phrases. Written flat it read as though the anchor applied
// to all of them (CodeQL alert 582) — the behaviour was right, the expression lied about it.
const STALE_STATUS = new RegExp(
  [
    "PR pending",
    "auto-merge (?:enabled|per standing)",
    "→ CI →",
    "PR opens on",
    "→ PR\\.?$", // anchored ON PURPOSE: a status that ENDS "→ PR" is a hand-off note, not an outcome
  ].join("|"),
  "i"
);

const src = readFileSync(FINDINGS, "utf8");
const parts = src.split(/\n(?=## )/);
const preamble = parts[0].startsWith("## ") ? "" : parts.shift();
// Skip the file's own legend. It quotes the pass-log phrasing while explaining that pass logs
// belong elsewhere, so a naive pass would classify the documentation as the thing it documents and
// move it to RUN-LOG.md. Caught by re-running the script on its own output — idempotency is the
// property that makes this safe to run again, so it is worth protecting explicitly.
const LEGEND = /^## How to read this file/;
const legend = parts.filter((b) => LEGEND.test(b)); // preserved verbatim, re-emitted below
const blocks = parts.filter((b) => b.startsWith("## ") && !LEGEND.test(b));

const counts = {};
const rows = blocks.map((b) => {
  const kind = classify(b);
  const status = statusOf(b);
  const stale = status != null && STALE_STATUS.test(status);
  counts[kind] = (counts[kind] ?? 0) + 1;
  return { block: b, kind, status, stale, head: b.split("\n")[0] };
});

const findings = rows.filter((r) => r.kind === "FINDING");
const noStatus = findings.filter((r) => r.status == null);
const staleStatus = findings.filter((r) => r.stale);
const fixed = findings.filter((r) => r.status && /FIXED|RESOLVED|SHIPPED/i.test(r.status) && !r.stale);

console.log("=== classification ===");
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
console.log("\n=== among FINDINGs ===");
console.log(`  ${String(fixed.length).padStart(4)}  resolved (FIXED/RESOLVED/SHIPPED)`);
console.log(`  ${String(staleStatus.length).padStart(4)}  stale status ("PR pending", "auto-merge …") — needs a git check`);
console.log(`  ${String(noStatus.length).padStart(4)}  no status line at all — needs a status`);
console.log(`\n  → ${staleStatus.length + noStatus.length} entries need a human/next-session decision`);

if (!APPLY) {
  console.log("\n(dry run — pass --apply to rewrite. Sample of what would MOVE to RUN-LOG.md:)");
  for (const r of rows.filter((x) => x.kind === "PASS-LOG").slice(0, 6)) console.log("   ", r.head.slice(0, 100));
  process.exit(0);
}

// ── apply ───────────────────────────────────────────────────────────────────────────────────
// Tag every retained entry with its kind so the file self-describes, and move pass logs out.
const KIND_LINE = (k) => `\n> **kind:** \`${k}\`\n`;

const keep = rows.filter((r) => r.kind !== "PASS-LOG");
const moved = rows.filter((r) => r.kind === "PASS-LOG");

const tagged = keep.map((r) => {
  if (/\n> \*\*kind:\*\*/.test(r.block)) return r.block.replace(/\s+$/, ""); // already tagged
  const lines = r.block.split("\n");
  const needsStatus = r.status == null;
  const note = needsStatus
    ? "> **status:** `UNRECONCILED` — no status was ever recorded. Verify against git history and stamp FIXED (<sha>) / OPEN / SUPERSEDED."
    : r.stale
      ? "> **status:** `UNRECONCILED` — recorded mid-flight (\"PR pending\"/\"auto-merge\") and never revisited. Confirm the merge and restamp."
      : null;
  // Only the OPTIONAL annotations may be dropped. The body lines are passed through as-is: an
  // earlier version ran .filter(Boolean) over the whole array, which also ate the trailing empty
  // line every block carries — so each --apply erased one blank separator and, after enough runs,
  // welded adjacent entries into a single line. Idempotency here is not a nicety: this script is
  // meant to be re-run as FINDINGS.md grows.
  const head = [lines[0], KIND_LINE(r.kind).trim(), note].filter((x) => x != null && x !== "");
  return [...head, ...lines.slice(1)].join("\n").replace(/\s+$/, "");
});

// Re-emit the legend. It is excluded from classification (it QUOTES the pass-log phrasing while
// explaining that pass logs live elsewhere, so a naive pass moves the documentation to RUN-LOG.md)
// — but excluding it from the OUTPUT too would delete it on every run.
// Canonical spacing: exactly one blank line between entries, every run. Each block above already
// had its trailing whitespace stripped, so joining with "\n\n" is a fixed point.
writeFileSync(
  FINDINGS,
  preamble.replace(/\s+$/, "") + "\n\n" + [...legend.map((l) => l.replace(/\s+$/, "")), ...tagged].join("\n\n") + "\n"
);

const runlogHeader = `# RUN LOG — routine validation passes

Moved out of FINDINGS.md on 2026-08-08. These entries record that a scheduled validation ran and
came back green. They are useful as history and were never findings; mixed into FINDINGS.md they
made it impossible to tell an open P1 from a finished chore.

New pass logs belong here, not in FINDINGS.md — see CLAUDE.md's issue-handling policy, which
already forbids opening docs-only PRs for GREEN audit logs.

---

`;
// APPEND, never overwrite. A second --apply finds few or no new pass logs (the first run already
// moved them), and a blind write would silently destroy the ones already relocated — turning a
// re-run into data loss. Read what's there, keep it, add only what's new.
let existing = "";
try {
  existing = readFileSync(RUNLOG, "utf8");
} catch {
  existing = runlogHeader;
}
const alreadyLogged = new Set(
  existing.split(/\n(?=## )/).filter((b) => b.startsWith("## ")).map((b) => b.split("\n")[0])
);
const fresh = moved.filter((r) => !alreadyLogged.has(r.head));
writeFileSync(RUNLOG, existing.replace(/\s+$/, "") + (fresh.length ? "\n\n" + fresh.map((r) => r.block).join("\n") : "") + "\n");

console.log(`\nAPPLIED: ${keep.length} entries retained + tagged, ${fresh.length} new pass log(s) appended to ${RUNLOG} (${moved.length} matched, ${moved.length - fresh.length} already there)`);
