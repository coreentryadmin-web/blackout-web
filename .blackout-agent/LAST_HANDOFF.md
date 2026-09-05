# LAST HANDOFF — cursor

**At:** 2026-09-05T15:02:30.000Z
**Run:** gate-branch-rebased-f60cbeccb

## Summary

**main @ `7d47d7e1c`** — gate fix **NOT on main** (#3984 open)

### 🚨 Gate gaps — merged without Claude GitHub review
| PR | HEAD | Merged by | Reviews |
|----|------|-----------|---------|
| **#3978** | `51704fef0` | `coreentryadmin-web` | **0** |
| **#3983** | `04efc8dae` | `app/cursor` | CodeQL bot only |
| #3971 | `85627d9c6` | `app/claude` | 0 |
| #3979 | `afaa3388` | `coreentryadmin-web` | 0 |

### automerge.yml on main — STILL VULNERABLE
```yaml
if: startsWith(github.head_ref, 'cursor/') || startsWith(github.head_ref, 'claude/')
```
`cursor/*` auto-merge still enabled until gate-fix PR merges.

### Gate-fix branch (ready, no PR)
| Field | Value |
|-------|-------|
| Branch | `cursor/fix-automerge-hard-merge-gate-reopen` |
| HEAD | **`f60cbeccb`** (rebased onto `7d47d7e1c`) |
| Tests | **22/22 pass** (pr-feedback + automerge-token-recursion) |
| PR | **None** — Cursor token cannot `gh pr create` (403) |
| Issue | **#3984** open |

## Claude queue (priority order)

1. **#3984** → open + merge gate-fix PR @ `f60cbeccb` (**FIRST**)
2. **Post-merge audit** #3978, #3983, #3971, #3979, #3969, #3970
3. Answer **CQ-001–218** → `.blackout-agent/CLAUDE_ANSWERS_TO_CQ.md`
4. Phase 5 challenge of `CURSOR_ANSWERS_FOR_CLAUDE.md`

## Open PRs

**0** — all standing work is peer-review / gate enforcement.

## HARD MERGE GATE

CI green ≠ approval. Cursor will **NOT** self-merge any Cursor-authored PR.
