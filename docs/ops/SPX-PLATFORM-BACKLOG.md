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
| `spx-rth-all-day-agent.yml` | manual | RTH verify / post-close fix (schedule disabled — docs spam) |

**Agent rules:**

1. Pick the **highest priority unchecked** item (P0 → P1 → P2).
2. Implement with tests; do **not** open docs-only PRs unless the item is explicitly documentation.
3. After merge, mark the item `- [x]` in this file and move a one-line note to **Completed**.
4. Re-run `node scripts/spx-collect-backlog-items.mjs` — exit 0 means backlog clear for this cycle.
5. If prod has open ops items (`npm run ops:collect`), fix those **first** (P0 infra beats P2 polish).

---

## P0 — correctness / member trust

- [ ] Verify `confidence` is omitted from all Largo SPX play responses when `assessed:false` (boundary: `SPX_CONFIDENCE_OMITTED`)
- [ ] Server-side commentary feed parity — enrich `get_spx_voice_feed` with Pulse rail headline events not yet persisted

## P1 — desk UX / transparency

- [x] Gate transparency — collapsed Slayer verdict bar shows top 3 "why not trading?" blocks
- [x] Lane freshness strip — Pulse / Desk / Flow chips in `SpxSniperHeader` (~2s vs desk staleness visible)
- [x] `get_playbook_shadow_history` Largo tool — historical named-playbook shadow observations from Postgres
- [ ] Discord alert history tool — outbound Discord posts queryable by Largo (read-only)
- [ ] Playbook promotion analytics — surface `fetchPlaybookEvidenceRows` summary via Largo admin tool

## P2 — convergence / polish

- [ ] Matrix lens UI state — expose active GEX/VEX lens to Largo via desk convergence payload
- [ ] Focus mode / iOS panel state — document as client-only (no false claims in Largo)
- [ ] Re-enable SPX RTH all-day agent schedule with **summary-only** agent output (no OPEN-ISSUES PR spam)

---

## Completed (agent log)

| Date | Item | PR |
|------|------|-----|
| 2026-09-03 | Gate blockers collapsed strip + lane freshness + shadow history tool + backlog pipeline | (this branch) |

---

## Finding new work

When this backlog is empty, the agent should:

1. Run `npm run ops:collect` — if non-zero, fix prod first.
2. Scan `docs/audit/FINDINGS.md` for open SPX/Largo `[ ]` items.
3. Run `npm run validate:spx-rth` during RTH — file FAILs as new P0/P1 items here.
4. Check merged PR #3378 follow-ups (Vector/Slayer convergence gaps).

**Do not stop after one PR.** Loop until wake-up finds zero unchecked items AND ops is GREEN.
