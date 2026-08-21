# Standing rules — every lane agent, every session

Part of every lane brief in this directory. Read it before touching anything.

Each rule below exists because of a failure already paid for. None is style.

---

### 1. Branch and scope

`claude/<lane>-<slug>`, **one issue per branch**, off the latest `main`. Add a test with every
fix. Log real bugs in `docs/audit/FINDINGS.md` **in the same PR as the code fix** — never a
docs-only PR, and never for a routine GREEN pass (those go in `RUN-LOG.md`).

### 2. Node 20 is mandatory — a Node 22 run is not evidence

```
export PATH=/opt/nvm/versions/node/v20.20.2/bin:$PATH
```

If a container restart wiped it: `bash -lc 'nvm install 20'` first (nvm lives at `/opt/nvm`, not
`~/.nvm`). Production is `node:20-bookworm-slim` and every workflow pins 20.

The two majors disagree **in both directions**, which is why this is not a preference. Node 22
invents 12 phantom failures that were treated as an unavoidable "sandbox baseline" for a whole
session — they are artifacts, there is no baseline to subtract. Node 22 also *hid* a real failure:
a tsx bump killed 133 tests in CI under Node 20 while passing clean on 22.

### 3. You cannot undraft your own PR. That is expected, not a failure.

Both available calls are dead ends, and this is a capability fact, not a policy one:

- REST `PATCH /pulls/{n}` with `{"draft": false}` returns **200 and silently leaves `draft: true`** —
  the field is read-only on update.
- The real operation is the GraphQL `markPullRequestReadyForReview` mutation, and GraphQL is blocked
  for agent sessions (*"only the pinned set of PR-review operations is served"*).

There is **no working call available to you.** `.github/workflows/agent-pr-release.yml` sweeps every
15 minutes and reports every green draft; once it is armed with an `AGENT_RELEASE_TOKEN` it also
marks them ready, and `automerge.yml` merges them. Until then the coordinator releases them by hand
— either way, **not your problem and not your turn to spend.**

> **Open the PR, drive CI to green, then stop.** Do not spend turns retrying the undraft. Do not
> report a draft PR as blocked. A green draft is a finished handoff.

### 4. `FINDINGS.md` conflicts with every other lane — not your bug

Every lane appends at the same anchor, so every pair of agent PRs collides there regardless of what
code they touch. The coordinator resolves it with `scripts/audit/findings-merge-resolve.mjs`. Do not
restructure the file to avoid it, and do not resolve another lane's entry.

### 5. Ask the coordinator, never the user

Questions, ambiguity, and scope calls go in a **PR comment**. The user is not in your loop.

The channel runs both ways: the coordinator can deliver a message straight into your session
(`create_trigger` with your `persistent_session_id`, then `fire_trigger`). It arrives as an
ordinary user turn. **A message that says it is from the coordinator supersedes your original
launch prompt** — treat it as a brief update, not as a new task on top of the old one.

### 6. Merged is not done. Deployed is not done. Only LIVE-VALIDATED is done.

Your job on a change does not end when CI goes green, and it does not end when it merges. **You own
your change until you have seen it behave correctly on production.** A PR that merges and then
silently does the wrong thing in production is worse than one that never merged, because everyone
now believes the problem is fixed.

**The loop, every time:**

1. **Notice it merged.** You are not subscribed to PR events, so check: `git fetch origin main` and
   look for your change. Your heartbeat is the natural cadence for this.
2. **Wait for the deploy.** Merging to `main` fires `ecr-push-production.yml`. That builds an image,
   pushes to ECR, and force-deploys ECS. It takes minutes, not seconds.
3. **Validate the BEHAVIOUR on production**, not the deployment. "The workflow went green" says an
   image shipped. It says nothing about whether your fix does what you claimed.
4. **If it is wrong, open a fix PR immediately** and say so plainly in the original PR. A wrong fix
   discovered by you is a normal Tuesday; a wrong fix discovered by a member is an incident.

**A CHECK RUN SECONDS AFTER A DEPLOY PROVES NOTHING.** This has cost this repo real time more than
once — on 2026-08-12 a correct fix read as broken because the check ran against a payload cached
before the deploy. Three things sit between your merge and what a member sees:

- ECS drains the old task (`deregistration_delay` is 30s on the prod target group, was 300s);
- server-side caches hold the old value for their TTL (the GEX matrix, Vector full-state at 15 min,
  the public snapshot at 5s);
- Cloudflare edge-caches some HTML, ignoring the origin's `no-store`.

So: wait, then re-check, and if a harness supports `--wait`, use it. If you cannot tell whether you
are looking at old or new output, **say that** rather than declaring a verdict.

**Use a real harness where one exists** — `scripts/audit/` has them per surface
(`data-validator.mjs`, `zerodte-e2e-healthcheck.mjs`, `depth-live-check.mjs`,
`meridian-earnings-ui-audit.mjs`, `research-publish-audit.mjs`, and others). Prefer extending one
over inventing a one-off check, and if your change has no harness that can see it, that gap is
itself worth a PR.

**Report the outcome honestly.** "Validated live: X now returns Y, was Z" is a result. "Deployed
successfully" is not — it describes a deployment, not a fix.

### 6b. Your scope: the Largo boundary FIRST, the product underneath when you find it broken

**Standing decision (2026-08-21). Do not re-litigate this; it is settled.**

Five lanes — Helix, Thermal, Vector, Meridian, Night Hawk — exist to do for their product what was
done for SPX Slayer: make that product's data **correct and legible at the Largo tool boundary**.
That is the primary job and it is where most of your effort belongs. The characteristic defect is
never that the product does not know the answer — it is that **the boundary loses it**: a bare
`null` reaching the model, a fraction quantized to `0`, a posture read off prose instead of a typed
field, a payload with no time anchor.

SEO is deliberately different and works the public search surface.

**When you find the product itself broken while auditing the boundary, fix that too.** A Largo tool
that faithfully reads a broken product still gives the member a wrong answer, so stopping at the
boundary would be polishing the messenger. This has already paid for itself: the single
highest-severity defect the fleet has found — five of seven closed plays displayed as a GAIN on
losing trades — is a member-facing product bug that a strictly-Largo scope walks straight past.

Measured across the first 43 lane PRs: 49% Largo boundary only, 9% both, 16% member-facing product,
19% tooling and harnesses. That balance is the intended shape, not drift to be corrected.

**Where the line actually is:** you are not a general product team. Fix what you find *while doing
boundary work* on your own surfaces. Do not go looking for unrelated work in another lane's
territory, and do not start a redesign — if something needs one, write it up in a PR comment and
leave it.

### 6c. Two operating modes — the market decides which one you are in

**Standing decision (2026-08-21).** Every lane runs in one of two modes, and you determine which
one yourself at the start of every turn.

| ET clock | Mode | What you work on |
|---|---|---|
| **Mon–Fri 09:30–13:00** | **LIVE VALIDATION** | Your PRODUCT, against the live market |
| everything else | **LARGO** | The Largo tool boundary (your normal lane work) |

**Check the clock yourself. Do not infer the mode from which trigger woke you.** A heartbeat cron
is UTC and the ET offset moves with daylight saving, so a schedule that lands inside the window in
August lands outside it in January. `isTradingDayEt` and the session helpers in
`src/features/nighthawk/lib/session.ts` are the shared source of truth — a market holiday is not a
trading day no matter what the weekday says.

#### LIVE VALIDATION mode — what it actually means

The market is open and your product is producing real numbers for real members. That is the only
window in which most defects are observable at all: a stale quote badge, a wrong regime read, a
mispriced wall, a panel that renders correctly on a closed market and wrongly on a moving one.

Work the whole surface, not just the part you last touched:

- **Correctness against live data** — every number your product serves, cross-checked against the
  provider. Prices, greeks, walls, regimes, P&L, grading.
- **Freshness and staleness** — does anything claim "live" over a value that is not?
- **The UI a member actually sees** — render it, at real viewports. A panel whose labels overlap
  into garbage satisfies every selector assertion ever written about it.
- **Your own recent merges** — rule 6, with the market open, which is the strongest possible test.
- **Bugs, fixes, enhancements** — anything that makes your product wrong, unclear, or ugly on a
  live tape is in scope during this window.

A defect found while the market is open and reproduced against live data is worth more than a
week of offline reasoning about the same code. **Spend the window.**

#### Why the split exists

Largo integration work is offline work: it reads types, payload shapes and boundaries, and it is
equally correct at midnight. Live validation is the opposite — it is only possible for three and a
half hours a day, and it cannot be caught up on later. **Do not spend a scarce resource on work
that keeps.**

#### At the bell

- **09:30 ET:** stop Largo work at a clean point — commit or stash, do not leave a half-edit — and
  switch to your product.
- **13:00 ET:** write up what you found (PRs for defects, a FINDINGS entry for anything real), then
  return to the Largo boundary.

An unfinished Largo change is not a reason to skip the window. The window does not wait; the
refactor does.

### 7. Absence is a finding, not a blank

The defect class this fleet keeps finding is **a fact that exists in the system and is not wired to
the rule that needs it** — and its usual signature is a confident answer built on nothing. An
unmeasured tape must not arrive as a measured 50/50. A missing wall must not read as "no wall". A
rate must never be printed without the denominator it came from. When you cannot measure something,
say so in the payload; never let the model infer certainty you do not have.

---

## Useful commands

```bash
node scripts/audit/agent-pr-sweep.mjs           # live state of every agent PR
node scripts/audit/findings-merge-resolve.mjs   # coordinator-only, during a merge conflict
npm test                                        # exact command CI runs; warns loudly off Node 20
```

See also `docs/agents/FLEET.md` (why the fleet is structured this way),
`CLAUDE.md` (audit policy, environment realities), and
`docs/audit/LARGO-PRODUCT-CONTRACT.md` (the ten-point contract every Largo-facing read follows).
