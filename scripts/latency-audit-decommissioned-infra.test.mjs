// Regression guard: audit/tooling scripts must never reference infrastructure that no longer
// exists — the Railway CLI (all infra moved to AWS ECS, see CLAUDE.md's "Environment realities"
// section) or the decommissioned staging stack (staging.blackouttrades.com / the
// blackout-staging/app/env secret, deleted 2026-07-25).
//
// Before the original fix, three npm-wired scripts (`validate:latency-compare`,
// `validate:latency-burst`, `validate:largo-latency`) hard-coded BOTH dead dependencies as their
// default/only comparison target:
//   - `blackout-staging/app/env` no longer exists in Secrets Manager (confirmed live via
//     `secretsmanager.describe_secret` -> ResourceNotFoundException) — `execSync("aws
//     secretsmanager get-secret-value --secret-id blackout-staging/app/env ...")` throws before
//     the script does anything useful, with a cryptic AWS CLI error rather than a message that
//     points at the actual cause.
//   - `railway variables ...` shells out to a CLI this project no longer uses at all (Railway was
//     replaced by AWS ECS) — `spawnSync("railway", ...)` fails with ENOENT (binary not found) on
//     any machine that never had Railway installed for this purpose.
// Every invocation of these three scripts was therefore a guaranteed, immediate crash — dead
// tooling masquerading as live audit commands anyone (human or agent, per the STANDING
// PERFORMANCE/LATENCY AUDIT MANDATE's "pull real numbers first" instruction) could reach for.
//
// Two more npm-wired scripts carried the identical defect, found in a later sweep:
// `validate:helix-ui` (scripts/helix-ui-audit.mjs) called `loadSecret()` unconditionally with no
// try/catch in `main()` — the loaded value wasn't even used afterward, since `mintAppSession`
// takes no secret param — and `capture:marketing-modules`
// (scripts/capture-marketing-module-shots.mjs) defaulted `USE_STAGING_SECRET` to true (BASE
// defaulted to the staging host), so it hit the same unconditional `loadSecret()` call on any
// plain invocation. Both threw `ResourceNotFoundException` from AWS Secrets Manager before doing
// any real work.
//
// This test greps the fixed scripts' own source for the exact dead-infra literals rather than
// executing them (they make live network/AWS/Clerk calls, which don't belong in `npm test`) — the
// fastest, most direct proof the dead references are gone, and it fails loudly if either literal
// creeps back in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");

const TARGETS = [
  "scripts/compare-latency-envs.mjs",
  "scripts/latency-burst-audit.mjs",
  "scripts/largo-latency-compare.mjs",
  "scripts/helix-ui-audit.mjs",
  "scripts/capture-marketing-module-shots.mjs",
  "scripts/helix-live-api-survey.mjs",
];

// Functional patterns only — a *string-literal* staging base URL/secret-id (something the code
// would actually fetch/exec against) or a `railway` child-process invocation. Prose in header
// comments is allowed and expected to keep naming the decommissioned infra by name (that's how a
// future reader learns why staging is gone) — only real, executable references are forbidden.
const FORBIDDEN_PATTERNS = [
  { name: "staging base URL string literal", re: /["']https:\/\/staging\.blackouttrades\.com["']/ },
  { name: "blackout-staging secret-id string literal", re: /["']blackout-staging\/app\/env["']/ },
  { name: "railway child-process invocation", re: /spawnSync\(\s*["']railway["']/ },
];

for (const rel of TARGETS) {
  test(`${rel} carries no decommissioned-infra reference`, () => {
    const src = readFileSync(join(REPO_ROOT, rel), "utf8");
    for (const { name, re } of FORBIDDEN_PATTERNS) {
      assert.ok(!re.test(src), `${rel} still references decommissioned infra: ${name}`);
    }
  });
}
