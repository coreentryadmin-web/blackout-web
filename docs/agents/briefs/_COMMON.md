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
15 minutes, marks any agent draft ready once `verify` is green, and `automerge.yml` merges it.

> **Open the PR, drive CI to green, then stop.** Do not spend turns retrying the undraft. Do not
> report a draft PR as blocked. A green draft is a finished handoff.

### 4. `FINDINGS.md` conflicts with every other lane — not your bug

Every lane appends at the same anchor, so every pair of agent PRs collides there regardless of what
code they touch. The coordinator resolves it with `scripts/audit/findings-merge-resolve.mjs`. Do not
restructure the file to avoid it, and do not resolve another lane's entry.

### 5. Ask the coordinator, never the user

Questions, ambiguity, and scope calls go in a **PR comment**. The user is not in your loop.

### 6. Merged is not done. Deployed is not done.

Only **live-validated** is done. Merging to `main` fires `ecr-push-production`; after it deploys,
re-validate against production. A check run seconds after a merge proves nothing — the old task is
often still serving.

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
