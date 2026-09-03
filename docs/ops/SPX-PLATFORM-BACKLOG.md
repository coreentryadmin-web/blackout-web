# SPX Platform Backlog — autonomous agent roadmap

**Mission:** Keep SPX Slayer + Largo improving without operator prompts. This file is the **single source of truth** for platform work the autonomous agent should pick up when prod is GREEN.

**Wake-up pipeline:**

```
Every 2h (GitHub Actions: spx-platform-backlog-agent.yml)
  → scripts/spx-collect-backlog-items.mjs   (this file's unchecked `- [ ]` items)
  → if items > 0 AND ops:collect is GREEN:
      scripts/ops-dispatch-agent.mjs        (GitHub issue + Cloud Agent)
  → Agent implements highest-priority unchecked item → PR → checks box → repeats
```

**Related automations (already live):**

| Workflow | Cadence | Role |
|----------|---------|------|
| `ops-auto-fix.yml` | 20 min | Prod errors/cron failures → agent fix loop |
| `cron-staleness-watchdog` | 20 min | Discord alert on stale crons |
| `spx-rth-all-day-agent.yml` | weekdays RTH | RTH verify (summary-only) + post-close fix |

**Agent rules:**

1. Pick the **highest priority unchecked** item (P0 → P1 → P2).
2. Implement with tests; do **not** open docs-only PRs unless the item is explicitly documentation.
3. After merge, mark the item `- [x]` in this file and move a one-line note to **Completed**.
4. Re-run `node scripts/spx-collect-backlog-items.mjs` — exit 0 means backlog clear for this cycle.
5. If prod has open ops items (`npm run ops:collect`), fix those **first** (P0 infra beats P2 polish).

---

## P0 — correctness / member trust

- [x] Verify `confidence` is omitted from all Largo SPX play responses when `assessed:false` (boundary: `SPX_CONFIDENCE_OMITTED` + `sanitizeSpxPlayPayloadForLargo`)
- [x] Server-side commentary feed parity — enrich `get_spx_voice_feed` with Pulse rail headline events not yet persisted (bias + play lifecycle via `observeSpxPlayVoiceTransitions`)

## P1 — desk UX / transparency

- [x] Gate transparency — collapsed Slayer verdict bar shows top 3 "why not trading?" blocks
- [x] Lane freshness strip — Pulse / Desk / Flow chips in `SpxSniperHeader` (~2s vs desk staleness visible)
- [x] `get_playbook_shadow_history` Largo tool — historical named-playbook shadow observations from Postgres
- [x] Discord alert history tool — outbound Discord posts queryable by Largo (read-only)
- [x] Playbook promotion analytics — surface `fetchPlaybookEvidenceRows` summary via Largo admin tool

## P2 — convergence / polish

- [x] Matrix lens UI state — expose active GEX/VEX lens to Largo via desk convergence payload
- [x] Focus mode / iOS panel state — document as client-only (no false claims in Largo)
- [x] Re-enable SPX RTH all-day agent schedule with **summary-only** agent output (no OPEN-ISSUES PR spam)

## P1 — Largo / convergence follow-ups (#3378+)

- [x] `get_ecosystem_context` SPX — attach `desk_convergence` (or `matrix_ui`) so cross-product reads see Vector/Slayer alignment without a second tool call
- [x] Largo truncation probe — `fitEcosystemContextForModel` at Largo boundary caps audit/anomalies/flow tape with explicit truncation flags (live probe re-run post-deploy)
- [x] `get_cross_product_read` — wire SPX Slayer (`get_spx_play`) as sixth product source (SPX/SPXW only; explained absence elsewhere)

## P2 — desk polish

- [x] Persist SPX matrix lens toggle to `sessionStorage` and document read path for future server-side hint (optional — today client-only is honest)
- [x] Largo fit `get_postgres_flows` + `get_spx_engine_snapshots` at model boundary (explicit truncation flags)
- [x] `get_spx_play` Largo fit — cap confluence factor detail lists under transport budget
- [x] `get_spx_confluence` — reuse play fitter at Largo boundary
- [x] Post-deploy truncation probe — `get_ecosystem_context`, `get_flow_tape`, `get_postgres_flows`, `get_spx_play` all COMPLETE on prod (2026-09-03)

## P2 — desk polish (next)

- [x] `get_spx_desk_convergence` — expose `lane_freshness` (Pulse/Desk/Flow) for Largo parity with header strip

## P2 — autonomous follow-ups

- [ ] Merge PR #3381 when CI green
- [x] `get_spx_structure` + `get_spx_confluence` — truncation probe COMPLETE on prod (2026-09-03)
- [x] `get_signal_log` Largo fit at model boundary
- [x] L-3 empty-answer honesty — wire `anthropicToolLoop` `onStop` → `emptyAnswerFallback` `stopReason` (both streaming + non-streaming paths)

---

## Completed (agent log)

| Date | Item | PR |
|------|------|-----|
| 2026-09-03 | L-3 empty-answer stopReason wiring (onStop → emptyAnswerFallback) | (this branch) |
| 2026-09-03 | P2 desk convergence lane_freshness for Largo | (this branch) |
| 2026-09-03 | P2 prod truncation probe — 4 SPX/HELIX tools COMPLETE | (probe log) |
| 2026-09-03 | P1 get_spx_play + confluence Largo fit | (this branch) |
| 2026-09-03 | P2 postgres_flows + spx_engine_snapshots Largo fit | (this branch) |
| 2026-09-03 | P1 get_flow_tape Largo fit (recent print cap + truncation flags) | (this branch) |
| 2026-09-03 | P1 ecosystem_context Largo fit + cross-product SPX Slayer source | (this branch) |
| 2026-09-03 | P2 SPX matrix lens sessionStorage persistence | (this branch) |
| 2026-09-03 | P1 ecosystem_context spx_desk_convergence field + CI tool count sync | (this branch) |
| 2026-09-03 | P2 re-enable SPX RTH all-day agent schedule (summary-only verify) | (this branch) |
| 2026-09-03 | P2 matrix lens + focus/iOS client-only UI facts in desk convergence | (this branch) |
| 2026-09-03 | P1 discord alert history + playbook promotion evidence Largo tools | (this branch) |
| 2026-09-03 | P0 confidence sanitize + voice feed play/bias parity | (this branch) |
| 2026-09-03 | Gate blockers collapsed strip + lane freshness + shadow history tool + backlog pipeline | #3381 |

---

## Finding new work

When this backlog is empty, the agent should:

1. Run `npm run ops:collect` — if non-zero, fix prod first.
2. Scan `docs/audit/FINDINGS.md` for open SPX/Largo `[ ]` items.
3. Run `npm run validate:spx-rth` during RTH — file FAILs as new P0/P1 items here.
4. Check merged PR #3378 follow-ups (Vector/Slayer convergence gaps).

**Do not stop after one PR.** Loop until wake-up finds zero unchecked items AND ops is GREEN.
