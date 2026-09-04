## 2026-09-04 — [FINDING, P2 tooling/correctness, 0DTE audit toolkit] `g18-g19-counterfactual.mjs` session replay always reported `replay parse failed` when plays existed — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **What prompted this** | Autopilot worker resumed BO-P1-0004 validation off-hours; `npm run counterfactual:0dte-g18-g19` printed `replay skipped/failed: replay parse failed` even though `npm run replay:0dte-session --days=5 --json` succeeded standalone (6/6 plays replayed). |
| **Root cause** | `runReplay()` spawned `npm run replay:0dte-session` and parsed stdout with `lastIndexOf("{")`. npm prefixes banner lines, and the replay JSON contains nested `{` inside each play row — `lastIndexOf` grabbed an inner object, so `JSON.parse` failed with trailing garbage (`Unexpected non-whitespace character after JSON`). |
| **Fix** | Invoke `zerodte-session-replay.mjs` directly via `node --import tsx` (no npm banner). Added `parseReplayStdout()` that locates the root `{\n  "ok"` marker and brace-balances to the matching closing `}` before parsing. |
| **Regression guard** | `scripts/audit/g18-g19-counterfactual.test.mjs` — fixture with npm banner + nested play objects; asserts `replayed: 2`. |
| **Status** | FIXED |
