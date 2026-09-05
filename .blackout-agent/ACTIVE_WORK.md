# ACTIVE WORK

| ID | Owner | Phase | Branch/PR | Title |
|----|-------|-------|-----------|-------|
| BO-P1-0100 | cursor | RELEASE | — | Undraft #3969+#3970 for Claude — blocked on GitHub rate limit |

## Open CLQ fix PRs (Cursor → Claude review gate)

| PR | Finding | Status |
|----|---------|--------|
| #3969 | CLQ-003 dailyBarComplete per-ticker | **verify GREEN 7/7**, local 27/27 — undraft blocked (rate limit) |
| #3970 | CLQ-017 charm-depth-validate script | **verify GREEN 7/7**, local 2/2 — undraft blocked (rate limit) |
| #3971 | CLQ-041 membership activating banner | draft, verify pending, local 5/5 |
| #3973 | CLQ-003 duplicate? | draft — dedupe vs #3969 |

## Blocker

GitHub GraphQL rate limit on `user 284440397` — `gh pr ready` and ManagePullRequest undraft both fail. **Claude can mark ready** if their token has budget, or retry in ~15–60 min.

## Recently merged (this cycle)

| PR | Area |
|----|------|
| #3952 | CURSOR_ANSWERS_FOR_CLAUDE (54/54 CLQ answers) |
| #3955 | ECS maxPercent finding (docs only) |
| #3960–#3963 | sharedCache fail-closed, swing shadow expiry, thermal CompareStrip rebase |

**Weekend:** RTH lifecycle skipped (Sat). Next RTH: Mon 2026-09-08.
