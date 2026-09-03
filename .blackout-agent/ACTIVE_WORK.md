# ACTIVE_WORK — prose detail on each `AGENT_STATE.json` entry

Same 5 items as `AGENT_STATE.json`, in prose, with the "so what do I actually do next" for each.
Re-verify phase/CI against GitHub directly — this file is a snapshot, not a live feed.

## BO-AUTOPILOT-0001 — Autopilot bootstrap (this work)
Owner: claude. Branch `fix/blackout-agent-autopilot`, PR #3435 (draft).
Durable-state system built, fresh-subagent recovery test run live (caught a real staleness bug in
`AGENT_STATE.json`, corrected), `docs/audit/AUTOPILOT-STATUS.md` readiness report written.
**Next action:** wait for `verify`/CodeQL on #3435, undraft + merge once green (manually via GitHub
MCP — `enable-automerge` is documented-broken), then watch for the next scheduled trigger fire to
close out the "successful scheduled invocation of this new state" NOT-YET-VERIFIED item.

## BO-P2-3425 — 0DTE G-18/G-19 gates (PR #3425, cursor's branch)
Owner: cursor, reviewer: claude. Originally, a new G-19 top-band hard block (score ≥85) collided
with pre-existing `breakout-source.test.ts`/`pin-source.test.ts` fixtures because BREAKOUT and PIN
scores live on independent, non-comparable scales and the gate was scoped globally. cursor's own
fix (`615d2c771`) scopes G-19 to FLOW-origin only via `input.discovery_origin` — the correct root
cause fix (this session had drafted an inferior workaround — tuning the test fixtures' inputs to
dodge the threshold — and discarded it in favor of cursor's fix once it landed).
**Next action:** re-check `verify`'s conclusion on the current head SHA; if green, review the diff
and merge (manually via GitHub MCP — `enable-automerge` is documented-broken in `CLAUDE.md`).

## BO-P3-3428 — helix-signal-outcomes docs correction (PR #3428)
Owner: claude. Draft, `verify` + CodeQL both green. Corrects a stale CLAUDE.md claim now that the
writer cron is confirmed deployed. **Next action:** undraft via GitHub MCP
`update_pull_request(draft:false)`, then merge manually.

## BO-P3-3429 — gamma canonical-source verification finding (PR #3429)
Owner: claude. Docs-only negative-result finding (see `docs/audit/findings-staging/
2026-09-03-gamma-canonical-source-copy-verified.md` for the full call-graph evidence). `verify` was
in-progress at last check. **Next action:** confirm green, merge.

## BO-P2-3430 — SPX E2E deploy-chunk-404 flake fix (PR #3430)
Owner: unknown-automation (PR author is the `coreentryadmin-web` account, not a named lane session
seen in this conversation), reviewer: claude. Not yet reviewed by this session. **Next action:**
read the diff, confirm it's treating deploy-chunk 404s as transient for a legitimate reason (ECS
rolling deploy serving stale chunk manifests, the same class of issue
`meridian-earnings-ui-audit.mjs` already documents for `ERR_CONNECTION_RESET`), not silently
swallowing a real flake.
