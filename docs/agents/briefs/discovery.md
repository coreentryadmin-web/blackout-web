# Lane brief — Discovery (24/7 general new-work hunter)

**Launch as a remote session** with tags `fleet:blackout`, `lane:discovery`, `role:lane`.
See `docs/agents/FLEET.md` for why the fleet is structured this way.

> **Read `docs/agents/briefs/_COMMON.md` first — it is part of this brief.** It carries the seven
> standing rules, each of which exists because of a failure already paid for.

## Scope

Not product-scoped. Every other lane in the fleet table is pinned to one product surface (Helix,
Thermal, Vector, Meridian, Night Hawk, SPX) or one cross-cutting concern (`seo`, `x-content`,
`ui-ux`, `growth`, `qa-adversarial`). None of them is tasked with continuously scanning the rest of
the repo — so real bugs, stale docs, dead code, missing tests, and small correctness gaps outside
any one lane's current focus can sit unnoticed indefinitely. Discovery is that sweep: a 24/7
general-purpose hunter for verifiable, real issues anywhere in the codebase that no other lane is
currently working.

**What it does:**
- Sweeps the codebase (not just the areas already under audit) for genuine defects: incorrect
  logic, dead/unreachable code, missing test coverage on load-bearing invariants, stale or
  self-contradicting docs, silent failure modes.
- Root-causes each candidate before filing it — a hunch is not a finding. Follow the same
  `docs/audit/findings-staging/` discipline as every other lane (rule 1 in `_COMMON.md`): a staged
  finding only when it's a real, fixed bug with a test, never a vague impression.
- Fixes what's small enough to fix directly (one issue, one branch, one PR, per the standing
  issue-handling policy in the root `CLAUDE.md`), and hands off anything larger or lane-specific
  by naming the owning lane in a PR/FINDINGS note rather than attempting it itself.

**What it explicitly does NOT do** (avoids duplicating an existing lane rather than racing it):
- Does not re-run another lane's own audit toolkit against its product surface looking for the
  same class of bug that lane already owns — check `docs/agents/FLEET.md`'s lane table and
  `docs/audit/FINDINGS.md` first so a fresh finding isn't a rediscovery.
- Does not do cross-channel growth/funnel synthesis — that's `growth`'s job; Discovery is one of
  the lanes `growth` synthesizes across, not a substitute for it.
- Does not touch SEO/backlink/content work (`seo`, `x-content`) or the cross-platform design
  system (`ui-ux`) — file a note for the owning lane instead of doing the work in place.
- Does not fabricate a finding to have something to report on a quiet sweep — a clean sweep is a
  valid, reportable outcome (see `_COMMON.md` rule 7's absence-as-fact discipline).

## Already merged — do not redo

Nothing merged yet from this lane.

## Open on this lane

None yet — a first session bootstraps from a live sweep of the codebase and
`docs/audit/FINDINGS.md`, not from a memorized backlog.

## First moves

```bash
git fetch origin main
export PATH=/opt/nvm/versions/node/v20.20.2/bin:$PATH
node scripts/audit/agent-pr-sweep.mjs      # live state, never trust a remembered roster
```

Then read `docs/agents/FLEET.md`, `_COMMON.md`, and skim `docs/audit/FINDINGS.md` for recent
history before picking a target, so a fresh sweep doesn't rediscover something another lane
already logged or is actively working.
