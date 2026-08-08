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

const FINDINGS = "docs/audit/FINDINGS.md";
const RUNLOG = "docs/audit/RUN-LOG.md";
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

function classify(block) {
  const head = block.split("\n")[0];
  const hay = `${head}\n${block.slice(0, 1500)}`;
  if (PASS_LOG.some((r) => r.test(hay))) return "PASS-LOG";
  if (NEGATIVE.some((r) => r.test(hay))) return "NEGATIVE-RESULT";
  if (OPS.some((r) => r.test(head))) return "OPS-NOTE";
  return "FINDING"; // conservative default
}

function statusOf(block) {
  const m = block.match(/\*\*Status\*\*\s*\|([^|]*)\|/);
  if (!m) return null;
  return m[1].trim();
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
const blocks = parts.filter((b) => b.startsWith("## ") && !/^## How to read this file/.test(b));

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
  if (/\n> \*\*kind:\*\*/.test(r.block)) return r.block; // idempotent
  const lines = r.block.split("\n");
  const needsStatus = r.status == null;
  const note = needsStatus
    ? "\n> **status:** `UNRECONCILED` — no status was ever recorded. Verify against git history and stamp FIXED (<sha>) / OPEN / SUPERSEDED.\n"
    : r.stale
      ? "\n> **status:** `UNRECONCILED` — recorded mid-flight (\"PR pending\"/\"auto-merge\") and never revisited. Confirm the merge and restamp.\n"
      : "";
  return [lines[0], KIND_LINE(r.kind).trimEnd(), note.trimEnd(), ...lines.slice(1)].filter(Boolean).join("\n");
});

writeFileSync(FINDINGS, preamble + tagged.join("\n"));

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
