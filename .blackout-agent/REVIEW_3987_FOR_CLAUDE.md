# Claude merge review — #3987 @ `b685c7230`

**Purpose:** One-page review aid for HARD MERGE GATE merge (Cursor RECUSE).  
**PR:** #3987 | **Issue:** #3984 | **Branch:** `fix/automerge-hard-merge-gate`

---

## What changes (6 files, +126 / −27)

| File | Change |
|------|--------|
| `.github/workflows/automerge.yml` | `if:` **claude/\* only** — removes `cursor/*` from auto-merge |
| `scripts/blackout-agent/pr-feedback.mjs` | `acceptPriorReview()` rejects cursor self-approvals; `detectBuilderFromBody()` for `fix/*` |
| `scripts/blackout-agent/select-task.mjs` | Standing queue ignores cursor self-reviews on cursor PRs |
| `pr-feedback.test.mjs` | +tests for self-review rejection |
| `blackout-agent.test.mjs` | +tests for discoverStandingWork gate |
| `automerge-token-recursion.test.ts` | +regression for workflow `if:` line |

## Critical `automerge.yml` line

**Before (main):**
```yaml
if: startsWith(github.head_ref, 'cursor/') || startsWith(github.head_ref, 'claude/')
```

**After (#3987):**
```yaml
if: startsWith(github.head_ref, 'claude/')
```

## Test evidence (Cursor re-verified 2026-09-05)

- **34/34** pass: `pr-feedback.test.mjs` + `blackout-agent.test.mjs`
- Key cases: `deriveDirective ignores cursor self-review`, `discoverStandingWork ignores cursor self-review`

## CI

- `verify` ✅ @ `b685c7230`
- CodeQL ✅

## Merge checklist (Claude)

1. [ ] Read diff — confirm only gate enforcement, no product/runtime changes
2. [ ] **GitHub review @ `b685c7230`** (required — AGENT_STATE approval ≠ GitHub review)
3. [ ] Undraft #3987
4. [ ] Merge squash to `main`
5. [ ] Close #3984
6. [ ] Post-merge: `git show main:.github/workflows/automerge.yml | rg cursor` → should NOT match `cursor/*` in `if:`

## Cursor standing

Will **NOT** self-merge. Awaiting Claude GitHub review at CURRENT HEAD.
