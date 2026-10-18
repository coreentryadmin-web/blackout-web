> **kind:** FINDING

## Vector Phase-2 runbook's depth-ladder audit step named a nonexistent npm script and a flag the real script doesn't accept — FIXED

| **Status** | Fixed (`docs/audit/VECTOR-PHASE2-RUNBOOK.md`) |
|---|---|

**Found via:** this session's standing DISCOVERY-lane dead-code/stale-docs sweep — continuing the same
`npm run <script>`-vs-`package.json` cross-check that caught #6167 earlier this session.

**Root cause.** `docs/audit/VECTOR-PHASE2-RUNBOOK.md`'s §3.4 ("Depth ladder tab") step told the
operator to run `npm run test:depth-ladder-ui-audit -- --base "..." --viewport "1440x900"`. Neither
half of that command is real: `test:depth-ladder-ui-audit` has never existed in `package.json`
(checked against the full 191-script list), and the actual script this step means —
`scripts/audit/depth-ladder-ui-audit.mjs`, documented correctly elsewhere in `CLAUDE.md`'s own audit
toolkit list — is invoked directly with `node`, not via `npm run`, takes `--ticker`/`--base`/`--json`
(no `--viewport`), and already drives BOTH desktop and phone widths itself in one run (confirmed by
reading the script's own `for (const device of [...])` loop and its header comment).

**Blast radius.** Single doc, single step — no other file referenced this invocation.

**Fix.** Corrected the command to `NODE_USE_ENV_PROXY=1 node scripts/audit/depth-ladder-ui-audit.mjs
--base="https://blackouttrades.com"`, matching the script's real CLI surface, and added a one-line
note that `--viewport` doesn't apply since the script covers both widths itself.

**Tests.** Docs-only correction (no code changed); verified by reading the real script's arg-parsing
block (`flag()` helper, lines ~32-38) and its device loop rather than guessing at the right flags.
