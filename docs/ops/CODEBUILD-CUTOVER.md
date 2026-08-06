# CodeBuild cutover — building and deploying production without GitHub

**What this is:** the end-to-end runbook for shipping production through AWS CodeBuild —
package source, start a build, deploy, verify, and roll back.

**Status (2026-08-06):** the capability is complete and **has never been used to deploy**. Phase 1
(build + push) is proven — one real build succeeded in 4m03s and pushed to ECR. Phase 2 (the ECS
rollout) is wired but the first deploy on this path is a deliberate, supervised operator action.
**Do not let a queued batch of merges be its debut.**

---

## Read this first: what this cutover does NOT do

**Merging is still GitHub-dependent. This project does not change that.**

The required merge gate is the `verify` job in `.github/workflows/ci.yml` — it runs `tsc --noEmit`,
the unit tests, `next build`, and the auth/brand/vendor guards on every pull request. It is a GitHub
Action. When GitHub Actions is down:

- you **cannot** get a green required check,
- so you **cannot** merge a PR to `main` through the normal protected-branch path,
- and this pipeline does not help with that at all.

What this cutover buys is strictly the two steps *after* a commit exists:

| Step | Depends on GitHub? |
|---|---|
| Open a PR, get `verify` green, merge to `main` | **YES — unchanged, still blocked by a GH outage** |
| Build the image and push to ECR | No — CodeBuild |
| Roll ECS, purge Cloudflare, validate assets | No — `scripts/deploy/roll-ecs.mjs` |

This matters because it changes what you do during an outage. You are not blocked from *shipping* —
you are blocked from *merging*. `package-source.sh` takes **any committed ref**, not just `main`, so
during an outage you can build and deploy a commit that is sitting on a branch, then merge it
properly once GitHub returns. That is the actual outage workflow, and it means the branch you
deployed and the `main` you eventually merge must be reconciled by hand — write down what you
shipped.

Closing the merge gap needs a different change (a non-GitHub required check, or a documented
break-glass branch-protection bypass). It is out of scope here and **not done**.

---

## The two halves

| Half | Normal path | This path |
|---|---|---|
| Build + push image to ECR | `.github/workflows/ecr-push-production.yml` | CodeBuild `blackout-web-image-build` |
| Roll ECS + purge + validate | the same workflow, steps 5-8 | `scripts/deploy/roll-ecs.mjs` |

They are independent. **An image already in ECR can be rolled without any builder at all** — that
is the whole basis of the rollback procedure below.

Companion docs: `docs/ops/DEPLOY-WITHOUT-GITHUB.md` (the rollout tool in depth — flags, design
decisions, why the poller is hand-rolled) and `terraform/modules/codebuild/README.md` in
`blackout-infra` (the project, its IAM, and the kill switch).

---

## One-time checklist before the first deploying build

Work through all of it. Items 1-3 are the ones that will actually bite.

1. **Raise the CodeBuild project timeout.** It is currently **60 minutes**, and
   `--service all --wait` has a **75-minute worst case** (36-min stability poll per waited service
   + ~3 min for the purge settle and asset-validation retries). A typical roll is far shorter —
   web ~10-15 min at `desiredCount` 5-12, worker ~4 min — so 60 usually suffices, but "usually" is
   not a property you want on the deploy path.
   - In `blackout-infra`: set `build_timeout_minutes = 120`.
   - Then set `BUILD_TIMEOUT_MIN: "120"` in `buildspec.yml` to match. It is only used to compute
     the warning, but a stale value makes the warning lie.
   - Until both are done, **every** default deploy prints a loud budget WARNING. That is intended:
     it fires exactly while the misconfiguration exists and goes silent once fixed.

2. **Confirm both PRs are merged.** The buildspec's deploy block and the rollout script land in
   separate PRs and can merge in either order:
   - `blackout-web` — the roll-ecs artifact (`scripts/deploy/roll-ecs.mjs`)
   - `blackout-web` — this buildspec wiring

   If you package a ref that has the buildspec but not the script, `DEPLOY=1` fails **after** the
   push with an explicit message and nothing in production is touched. That is by design, but it
   wastes a build.

3. **Note which Node the build image gives you.** `buildspec.yml` hard-fails below Node 18 and
   warns below the repo's declared `engines` floor of 20.9. No `runtime-versions` pin was added,
   because changing the install phase would alter the already-green phase-1 build path without a
   way to test it. If the first `DEPLOY=1` run reports Node 18, add to `buildspec.yml`:

   ```yaml
   phases:
     install:
       runtime-versions:
         nodejs: 20
   ```

4. **Verify the deploy IAM is attached** (it is, as of 2026-08-06 — this confirms nobody pulled the
   kill switch):

   ```bash
   aws iam get-role-policy --role-name blackout-codebuild-web-build \
     --policy-name blackout-codebuild-web-deploy-policy --region us-east-1 \
     --query 'PolicyDocument.Statement[].Sid'
   ```

   Expect three Sids: `EcsRollTheTwoProductionServicesOnly`,
   `EcsTaskDefinitionActionsDoNotSupportResourceLevelPermissions`,
   `PassOnlyTheTwoEcsRolesAndOnlyToEcsTasks`. A `NoSuchEntity` means the deploy grants are
   off and the pipeline is back to build-only.

5. **Pick the window.** Market closed. Not with a batch of unrelated merges riding along.

---

## Normal deploy

### Step 1 — package the source

`git archive` of a committed ref, uploaded to S3, with the commit SHA stamped into the zip. There is
no webhook and no auto-trigger, deliberately — a GitHub webhook would put GitHub back on the
critical path this exists to remove.

```bash
scripts/codebuild/package-source.sh origin/main     # or any committed ref
```

### Step 2 — start the build

**Build only** (default, safe, changes nothing in production):

```bash
aws codebuild start-build --project-name blackout-web-image-build --region us-east-1
```

**Build and deploy** — the `DEPLOY=1` override is the only thing that can roll production here:

```bash
aws codebuild start-build --project-name blackout-web-image-build --region us-east-1 \
  --environment-variables-override name=DEPLOY,value=1,type=PLAINTEXT
```

The match is **exactly `1`**. `true`, `yes`, `on` all mean "do not deploy" — a strict match can only
fail the safe way, and the log states in one line what it saw and what it did.

Set the override **per build, never on the project.** A project-level `DEPLOY=1` turns every future
build into an unattended production rollout.

### Deploy knobs

All inert while `DEPLOY != 1`. Each maps 1:1 onto a `roll-ecs.mjs` flag — the buildspec assembles an
argv, it makes no deploy decisions. There is deliberately no free-form arg passthrough.

| Variable | Default | Flag | Notes |
|---|---|---|---|
| `DEPLOY` | `0` | — | Exactly `1` deploys. Nothing else does. |
| `DEPLOY_SERVICE` | `all` | `--service` | `web` \| `worker` \| `all` |
| `DEPLOY_WAIT` | `1` | `--wait` | Poll PRIMARY until stable (36 min budget per service) |
| `DEPLOY_PURGE` | `1` | `--purge` | Cloudflare `purge_everything` after the web roll |
| `DEPLOY_VALIDATE` | `1` | `--validate` | `validate-static-assets.mjs`, 10 × 15s |
| `DEPLOY_DRY_RUN` | `0` | `--dry-run` | Read-only rehearsal — describes only, mutates nothing |
| `DEPLOY_FORCE` | `0` | `--force` | Break-glass. Bypasses the deployment-config assertion. |

Multiple overrides:

```bash
--environment-variables-override \
  name=DEPLOY,value=1,type=PLAINTEXT \
  name=DEPLOY_SERVICE,value=web,type=PLAINTEXT
```

### Recommended first run — split it in two

Do **not** make the first use of this path a `DEPLOY=1 --service all` build. Split it, so a failure
in the build half cannot be confused with a failure in the deploy half:

```bash
# 1. build+push only, exactly as phase 1 already proved
scripts/codebuild/package-source.sh origin/main
aws codebuild start-build --project-name blackout-web-image-build --region us-east-1

# 2. rehearse the rollout, read-only, from your own machine
node scripts/deploy/roll-ecs.mjs --tag <sha> --service all --wait --purge --validate --dry-run

# 3. roll web ALONE, watching the poller
node scripts/deploy/roll-ecs.mjs --tag <sha> --service web --wait --purge --validate

# 4. then the worker
node scripts/deploy/roll-ecs.mjs --tag <sha> --service worker --wait
```

Once that sequence has been through a real market-closed window, `DEPLOY=1` end-to-end is the
routine path.

> **In this agent sandbox only:** placeholder `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` env vars
> override `~/.aws/credentials`, so every `aws` and `node scripts/deploy/...` invocation must be
> prefixed `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`.

### Step 3 — watch it

```bash
aws codebuild batch-get-builds --ids <build-id> --region us-east-1 \
  --query 'builds[0].{status:buildStatus,phase:currentPhase,phases:phases[].{n:phaseType,s:phaseStatus,secs:durationInSeconds}}'
```

Logs: CloudWatch group `/aws/codebuild/blackout-web-image-build`.

In the log the deploy block prints, in order: the `DEPLOY=1` banner with the tag, the
`roll-ecs argv` line (every flag named — this is where you confirm no `--force` snuck in), the Node
and AWS versions, the timeout budget arithmetic, `Cloudflare purge credentials: present`
(**names and presence only — no secret value is ever printed, and nothing in this path uses
`set -x`**), and then roll-ecs's own per-service output.

### Step 4 — verify

```bash
aws ecs describe-services --cluster blackout-production-cluster \
  --services blackout-production-web blackout-production-market-worker --region us-east-1 \
  --query 'services[].{name:serviceName,td:taskDefinition,desired:desiredCount,running:runningCount,rollout:deployments[0].rolloutState}'
```

Both services should show `rolloutState: COMPLETED` and `running == desired`, on a task definition
revision higher than before. Then:

- `curl -sI https://blackouttrades.com | head -1` → `200`
- `node scripts/validate-static-assets.mjs` (already run by `--validate`, but free to repeat)
- during RTH: `docs/audit/MARKET-OPEN-VALIDATION.md`, and `npm run healthcheck:0dte` for the
  Night Hawk subsystems

---

## Rollback

**Read this section before you need it.**

### Rolling back needs no builder, no CodeBuild, and no GitHub

The previous image is already in ECR. Rollback is one command from any machine with credentials:

```bash
node scripts/deploy/roll-ecs.mjs --tag <previous-good-sha> --service all --wait --purge --validate
```

That is the whole procedure. There is nothing to rebuild and nothing to package. If you remember one
thing from this document, remember that.

### Finding the previous good SHA

```bash
aws ecr describe-images --repository-name blackout-web --region us-east-1 \
  --query 'reverse(sort_by(imageDetails,&imagePushedAt))[:10].{tags:imageTags,pushed:imagePushedAt}'
```

Or ask the cluster what it was running before — the previous task definition revision holds the
image URI, and revisions are never deleted:

```bash
aws ecs describe-task-definition --task-definition blackout-production-web:<N-1> \
  --region us-east-1 --query 'taskDefinition.containerDefinitions[].image'
```

**The rollback window is now long.** The ECR lifecycle policy keeps **200** images, raised from 20
on 2026-08-06. At 20 the window was **22.7 hours** — and worse, `tagStatus: any` expires *in-use*
SHA tags, so the market-worker's own running image sat 12 pushes from deletion and a prune took it
to `CannotPullContainerError`. At 200 that class of failure is off the table for a long while.

### If a deploy fails mid-roll

**Usually you do nothing.** The deployment circuit breaker is enabled with `rollback: true` on both
services (verified live 2026-08-06, and `roll-ecs.mjs` re-asserts it before every roll). A task
definition that will not come up healthy is reverted by ECS automatically. Watch, do not intervene:

```bash
aws ecs describe-services --cluster blackout-production-cluster \
  --services blackout-production-web --region us-east-1 --query 'services[0].deployments'
```

### If CodeBuild times out mid-roll

**The rollout does not stop.** `update-service` was already issued; ECS keeps rolling under its
circuit breaker. What you lost is the watcher — and, with `--service all`, the worker roll that
would have followed the web roll.

**Do not re-run the build blindly.** Check the service state first (command above). Then finish just
the missing half:

```bash
node scripts/deploy/roll-ecs.mjs --tag <sha> --service worker --wait
```

This is the failure mode the budget WARNING in the deploy block is about, and the reason checklist
item 1 raises the project timeout.

### If web and worker end up on different images

`--service all` rolls web, then worker; it is not atomic. A worker failure after a web success
leaves them split. That is deliberate ordering — worker last, so a worker problem can never roll
back web — not a regression. Reconcile by rolling the worker alone:

```bash
node scripts/deploy/roll-ecs.mjs --tag <sha> --service worker --wait
```

### Killing the deploy capability entirely

If this pipeline ever needs to be made structurally incapable of deploying again — one call,
restores the exact phase-1 posture, and cannot disturb the ECR or Secrets Manager grants the build
still needs:

```bash
aws iam delete-role-policy --role-name blackout-codebuild-web-build \
  --policy-name blackout-codebuild-web-deploy-policy --region us-east-1
```

Through Terraform the same thing is `codebuild_enable_ecs_deploy = false`.

---

## Failure modes and what they mean

| Symptom | Cause | Action |
|---|---|---|
| `NOT DEPLOYED (DEPLOY='...')` | Override missing or not exactly `1` | Re-run with `value=1`. The image is already pushed — or just roll it with `roll-ecs.mjs`. |
| `FATAL: ... build is already failing` | `DEPLOY=1` on a build whose `build` phase failed | Fix the build. `post_build` runs even after a failed build; this gate is why that cannot ship. |
| `FATAL: scripts/deploy/roll-ecs.mjs is not in this source package` | Packaged a ref predating the roll-ecs PR | Re-package a newer ref. Image is pushed; deploy it separately. |
| `FATAL: node NN ... needs >= 18` | Build image Node too old | Pin `runtime-versions: nodejs: 20` (checklist item 3). |
| `image tag ... does not exist in ECR` | Rolling a SHA that was never pushed, or was pruned | Check `describe-images`. Nothing was touched — this precondition runs before any service. |
| `DEPLOYMENT-CONFIG ASSERTION FAILED` | Live `deploymentConfiguration` is unsafe (no circuit breaker, or a deadlocking min/max) | Fix the service config. `DEPLOY_FORCE=1` proceeds anyway — break-glass only. |
| `WARNING: CF_ZONE_ID/CF_API_TOKEN missing` | Keys absent from the production secret | The edge purge is skipped and `--validate` may false-fail on cached 404s. Purge by hand. |
| Budget `WARNING` on every deploy | Project timeout still 60 min | Checklist item 1. |

---

## What is NOT done

Stated plainly, because these are easy to assume away:

1. **Merging still requires GitHub.** The `verify` job in `ci.yml` is the required check and is a
   GitHub Action. This cutover makes **building and deploying** independent of GitHub. It does not
   make **merging** independent of GitHub. See the top of this document.
2. **No deploy has ever run through this path.** Every leg of the rollout is either ported verbatim
   from the live workflow or covered by unit tests, and the deploy block's control flow has been
   executed against stubs — but `register-task-definition` has no dry-run mode in AWS, so the
   register/update/poll legs are proven by construction, not by a live run.
3. **The deploy logic now exists in two places** — `ecr-push-production.yml` (canonical today) and
   `roll-ecs.mjs`. They will drift. The follow-up is to collapse the workflow onto the script; note
   the two are *intentionally* different on six points, so the merge is "delete the YAML copy", not
   "make them identical".
4. **The build role can now roll production.** Phase 1's "structurally cannot deploy" property is
   gone by design. The real boundary — a second CodeBuild project whose buildspec never executes
   repo code — is documented in `terraform/modules/codebuild/README.md` and **not built**. Worth
   doing before this path carries unattended deploys.
5. **No auto-trigger.** Builds are started by hand, on purpose. A GitHub webhook would put GitHub
   back on the critical path.
6. **The break-glass IAM user has no key.** `blackout-breakglass` exists with no access key and no
   console password; the operator must mint one and store it offline. An untested break-glass
   credential is not a break-glass credential — exercise it quarterly with a no-op
   `describe-services`.

---

## Related

- `docs/ops/DEPLOY-WITHOUT-GITHUB.md` — the rollout tool in depth.
- `buildspec.yml`, `scripts/codebuild/package-source.sh` — the build half.
- `scripts/deploy/roll-ecs.mjs` — the rollout half.
- `terraform/modules/codebuild/README.md` (blackout-infra) — project, IAM, kill switch.
- `.github/workflows/ecr-push-production.yml` — the normal path both halves were extracted from.
- `docs/audit/MARKET-OPEN-VALIDATION.md` — post-deploy validation during RTH.
