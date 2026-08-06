/**
 * PURE helpers behind `scripts/deploy/roll-ecs.mjs` — the ECS roll extracted out of
 * `.github/workflows/ecr-push-production.yml` so the deploy is a testable artifact instead of
 * logic that only exists inside a YAML file.
 *
 * WHY THIS FILE EXISTS AT ALL: the production deploy was never GitHub-locked. Steps 5-8 of
 * `ecr-push-production.yml` are plain `aws ecs describe-services / describe-task-definition /
 * register-task-definition / update-service`, an inline `python3` task-def rewrite, a curl to
 * Cloudflare and `node scripts/validate-static-assets.mjs`. Every one of those runs from any
 * machine holding credentials. They were locked in by FORM, not capability — the code existed
 * nowhere except inside a workflow file, so only a GitHub runner could execute it. During the
 * 2026-08-06 GitHub Actions `major_outage` that meant there was no way to roll ECS at all.
 * Extracting it makes the deploy runnable from a laptop, from CodeBuild, or from an agent
 * sandbox — and, because the interesting logic now lives in pure functions, TESTABLE.
 *
 * Everything here is pure: no network, no `aws` shell-outs, no filesystem, no clock. All
 * mutating I/O lives in `roll-ecs.mjs`. Inputs are never mutated (structuredClone on entry).
 * Tests: `npx tsx --test scripts/deploy/roll-ecs.test.ts`.
 */

/** Read-only fields `describe-task-definition` returns that `register-task-definition` rejects. */
export const READ_ONLY_TASKDEF_FIELDS = Object.freeze([
  "taskDefinitionArn",
  "revision",
  "status",
  "requiresAttributes",
  "compatibilities",
  "registeredAt",
  "registeredBy",
  "deregisteredAt",
]);

/** A git commit SHA as a Docker tag: 7-40 lowercase hex (short SHA through full SHA). */
const GIT_SHA_TAG_RE = /^[0-9a-f]{7,40}$/;

/** Docker tag grammar: [A-Za-z0-9_][A-Za-z0-9._-]{0,127}. Also keeps shell/URI metacharacters out. */
const DOCKER_TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/**
 * Decide whether `--tag` is a safe deploy target.
 *
 * The rule that matters: **`:latest` is rejected unless `--force`.** On 2026-08-06 the
 * `blackout-web` `:latest` tag was repointed BY HAND at the image production was actually
 * running, to undo drift. A mutable tag that a human has moved is not a deploy target you can
 * reason about — the image it resolves to is a fact about someone's afternoon, not about a
 * commit. Every live task definition is SHA-pinned for the same reason (`:latest` also resolves
 * stale after a failed deploy). Non-SHA tags are likewise rejected without `--force`, so a typo
 * (`--tag mian`) fails here instead of failing later as a `CannotPullContainerError` mid-roll.
 *
 * @returns {{ok: true, tag: string, warnings: string[]} | {ok: false, error: string, warnings: string[]}}
 */
export function resolveImageTag({ tag, force = false } = {}) {
  const warnings = [];
  if (typeof tag !== "string" || tag.trim() === "") {
    return {
      ok: false,
      warnings,
      error: "--tag is required. Pass the git commit SHA of the image you intend to deploy (e.g. --tag 0f39b85f7ad29735ebcc56858180fe904cf0c05e).",
    };
  }
  const t = tag.trim();
  if (!DOCKER_TAG_RE.test(t)) {
    return {
      ok: false,
      warnings,
      error: `--tag ${JSON.stringify(t)} is not a legal Docker tag ([A-Za-z0-9_][A-Za-z0-9._-]{0,127}).`,
    };
  }
  if (t.toLowerCase() === "latest") {
    if (!force) {
      return {
        ok: false,
        warnings,
        error:
          "--tag latest is refused. `:latest` on blackout-web is MUTABLE and was repointed by hand on 2026-08-06; " +
          "it is not a safe deploy target by construction. Pass the explicit commit SHA instead, or --force if you " +
          "genuinely mean 'whatever :latest resolves to right now'.",
      };
    }
    warnings.push("--force accepted the MUTABLE :latest tag. The image this deploys is whatever :latest points at this second.");
    return { ok: true, tag: t, warnings };
  }
  if (!GIT_SHA_TAG_RE.test(t)) {
    if (!force) {
      return {
        ok: false,
        warnings,
        error: `--tag ${t} does not look like a git commit SHA (7-40 lowercase hex). Production images are SHA-tagged; pass --force if this tag is deliberate.`,
      };
    }
    warnings.push(`--force accepted the non-SHA tag ${t}.`);
  }
  return { ok: true, tag: t, warnings };
}

/** `<registry>/<repository>:<tag>` — the fully-qualified ECR image URI. */
export function buildImageUri({ registry, repository, tag }) {
  if (!registry || !repository || !tag) {
    throw new Error(`buildImageUri: registry, repository and tag are all required (got ${registry}/${repository}:${tag}).`);
  }
  return `${String(registry).replace(/\/+$/, "")}/${repository}:${tag}`;
}

/**
 * Point every container in the task definition at `imageUri`.
 *
 * The worker runs the SAME image as web (same repo, same SHA) — only its command/role/env differ
 * and those already live in the task def — so `image` is the only field this touches.
 *
 * @returns {{taskDef: object, changes: Array<{container: string|null, from: string|null, to: string}>}}
 */
export function rewriteImage(taskDef, imageUri) {
  if (typeof imageUri !== "string" || imageUri.trim() === "") {
    throw new Error("rewriteImage: imageUri is required.");
  }
  const next = structuredClone(taskDef ?? {});
  const containers = Array.isArray(next.containerDefinitions) ? next.containerDefinitions : [];
  if (containers.length === 0) {
    throw new Error("rewriteImage: task definition has no containerDefinitions — refusing to register an imageless task def.");
  }
  const changes = [];
  for (const c of containers) {
    changes.push({ container: c?.name ?? null, from: c?.image ?? null, to: imageUri });
    c.image = imageUri;
  }
  return { taskDef: next, changes };
}

/**
 * Recover the Secrets Manager secret ARN from a task def's `secrets[].valueFrom`.
 *
 * `valueFrom` is `arn:aws:secretsmanager:<region>:<acct>:secret:<name>-<suffix>:<KEY>::` — the
 * secret ARN is everything except the trailing three colon-delimited segments (KEY, version-stage,
 * version-id, the last two empty). Same slicing the workflow's inline python does
 * (`':'.join(s['valueFrom'].split(':')[:-3])`).
 *
 * Difference from the workflow, deliberate: the python `break`s out of the outer loop after the
 * FIRST container regardless of whether that container had any secrets, so a task def whose first
 * container carries no secrets would derive nothing. This scans until it finds a container that
 * actually has one. Identical on today's inputs (container 0 of both services carries all 74/…
 * refs) and strictly harder to break.
 *
 * @returns {string|null} the secret ARN, or null when no container references a secret.
 */
export function deriveSecretArn(taskDef) {
  for (const c of taskDef?.containerDefinitions ?? []) {
    for (const s of c?.secrets ?? []) {
      const valueFrom = s?.valueFrom;
      if (typeof valueFrom !== "string") continue;
      const parts = valueFrom.split(":");
      if (parts.length < 4) continue;
      const arn = parts.slice(0, -3).join(":");
      if (arn.startsWith("arn:") && arn.includes(":secretsmanager:")) return arn;
    }
  }
  return null;
}

/**
 * Drop `secrets[]` entries whose key is absent from the live Secrets Manager JSON.
 *
 * WHY: Terraform-generated task defs keep referencing keys later removed from the secret (e.g.
 * `NEXT_PUBLIC_WHOP_CHECKOUT_LIFETIME`). ECS resolves every ref at task start, so one dead ref
 * is a `ResourceInitializationError` and the whole service sits at 0 running.
 *
 * FAIL-CLOSED GUARD (new — the workflow has no equivalent): an EMPTY valid-key set is refused.
 * The workflow filters against whatever the Secrets Manager fetch produced; if that fetch ever
 * returned an empty JSON object, the filter would strip all 74 refs and happily register a task
 * def with no environment at all — a silent, total production outage dressed up as a successful
 * deploy. There is no legitimate case for filtering against zero keys, so it throws.
 *
 * @param {object} taskDef
 * @param {Iterable<string>|Set<string>} validKeys
 * @returns {{taskDef: object, stripped: Array<{container: string|null, name: string|null}>}}
 */
export function stripStaleSecretRefs(taskDef, validKeys) {
  const keys = validKeys instanceof Set ? validKeys : new Set(validKeys ?? []);
  if (keys.size === 0) {
    throw new Error(
      "stripStaleSecretRefs: refusing to filter against an EMPTY valid-key set — that would strip every secret ref " +
        "and register a task definition with no environment. Check that the Secrets Manager fetch actually succeeded.",
    );
  }
  const next = structuredClone(taskDef ?? {});
  const stripped = [];
  for (const c of next.containerDefinitions ?? []) {
    // Only touch containers that actually declare secrets. (The workflow's python assigns
    // `secrets: []` onto every container including ones that had none; harmless, but leaving
    // them untouched keeps the registered task def byte-closer to the one being replaced.)
    if (!Array.isArray(c?.secrets)) continue;
    const orig = c.secrets;
    for (const s of orig) {
      if (!keys.has(s?.name)) stripped.push({ container: c?.name ?? null, name: s?.name ?? null });
    }
    c.secrets = orig.filter((s) => keys.has(s?.name));
  }
  return { taskDef: next, stripped };
}

/** Remove the fields `describe-task-definition` returns but `register-task-definition` rejects. */
export function dropReadOnlyTaskDefFields(taskDef) {
  const next = structuredClone(taskDef ?? {});
  for (const k of READ_ONLY_TASKDEF_FIELDS) delete next[k];
  return next;
}

/**
 * Read the LIVE deployment configuration off a `describe-services` service object and decide
 * whether a roll against it can actually succeed.
 *
 * THE MOST IMPORTANT DESIGN DECISION IN THIS TOOL: `roll-ecs.mjs` never passes
 * `--deployment-configuration` to `update-service`. It READS the live config, PRINTS it, and
 * ASSERTS it is sane — it must never WRITE it.
 *
 * WHY: `ecr-push-production.yml` hardcodes `minimumHealthyPercent=50,maximumPercent=112` for web.
 * On 2026-08-06 that hardcoded string silently REVERTED an out-of-band incident fix — an operator
 * had raised web to 100/120 by hand during a 5xx capacity incident (50 lets a roll remove capacity
 * FIRST, draining the live member-facing tier to half; 112 deadlocks once minHealthy is 100), and
 * the next merge to main quietly stamped 50/112 back over it. A deploy tool that re-asserts infra
 * config on every run is a config-drift machine: the value it writes is whatever was true the day
 * someone typed it. Infra config belongs to Terraform and to the operator's hands; the deploy tool
 * gets to have an opinion about it, and gets to REFUSE, but not to change it.
 *
 * Assertions:
 *  - circuit breaker `enable` AND `rollback` — without rollback a bad task def leaves the service
 *    dead instead of reverting.
 *  - `desiredCount == 1` requires `minimumHealthyPercent == 0`: ECS will not stop the only running
 *    task to start its replacement, so the roll deadlocks and then times out.
 *  - `minimumHealthyPercent >= 100` requires a spare slot: the roll only progresses when
 *    `floor(desired × max/100) >= desired + 1`. This is the exact arithmetic 112 fails at desired
 *    5, 6, 7 and 8 (`floor(5 × 1.12) = 5`, zero spare slots) — the deadlock that motivated 120.
 *
 * These are advisory-but-fatal: `roll-ecs.mjs --force` prints the failures loudly and proceeds.
 * See the `--force` rationale there.
 *
 * @returns {{ok: boolean, failures: string[], notes: string[], config: object|null}}
 */
export function assertDeploymentConfigSane(service) {
  const failures = [];
  const notes = [];
  const name = service?.serviceName ?? "<unknown-service>";
  const dc = service?.deploymentConfiguration;

  if (!dc || typeof dc !== "object") {
    failures.push(`${name}: describe-services returned no deploymentConfiguration — cannot verify circuit breaker or roll headroom.`);
    return { ok: false, failures, notes, config: null };
  }

  const cb = dc.deploymentCircuitBreaker ?? {};
  if (cb.enable !== true) {
    failures.push(`${name}: deployment circuit breaker is NOT enabled — a failing task def would roll forever instead of aborting.`);
  }
  if (cb.rollback !== true) {
    failures.push(`${name}: circuit-breaker rollback is NOT enabled — a failing deploy would leave the service down instead of reverting to the last good task def.`);
  }

  const min = Number(dc.minimumHealthyPercent);
  const max = Number(dc.maximumPercent);
  const desired = Number(service?.desiredCount);

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    failures.push(`${name}: minimumHealthyPercent/maximumPercent are not both numeric (min=${dc.minimumHealthyPercent}, max=${dc.maximumPercent}).`);
    return { ok: failures.length === 0, failures, notes, config: dc };
  }

  if (!Number.isFinite(desired)) {
    notes.push(`${name}: desiredCount unavailable — headroom checks skipped.`);
    return { ok: failures.length === 0, failures, notes, config: dc };
  }
  if (desired === 0) {
    notes.push(`${name}: desiredCount=0 — nothing to roll; headroom checks skipped.`);
    return { ok: failures.length === 0, failures, notes, config: dc };
  }

  if (desired === 1 && min !== 0) {
    failures.push(
      `${name}: desiredCount=1 with minimumHealthyPercent=${min} DEADLOCKS — ECS will not stop the only running task to start its replacement. A 1-task service needs minimumHealthyPercent=0.`,
    );
  }

  // A multi-task service with min < 100 is NOT a deadlock — ECS can always drain and replace —
  // so this is a NOTE, never a failure. But it is not free either: the service runs degraded for
  // the whole roll, at ceil(desired × min/100) of desired. That is exactly how prod web sat at
  // 50/112 (drained to 3 of 5, a 40% capacity loss per deploy) while this guard stayed silent,
  // because the arithmetic below only runs when min >= 100. Surfacing it means the number is in
  // every deploy log instead of only being found by someone reading describe-services by hand.
  if (min < 100) {
    const floorTasks = Math.ceil((desired * min) / 100);
    const lostPct = Math.round(((desired - floorTasks) / desired) * 100);
    if (lostPct > 0) {
      notes.push(
        `${name}: minimumHealthyPercent=${min} lets the roll drain to ${floorTasks} of ${desired} task(s) — up to ${lostPct}% capacity loss while deploying. Not a deadlock; raise to 100 (with maximumPercent >= 100×(desired+1)/desired) for a zero-loss roll.`,
      );
    }
  }

  if (min >= 100) {
    const ceiling = Math.floor((desired * max) / 100);
    if (ceiling < desired + 1) {
      failures.push(
        `${name}: minimumHealthyPercent=${min} with maximumPercent=${max} leaves NO spare slot at desiredCount=${desired} — floor(${desired} × ${max}/100) = ${ceiling}, needs >= ${desired + 1}. The roll can never start a replacement task and will time out.`,
      );
    } else {
      notes.push(
        `${name}: minimumHealthyPercent=${min} → SERIAL replacement (${ceiling - desired} spare slot(s) at desiredCount=${desired}); expect ~${desired} sequential task swaps.`,
      );
    }
  }

  return { ok: failures.length === 0, failures, notes, config: dc };
}

/**
 * Verdict for one poll of the PRIMARY deployment. Ported VERBATIM from the workflow's poll loop:
 * `rolloutState == COMPLETED` → done; `FAILED` → fail; `running == desired && desired != 0` → done.
 *
 * @returns {{verdict: "COMPLETED"|"FAILED"|"PENDING", detail: string, running: number, desired: number, rollout: string}}
 */
export function evaluateStability(primary) {
  const running = Number(primary?.runningCount ?? 0) || 0;
  const desired = Number(primary?.desiredCount ?? 0) || 0;
  const rollout = typeof primary?.rolloutState === "string" ? primary.rolloutState : "UNKNOWN";

  if (!primary || typeof primary !== "object") {
    return { verdict: "PENDING", detail: "no PRIMARY deployment reported yet", running, desired, rollout };
  }
  if (rollout === "COMPLETED") {
    return { verdict: "COMPLETED", detail: "rolloutState=COMPLETED", running, desired, rollout };
  }
  if (rollout === "FAILED") {
    const reason = typeof primary.rolloutStateReason === "string" ? primary.rolloutStateReason : "rolloutState=FAILED";
    return { verdict: "FAILED", detail: reason, running, desired, rollout };
  }
  if (running === desired && desired !== 0) {
    return { verdict: "COMPLETED", detail: `running == desired (${running}/${desired})`, running, desired, rollout };
  }
  return { verdict: "PENDING", detail: `running=${running}/${desired}, rollout=${rollout}`, running, desired, rollout };
}
