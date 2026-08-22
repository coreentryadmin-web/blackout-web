/**
 * Pure evaluation for "did every deploy-worthy commit on `main` actually reach production?"
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 *
 * On 2026-08-22 three commits touching `src/**` and `public/**` sat on `main` for roughly five
 * hours with no `ecr-push-production` run. Nothing was red. CI, CodeQL and Deploy-smoke all fired
 * on the same pushes; the deploy workflow alone did not. The concrete symptom was a member-facing
 * 404 on an asset that had been merged hours earlier, and it was found by a lane trying to verify
 * its own work on prod — not by any coordinator check.
 *
 * That is the shape of the failure: **merging is loud and deploying is silent.** A merge posts a
 * green check and a notification; a deploy that never starts posts nothing at all. The absence has
 * no event, so nothing surfaces it, and "merged" gets read as "shipped".
 *
 * ── WHY THE PATH FILTER MAKES THIS SUBTLE ────────────────────────────────────────────────────
 *
 * `ecr-push-production.yml` only runs for commits touching a fixed set of paths, so "no deploy
 * since the last merge" is USUALLY correct and healthy — an audit-script or docs commit is not
 * supposed to deploy. A check that ignores the filter cries wolf on every docs merge and is
 * therefore turned off within a day.
 *
 * The honest question is narrower: is there a commit that DOES match the deploy paths, with no
 * deploy run created after it? That is answerable, and it is the only form of the question worth
 * alerting on. Verified against the real incident: the three stalled commits carried 2, 6 and 4
 * deploy-path files respectively, so the filter does not explain them.
 */

/** The `paths:` filter from `.github/workflows/ecr-push-production.yml`. Keep in sync with it. */
export const DEPLOY_PATHS = [
  "deploy/Dockerfile",
  ".dockerignore",
  "next.config.mjs",
  "package.json",
  "package-lock.json",
  "src/",
  "public/",
  ".github/workflows/ecr-push-production.yml",
];

/** True when a changed-file path would trigger the production deploy workflow. */
export function isDeployPath(file) {
  if (typeof file !== "string" || !file) return false;
  return DEPLOY_PATHS.some((p) => (p.endsWith("/") ? file.startsWith(p) : file === p));
}

/**
 * True when a deploy-path file can actually change what a member is served.
 *
 * `src/` matches the workflow filter, so a TEST file legitimately triggers a deploy — but it
 * cannot alter the served app. Grading both the same way produces exactly the cry-wolf this file
 * warns about: the first live run of this check flagged a test-only commit as "production is
 * behind", which is true of the workflow and false of production. Severity is SPLIT rather than
 * suppressed, because a deploy workflow that does not fire is a real fault at any severity.
 */
export function isMemberFacing(file) {
  if (!isDeployPath(file)) return false;
  return !/\.test\.(ts|tsx|mjs|cjs|js)$/.test(file) && !file.includes("/__tests__/");
}

/** True when a commit's changed-file list would trigger a deploy. */
export function commitTriggersDeploy(files) {
  return Array.isArray(files) && files.some(isDeployPath);
}

/** True when a commit can change what members are served (deploy-path AND not test-only). */
export function commitIsMemberFacing(files) {
  return Array.isArray(files) && files.some(isMemberFacing);
}

/**
 * Decide whether production is behind `main`.
 *
 * `commits` — newest first, `{ sha, isoDate, files }`.
 * `deployRuns` — `{ createdAt, headSha, status, conclusion }`, any order.
 *
 * Returns `{ verdict, undeployed, newestDeployAt, reason }` where verdict is:
 *   'ok'      — every deploy-worthy commit has a deploy run created after it
 *   'behind'  — at least one does not
 *   'unknown' — not enough input to judge (NEVER reported as ok; absence is not health)
 */
export function evaluateDeployFreshness({ commits, deployRuns, nowIso } = {}) {
  if (!Array.isArray(commits) || commits.length === 0) {
    return { verdict: "unknown", undeployed: [], newestDeployAt: null, reason: "no commits supplied" };
  }
  if (!Array.isArray(deployRuns)) {
    return { verdict: "unknown", undeployed: [], newestDeployAt: null, reason: "no deploy-run list supplied" };
  }

  const times = deployRuns.map((r) => Date.parse(r.createdAt)).filter((t) => Number.isFinite(t));
  const newestDeploy = times.length ? Math.max(...times) : null;

  // A commit is covered when a deploy run was CREATED at or after it. Created, not completed:
  // a queued or in-progress run means the push was seen, which is the thing being checked.
  const undeployed = [];
  for (const c of commits) {
    if (!commitTriggersDeploy(c.files)) continue;
    const t = Date.parse(c.isoDate);
    if (!Number.isFinite(t)) continue;
    if (newestDeploy == null || newestDeploy < t) undeployed.push(c);
  }

  const newestDeployAt = newestDeploy == null ? null : new Date(newestDeploy).toISOString();
  if (undeployed.length === 0) {
    return { verdict: "ok", undeployed: [], newestDeployAt, reason: "every deploy-worthy commit has a later deploy run" };
  }

  const memberFacing = undeployed.filter((c) => commitIsMemberFacing(c.files));
  const oldest = undeployed[undeployed.length - 1];
  const ageMin =
    nowIso && Number.isFinite(Date.parse(nowIso))
      ? Math.round((Date.parse(nowIso) - Date.parse(oldest.isoDate)) / 60000)
      : null;
  return {
    verdict: "behind",
    severity: memberFacing.length > 0 ? "member-facing" : "test-only",
    undeployed,
    memberFacing,
    newestDeployAt,
    ageMin,
    reason:
      memberFacing.length > 0
        ? `${memberFacing.length} member-facing commit(s) on main with no deploy run created after them`
        : `${undeployed.length} deploy-worthy commit(s) undeployed, but all are test-only — the workflow still should have fired`,
  };
}
