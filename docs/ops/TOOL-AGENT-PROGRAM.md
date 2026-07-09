# Tool Agent Program — one agent per premium surface

BlackOut runs **seven dedicated RTH agents**, each owning end-to-end correctness, play quality, matrix math, latency, and CTO-grade reporting for **one tool**.

## Agents

| Tool key | Surface | Command | Cadence |
| --- | --- | --- | --- |
| `spx-slayer` | SPX Slayer `/dashboard` | `npm run validate:tool-agent:spx-slayer` | ~90s |
| `thermal` | BlackOut Thermal `/heatmap` | `npm run validate:tool-agent:thermal` | ~2m |
| `helix` | HELIX `/flows` | `npm run validate:tool-agent:helix` | ~60s |
| `largo` | Largo `/terminal` | `npm run validate:tool-agent:largo` | ~3m |
| `nighthawk` | Night Hawk `/nighthawk` | `npm run validate:tool-agent:nighthawk` | ~2m |
| `zerodte` | 0DTE Command | `npm run validate:tool-agent:zerodte` | ~2m |
| `vector` | Vector `/vector` | `npm run validate:tool-agent:vector` | ~60s |

## Each agent answers (CTO checklist)

1. **Is the data showing correct?** — API probes, cross-endpoint spot/flip, `data-correctness` flags for that layer
2. **Are plays genuinely good?** — live play API grade/score/gates; no ENTER on low score; no stale SCANNING confirmations
3. **Failed plays — why/how?** — Postgres `spx_play_outcomes`, `nighthawk_play_outcomes`, `zerodte_setup_log` with per-failure detail
4. **Every number 100% correct** — finite scans, premium fields, cross-tool agreement
5. **Every matrix cell correct** — `heatmap-matrix-audit` on tool tickers (SPX Slayer + Thermal + Vector walls)
6. **Flow data correct** — HELIX row shape, premium dollars, non-empty tape during RTH

## Artifacts (per tool)

```
audit-output/tool-agents/{tool}/
  status.json          # live heartbeat (tick, findings count, latency)
  findings.ndjson      # every defect line-by-line
  cto-report-YYYY-MM-DD.md   # executive + fix loop
```

## Launch at 09:30 ET (fully autonomous)

**Single orchestrator:** `.github/workflows/rth-autonomous-open.yml` (weekdays 09:30 ET)

| Step | What runs | Until |
| --- | --- | --- |
| 1. Open gate | `validate:rth-open` | ~10 min |
| 2. Launch fixers | 7 tool Cloud Agents + 1 site-wide Cloud Agent | instant |
| 3. Site monitor | `validate:rth-continuous` | 16:00 ET |
| 4. Tool monitors | 7 parallel `validate:tool-agent:*` jobs | 16:00 ET |
| 5. Auto-fix | `ops-auto-fix` every **20 min** merges cron errors + tool findings → dispatches fix agent |

**No user prompts.** Cloud Agents: fix → PR → auto-merge → re-validate → **continue monitoring**.

Monitors **do not stop** on P1 — they log to `findings.ndjson` and keep running. Fix agents work in parallel.

### Fix loop (each Cloud Agent)

```
find P1 → branch → commit → push → PR → gh pr merge --auto --squash
→ deploy poll → validate:tool-agent:{tool} --once GREEN → resume continuous loop
```

Standing merge policy: `CLAUDE.md` § Merge authorization.

## Fix loop (autonomous)

1. Agent finds P1 → append `findings.ndjson` + `cto-report-*.md`
2. Branch `fix/{tool}-{slug}` → patch → tool e2e
3. PR → auto-merge → re-run `validate:tool-agent:{tool}` until GREEN
4. Session summary → `docs/api-audit/OPEN-ISSUES.md`

## Runbooks

- [SPX Slayer](./tool-agents/spx-slayer.md)
- [Thermal](./tool-agents/thermal.md)
- [HELIX](./tool-agents/helix.md)
- [Largo](./tool-agents/largo.md)
- [Night Hawk](./tool-agents/nighthawk.md)
- [0DTE Command](./tool-agents/zerodte.md)
- [Vector](./tool-agents/vector.md)

## Related

- Site-wide supervisor: `npm run validate:rth-continuous` — `docs/ops/RTH-CONTINUOUS-MONITOR.md`
- RTH open gate: `npm run validate:rth-open`
