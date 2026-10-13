## 2026-10-13 — [FINDING, P2 infra/ops, CI/CD] `dependabot-auto-merge.yml` merges with GITHUB_TOKEN — every Dependabot merge silently skips CI re-run and production deploy — FIXED

> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| `.github/workflows/dependabot-auto-merge.yml` (CI/CD infra) | P2 — silent, no red check anywhere, affects every Dependabot merge | FIXED |

**What's wrong.** Measured live during a routine coordinator cycle, not found by inspection:
`dependabot-auto-merge.yml` auto-merged two real Dependabot PRs in quick succession —
`#5938` (`actions/upload-artifact` 4→7, `github_actions` ecosystem) and `#5939` (a 9-package
npm `minor-and-patch` group including real application dependencies: `@clerk/nextjs`,
`@anthropic-ai/sdk`, `@aws-sdk/client-secrets-manager`, `resend`, `playwright`, `postcss`,
`docx`, `@tanstack/react-virtual`, `@types/node`). Checked `GET /repos/.../actions/runs?
head_sha=<merge-commit>` for both merge commits on `main`:

- `#5938`'s squash-merge commit (`1aba0625a`): **`total_count: 0`** — zero workflow runs of
  any kind.
- `#5939`'s squash-merge commit (`de86fef58`): **`total_count: 1`** — only an unrelated
  `workflow_run`-triggered entry (`BLACKOUT Autopilot dispatch`), no `verify` re-run, no
  CodeQL, and critically no `ecr-push-production.yml` — despite `package.json`/
  `package-lock.json` matching that workflow's own `paths:` filter exactly (confirmed via
  `git show --stat` on the commit: both files genuinely changed).

`GET /repos/.../actions/workflows/ecr-push-production.yml/runs?branch=main` confirmed the
last successful deploy run was still pinned to an earlier, unrelated commit (`3f25a53c96`,
a same-session swing feature merge done via the GitHub MCP tool, a real user identity) — the
real dependency bumps landed on `main`, fully merged and CI-green at PR time, but were never
deployed. No red check, no error, no complaint anywhere — the merge itself looked completely
normal.

**Root cause.** GitHub's documented anti-recursion rule: a push event created by the default
`GITHUB_TOKEN` inside a workflow run does not trigger *any* other workflow (push-triggered CI,
CodeQL, `ecr-push-production.yml` — nothing). `dependabot-auto-merge.yml`'s merge step ran
`gh pr merge --auto --squash` with `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` — a GITHUB_TOKEN
identity, so every PR it merged was invisible to every downstream workflow.

**This is the identical bug `automerge.yml` was already fixed for on 2026-08-24** (see that
file's own extensive header comment and the existing ratchet test,
`src/automerge-token-recursion.test.ts`) — but the fix was never propagated to this sibling
workflow. `automerge.yml` only covers `claude/*` branches; `dependabot-auto-merge.yml` is a
**separate file** that merges every Dependabot PR (patch/minor bumps across all ecosystems,
plus all `github_actions` bumps) and still used the unfixed, plain `GITHUB_TOKEN` pattern. Two
files implementing the same "auto-merge agent/bot PRs" concept diverged, and only one got the
fix.

**Fix.** Same fix as `automerge.yml`: swap the merge step's token to
`${{ secrets.AGENT_RELEASE_TOKEN || secrets.GITHUB_TOKEN }}` — a real PAT identity whose push
events trigger downstream workflows normally, falling back to `GITHUB_TOKEN` if the secret is
unset (existing behavior preserved for that edge case — still silent on deploy there, but that
matches the sibling workflow's own documented fallback rather than hard-failing the whole
workflow over a missing optional secret).

**Evidence.** Extended the existing ratchet test file (`src/automerge-token-recursion.test.ts`)
with a new test, `"dependabot-auto-merge.yml's merge step does not rely solely on
GITHUB_TOKEN"`, mirroring the existing `automerge.yml` test exactly. RED→GREEN proven directly:
stashed the workflow fix and re-ran — 1 fail (the new test, against the real unfixed file
content); restored the fix and re-ran — 3/3 pass. `python3 -c "import yaml; yaml.safe_load(...)"`
confirms the edited workflow YAML still parses. `tsc --noEmit`: clean. Full `npm test`: see PR
for the run confirming 0 regressions repo-wide (a workflow-YAML-only change plus one new test
file addition, so no app-code blast radius to regress).

**Blast radius.** Single line changed in `.github/workflows/dependabot-auto-merge.yml` (the
merge step's `GH_TOKEN` env var). No application code touched. Going forward, every Dependabot
PR this workflow auto-merges will correctly re-trigger `verify`/CodeQL and (when the diff
matches `ecr-push-production.yml`'s path filter) a real production deploy, closing the gap
that let #5938 and #5939 land undeployed. No action needed on #5938/#5939 themselves — the
next deploy (for any reason) will carry their already-merged changes along; both are low-risk
dependency bumps that already passed `verify` at PR time.
