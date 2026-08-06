# Deploying without GitHub — the outage playbook

**What this is:** how to build and ship production when GitHub Actions is unavailable, degraded,
or simply not the path you want to use.

**Why it exists:** on **2026-08-06** GitHub Actions went into a `major_outage` at 15:22 UTC.
`.github/workflows/ecr-push-production.yml` — the only path that built the production image *and*
the only path that rolled ECS — **is itself a GitHub Action**. The outage did not delay a deploy;
it removed the ability to ship at all, during an open market session, with a live members' desk on
the cluster.

The deploy was never actually GitHub-locked. Steps 5-8 of that workflow are plain
`aws ecs describe-services / describe-task-definition / register-task-definition / update-service`,
an inline `python3` task-def rewrite, a `curl` to Cloudflare, and `node scripts/validate-static-assets.mjs`.
Every one of those runs from any machine with credentials. They were locked in by **form, not
capability**: the code existed nowhere except inside a YAML file. `scripts/deploy/roll-ecs.mjs` is
that logic, extracted verbatim, runnable anywhere, with its decisions in tested pure functions.

---

## The two halves of a deploy

| Half | Normal path | Outage path |
|---|---|---|
| **Build + push image to ECR** | `ecr-push-production.yml` | CodeBuild project `blackout-web-image-build` |
| **Roll ECS + purge + validate** | `ecr-push-production.yml` steps 5-8 | `scripts/deploy/roll-ecs.mjs` (this doc) |

They are independent. An image already in ECR can be rolled by this script no matter how it got
there; this script never builds anything.

---

## Prerequisites

- AWS credentials for account `177922194517` with `ecs:DescribeServices`,
  `ecs:DescribeTaskDefinition`, `ecs:RegisterTaskDefinition`, `ecs:UpdateService`,
  `ecr:DescribeImages`, `secretsmanager:GetSecretValue`, and `iam:PassRole` for **both**
  `blackout-production-ecs-task` and `blackout-production-ecs-execution`
  (`register-task-definition` passes the task and execution roles).
- `aws` CLI and Node ≥ 20.9 on the machine.
- Optional, for `--purge`: `CF_ZONE_ID` and `CF_API_TOKEN` in the environment.

> **In this agent sandbox only:** placeholder `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` env
> vars override `~/.aws/credentials`, so **every** invocation must be prefixed
> `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`, or you get `InvalidClientTokenId`.
> The script detects that error and reminds you.

---

## Step 1 — get an image into ECR

If GitHub Actions is up, merge to `main` as usual and let it build; then skip to step 2 with the
merge commit SHA.

If it is down, use CodeBuild (see `buildspec.yml` and `scripts/codebuild/package-source.sh`):

```bash
# package the exact committed ref and upload it as the S3 source
scripts/codebuild/package-source.sh <git-ref>

env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
  aws codebuild start-build --project-name blackout-web-image-build --region us-east-1
```

The build pushes `<repo>:<sha>` and `<repo>:latest`. **It deliberately does not deploy** — its IAM
role grants no `ecs:*` and no `iam:PassRole`, so it is structurally incapable of rolling anything.

Confirm the image landed:

```bash
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
  aws ecr describe-images --repository-name blackout-web --region us-east-1 \
  --query 'reverse(sort_by(imageDetails,&imagePushedAt))[:5].{tags:imageTags,pushed:imagePushedAt}'
```

## Step 2 — rehearse with `--dry-run` (always)

`--dry-run` is **read-only by construction** — it makes only `describe-*` / `get-*` calls and
prints every mutating call it would otherwise make. It also writes the fully-rendered task
definition to a temp file so you can diff it against the live one before committing to anything.

```bash
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
  node scripts/deploy/roll-ecs.mjs --tag <sha> --service all --wait --purge --validate --dry-run
```

Read the output. Specifically check:

1. the image digest and tags are the build you meant;
2. `desiredCount` / `runningCount` look normal for the time of day;
3. the printed **live** `deploymentConfiguration` is what you expect (see below);
4. the `image: <container>: <old> -> <new>` line — this is the actual change;
5. the stale-secret strip list is empty or contains only keys you know were removed.

## Step 3 — roll it

```bash
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
  node scripts/deploy/roll-ecs.mjs --tag <sha> --service all --wait --purge --validate
```

Or `npm run deploy:ecs -- --tag <sha> --service all --wait --purge --validate`.

Expect **25-35 minutes** for a full web roll. That is normal — see the timeout note below.

---

## Flags

| Flag | Effect |
|---|---|
| `--tag <sha>` | **Required.** The image tag in ECR. `latest` is refused unless `--force`. |
| `--service web\|worker\|all` | Default `web`. `all` = web → purge → validate → worker. |
| `--wait` | Poll the PRIMARY deployment until it stabilises (up to 36 min). |
| `--purge` | Cloudflare `purge_everything` after the web roll. |
| `--validate` | `scripts/validate-static-assets.mjs`, 10 attempts 15s apart. |
| `--dry-run` | Print every mutating call, perform none. Read-only. |
| `--force` | Break-glass. Allows `:latest`/non-SHA tags **and** proceeds past a failed deployment-config assertion. |

---

## The design decisions you need to know before you use it

### 1. It reads the deployment configuration. It never writes it.

`update-service` is called **without `--deployment-configuration`, ever.** Instead the script
reads the live config, prints it, asserts it is sane, and exits non-zero if it is not.

The workflow hardcodes `minimumHealthyPercent=50,maximumPercent=112` for web. On 2026-08-06 that
hardcoded string silently **reverted an out-of-band incident fix**: an operator had raised web to
`100/120` by hand during a 5xx capacity incident, and the next merge to `main` stamped `50/112`
straight back over it. A deploy tool that re-asserts infra config on every run is a config-drift
machine — the value it writes is whatever was true the day someone typed it. Infra config belongs
to Terraform and to the operator's hands. This tool gets to have an opinion, and gets to refuse,
but not to change it.

The assertions:

- circuit breaker **enabled** and **rollback** — otherwise a bad task def leaves the service dead
  instead of reverting;
- `desiredCount == 1` requires `minimumHealthyPercent == 0` — ECS will not stop the only running
  task to start its replacement, so the roll deadlocks;
- `minimumHealthyPercent >= 100` requires a spare slot: `floor(desired × max/100) >= desired + 1`.
  This is exactly the arithmetic `112` fails at desired 5, 6, 7, 8 (`floor(5 × 1.12) = 5`) and
  `120` passes across the whole 5..12 autoscaling range.

### 2. `--force` bypasses that assertion, loudly. That is on purpose.

The assertion is a fail-closed guard sitting on the **break-glass path**. This script's entire
reason to exist is the incident where the normal path is gone. Today's live web config
(`100/120`) is itself an unusual-but-intentional state set by hand *during* an incident — precisely
the shape a guard like this trips on. **A deploy tool that can refuse during the incident it exists
for is a resilience regression.** So `--force` prints the failures in full, prints a warning
banner, and proceeds.

### 3. The stability poller is hand-rolled, not `aws ecs wait services-stable`.

Carried across verbatim from the workflow:

> Custom stability check: poll the PRIMARY deployment only. The built-in `services-stable` waiter
> blocks on ALL deployments including stale circuit-breaker leftovers that can never stabilize.

If you are reviewing this and about to suggest the built-in waiter — that comment is why not.

### 4. The timeout is 36 minutes, not 12.

At `minimumHealthyPercent=100 / maximumPercent=120` there is exactly one spare slot, so ECS
replaces tasks **strictly one at a time**. Each swap is ~2 min (task start + image pull + Next boot
+ ALB health checks + the 30s target-group deregistration drain), so a 12-task web roll takes
~24-30 min. The workflow's 12-minute budget would red-fail every *healthy* deploy. The circuit
breaker is what catches a genuinely bad one; the timeout only has to outlast a good one.

### 5. Purge before validate, always.

`validate-static-assets.mjs` fetches the site **through** Cloudflare, and Cloudflare edge-caches
the transient 404s that hashed `/_next/static/*` chunks throw during the rolling swap. Validate
first and those cached 404s fail the check for the whole retry window, the run exits non-zero
*before* the purge ever happens, the stale edge cache is never cleared, and a deploy that actually
rolled out fine is marked failed. `--service all` therefore runs **web → purge → validate → worker**.
Passing `--validate` without `--purge` prints a warning.

### 6. Preconditions that fail before anything is touched

- **`:latest` is refused** without `--force`. It is mutable and was repointed by hand on
  2026-08-06; every live task definition is SHA-pinned for the same reason (`:latest` also
  resolves stale after a failed deploy). Non-SHA tags are refused too, so a typo fails here
  instead of failing as a mid-roll `CannotPullContainerError`.
- **The tag must exist in ECR** (`ecr describe-images`). The workflow has no such check because it
  always deploys the image it just built. Standalone, a missing tag becomes a mid-roll
  `CannotPullContainerError` — which is exactly what took the market-worker to 0/1 running after
  an ECR lifecycle prune removed its pinned image.
- **An empty valid-secret-key set is refused.** The stale-secret filter drops `secrets[]` entries
  whose key is gone from Secrets Manager. If the Secrets Manager fetch ever returned an empty JSON
  object, filtering against it would strip all 74 refs and register a task definition with no
  environment — a total outage that looks like a successful deploy. `stripStaleSecretRefs` throws
  rather than allow it.

### 7. It never prints a secret value

Only key **names** and counts. The Secrets Manager `SecretString` is parsed in-process and is
never logged, not even in an error message.

---

## Worker/web drift is visible in the dry-run

The market-worker's task def is repointed on the same run, which is the point: it previously rolled
only by hand and rotted between touches — its pinned image got pruned by the ECR lifecycle policy
(`CannotPullContainerError`) and its `secrets[]` kept referencing removed keys
(`ResourceInitializationError`). Both took it to 0 running. As of 2026-08-06 it is pinned to an
**older** SHA than web (`00cd8464…` vs `0f39b85f…`), which the `--dry-run` output shows plainly on
the `image:` line.

---

## Verifying the script itself

```bash
npx tsx --test scripts/deploy/roll-ecs.test.ts     # pure-helper table tests
node --check scripts/deploy/roll-ecs.mjs
node --check scripts/deploy/lib/taskdef-rewrite.mjs
```

## Rollback

The circuit breaker (`enable` + `rollback`, verified by the assertion before every roll) reverts a
failed deploy automatically. To revert a *successful* deploy of a bad build, roll the previous SHA:

```bash
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
  node scripts/deploy/roll-ecs.mjs --tag <previous-good-sha> --service all --wait --purge --validate
```

The ECR lifecycle policy keeps **200** images (raised from 20 on 2026-08-06), so previous SHAs stay
pullable for a long time.

## Related

- `.github/workflows/ecr-push-production.yml` — the normal path this was extracted from.
- `buildspec.yml`, `scripts/codebuild/package-source.sh` — the CodeBuild build+push half.
- `docs/ops/RTH-OPEN-RUNBOOK.md` — what to check after a market-hours deploy.
- `docs/audit/MARKET-OPEN-VALIDATION.md` — the pre-open validation gate.
