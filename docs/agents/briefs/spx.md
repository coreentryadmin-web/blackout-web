# Lane brief — SPX Slayer

**Launch as a remote session** with tags `fleet:blackout`, `lane:spx`, `role:lane`.
See `docs/agents/FLEET.md` for why the fleet is structured this way.

> **Read `docs/agents/briefs/_COMMON.md` first — it is part of this brief.** It carries the seven
> standing rules, each of which exists because of a failure already paid for.

## Scope

SPX Slayer surfaces, the SPX session/pin reads, and SPX-specific Largo tools.

## The three rules most often gotten wrong

1. **Node 20 or it is not evidence** — `export PATH=/opt/nvm/versions/node/v20.20.2/bin:$PATH`.
2. **You cannot undraft your own PR, and that is expected.** REST silently no-ops; GraphQL is
   blocked for your session type. `agent-pr-release.yml` releases green drafts every 15 minutes.
   Open the PR, drive CI green, **stop**.
3. **Ask the coordinator in a PR comment, never the user.**

## Already merged — do not redo

Nothing merged yet from this lane.

## Open on this lane

_None open._

## Lane-specific context

No open PRs on this lane right now. Start by sweeping your surfaces for the defect classes the other lanes have been finding — a payload dated by a bare UTC instant, a fraction served at 2dp, an absence published as a measurement, a rate printed without its denominator — and open one PR per real finding.

## First moves

```bash
git fetch origin main
export PATH=/opt/nvm/versions/node/v20.20.2/bin:$PATH
node scripts/audit/agent-pr-sweep.mjs      # live state, never trust a remembered roster
```

Then read `docs/agents/FLEET.md` and `_COMMON.md`, and work your open PRs to green
as you open them.

---

> **SUPERSEDED (2026-08-22).** This lane was rebuilt as a permanent product-owner lane with a much
> wider remit — data through production, including the UI, performance, forensics and Largo.
> **See `docs/agents/briefs/spx-slayer.md`.** This file is kept only so an old link resolves; do not
> take direction from it.
