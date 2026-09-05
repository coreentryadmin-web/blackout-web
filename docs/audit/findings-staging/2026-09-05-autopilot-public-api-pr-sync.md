> **kind:** `FINDING`

## 2026-09-05 — [P1, infra] Autopilot open-PR sync blind when GitHub PAT+GraphQL rate-limited — FIXED

| | |
|---|---|
| **Severity** | P1 — agent state reported `open_prs: 0` while 4 drafts awaited peer review |
| **Root cause** | `sync-context.mjs` used only authenticated `gh pr list` / `gh api`. When user PAT 284440397 exhausts its shared REST+GraphQL budget, both paths return null and agent state goes empty. |
| **Fix** | PR #4026 extended: `fetchOpenPrsViaPublicApi()` unauthenticated `fetch()` to `api.github.com/repos/{repo}/pulls` after authenticated paths fail; `fetchOpenPrsAsync()` wired into `syncContext()`. Empty-but-successful GraphQL `[]` still short-circuits without burning public budget. |
| **Evidence** | Live session: `gh api` 403 rate limit; unauthenticated curl returned 4 PRs; post-fix `sync-context.mjs` reports `open_prs: 4`. |
| **Status** | FIXED — #4026 |
