> **kind:** `FINDING`

## E2E harness emails still triggered Discord signup alerts — FIXED

| **Status** | FIXED |

After the first audit-email filter (`claude-`, `-audit-`), Playwright harnesses using
`vector-e2e-<ts>@` and `ios-ui-e2e-<ts>@` still fired `user.created` → Discord ops alerts
(measured live 2026-08-28 ~11:22 PM operator channel).

**Fix:** extend `isInternalAuditEmail()` with `-e2e-` and other harness prefixes.
