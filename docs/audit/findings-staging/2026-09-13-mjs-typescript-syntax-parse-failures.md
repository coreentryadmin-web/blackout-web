## 2026-09-13 — [FINDING, P2 tooling] Three `scripts/**/*.mjs` files carry TypeScript-only syntax and have been completely unrunnable since they were added — one broke the `main`-branch CodeQL workflow — FIXED (+ class-of-bug regression guard)

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED — merged same PR. |
| **Severity** | P2 — no live member-facing impact (these are one-off audit/ops scripts, not routes the product serves), but a real tooling defect: `npm run calibration:thesis-rank` and `npm run playbook:evidence-report` have been **completely unrunnable** since the day each script was added, and `scripts/thermal-discord-preview-v2.mjs` the same. A CodeQL scan of `main` failed outright on 2026-09-13 09:48 UTC because of this — the first externally-visible symptom, 19 days after the oldest of the three was introduced. |

### What was found

DISCOVERY-cycle sweep of recent GitHub Actions failures found a `CodeQL` run failing on `main` (not a PR — a direct `push` trigger) at commit `60ac2ea40` (a pure `chore(journal)` commit, no code change — ruling out "this commit broke something"). The job log named the real cause:

```
Could not process some files due to syntax errors (1 result)
  * scripts/audit/thesis-rank-calibration.mjs#L42C97:97: A parse error occurred: `Unexpected token`.
...
CodeQL job status was failure.
```

### Root cause

`scripts/audit/thesis-rank-calibration.mjs` (added 2026-08-25, PR #2903) is a `.mjs` file (plain ES module) but was written with TypeScript-only syntax: parameter/return type annotations (`function isGradedWin(row: Record<string, unknown>): boolean`), a generic type argument (`new Map<string, { n: number; wins: number }>()`), and a type assertion (`{} as Record<string, unknown>`). None of that is valid in a plain `.mjs` file.

Its own `package.json` script — `"calibration:thesis-rank": "node scripts/audit/thesis-rank-calibration.mjs"` — invokes it with bare `node`, which cannot parse any of it: the very first typed function throws `SyntaxError: Unexpected token ':'` immediately. **Critically, `node --import tsx` does NOT help either** — confirmed by running it that way live: tsx's transform hook applies by FILE EXTENSION (`.ts`/`.tsx`), not by content, so a `.mjs` file gets zero TypeScript transformation regardless of what syntax is inside it. There is no invocation of this script, by any method, that would have worked as originally written.

Same defect, two more files, found once the regression test below scanned every tracked `scripts/**/*.mjs` file rather than just the one CodeQL happened to flag:
- **`scripts/playbook-evidence-report.mjs`** — `function requireDbInCi(): boolean {` (return-type annotation). Its own `package.json` script (`"playbook:evidence-report": "node --import tsx scripts/playbook-evidence-report.mjs"`) already uses `--import tsx` (presumably because the file also imports `.ts` modules directly, which plain `node` cannot resolve at all) — but per the tsx-extension-matching fact above, that flag does nothing for TS syntax living inside the `.mjs` file's own body.
- **`scripts/thermal-discord-preview-v2.mjs`** — a type-only named import (`type ThermalCardColumn,`) and a return-type annotation (`function buildPreviewSnapshotColumns(): ThermalCardColumn[] {`). No `package.json` entry; its own usage comment says plain `node scripts/thermal-discord-preview-v2.mjs`.

None of the three has ever had a passing CI check that would have caught this — `tsc --noEmit` only type-checks the `src/` TS project, and nothing in `npm test` executes or syntax-checks `.mjs` scripts under `scripts/`.

### Fix

Stripped the TypeScript-only syntax from all three files, preserving runtime behavior exactly (parameter/return types and the generic type argument carry no runtime meaning in JS — removing them changes nothing about what the code does):
- `thesis-rank-calibration.mjs`: removed 2 parameter type annotations, 1 return type annotation, 1 generic type argument on `new Map(...)`, 1 type assertion.
- `playbook-evidence-report.mjs`: removed 1 return type annotation.
- `thermal-discord-preview-v2.mjs`: removed 1 type-only import, 1 return type annotation.

### Regression guard

New test in `src/repo-hygiene.test.ts`: `"every tracked scripts/**/*.mjs file parses as valid plain JavaScript (no leaked TS syntax)"` — runs `node --check <file>` (parses, does not execute or resolve imports) against every tracked `scripts/**/*.mjs` file and asserts zero syntax errors. This is a class-of-bug guard, not a single-file regression test: it is what actually found the second and third instances of this defect during this fix, beyond the one file CodeQL happened to flag.

### Evidence

RED→GREEN: reverted `thesis-rank-calibration.mjs` to its pre-fix `HEAD` version and ran the new test — 1/7 fails, reporting exactly the 3 broken files (including the 2 the original CodeQL failure never surfaced). Restored all three fixes, re-ran — 7/7 pass. Functional smoke test post-fix: `thesis-rank-calibration.mjs` now runs end-to-end against the live prod API and returns a well-formed report; `playbook-evidence-report.mjs` (via `node --import tsx`) now fails only at the expected sandbox boundary (`ENOTFOUND postgres.railway.internal` — direct Postgres TCP is blocked from this sandbox per this repo's own documented environment realities, not a code defect); `thermal-discord-preview-v2.mjs` now fails only on the expected missing-env-var guard (`DISCORD_THERMAL_WEBHOOK_URL unset`) instead of a syntax error. `npx tsc --noEmit -p .`: clean. Full `npm test`: run in progress at time of writing, full suite pass will be confirmed before merge per standing policy.

### Blast radius

Three files, all scripts (not application code under `src/`), all fixed the same way. No other `scripts/**/*.mjs` file fails the new check — confirmed by the regression test itself covering the whole tree, not just these three paths.

### Why fixed directly, not written up

Small, mechanical, self-contained syntax fix (strip type-only tokens, verify behavior is byte-identical at runtime) in files untouched by any of the 9 owning lanes' recent activity, with a new tree-wide regression test proving both the RED state and the GREEN fix. Exactly the shape the standing issue-handling policy calls "fix directly."
