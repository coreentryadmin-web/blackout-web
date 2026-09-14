## 2026-09-14 — [FINDING, P3 tooling/docs, REPORTED — NOT FIXED, too large for a DISCOVERY-lane patch] CLAUDE.md's "Audit toolkit" list documents ~39 of the 243 scripts under `scripts/audit/` — 136 are genuinely undocumented, several look operationally valuable

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | REPORTED — this is a real, large documentation-coverage gap, not a small self-contained fix. Deliberately not patched piecemeal from DISCOVERY; see "Why this is a write-up" below. |
| **Severity** | P3 — nothing is broken in production; the cost is purely discoverability (a future session, human, or Cursor re-inventing a tool that already exists, or missing an existing one when it would have answered the question in front of them). |

### What was checked

Earlier this cycle, DISCOVERY fixed the opposite-direction problem (CLAUDE.md documenting `scripts/audit/largo-card-deadspace.mjs`, a script that had actually been deleted — PR #4982). This finding checks the reverse: do any real, currently-existing scripts under `scripts/audit/` go unmentioned in CLAUDE.md's "Audit toolkit (committed)" section (the curated bulleted list, currently lines ~566-612)?

**Counted, not estimated:** 243 `.mjs` files sit directly under `scripts/audit/` (excluding the `lib/` subdirectory, which holds shared helpers rather than standalone tools). Of those, **only ~39 are mentioned by name anywhere in CLAUDE.md.** Grepped each of the other 204 filenames against `package.json` and `.github/workflows/*.yml` to separate "documented elsewhere" from "genuinely orphaned":

- **63** are wired into an `npm run` script in `package.json` or invoked directly from a CI workflow (e.g. `client-server-boundary.mjs` runs in `ci.yml`; `deep-security-audit.mjs`, `homepage-e2e-audit.mjs`, `swing-sim.mjs`, `zerodte-sim.mjs`, `nighthawk-flow-polarity.mjs` and others have `npm run` entries) — these are discoverable another way, not silently lost.
- **136 have zero mention anywhere** — not in CLAUDE.md, not in `package.json`, not in any workflow file. A handful (~8) are `.test.mjs` files (e.g. `charm-depth-validate.test.mjs`) that are test files rather than standalone tools and arguably don't need a CLAUDE.md bullet at all, but that still leaves well over 100 real, runnable, undocumented audit scripts.

### Why this matters — a sample, not the whole list

The undocumented set isn't uniformly low-value housekeeping. A few read as directly relevant to this repo's own standing audit doctrine and worth surfacing by name rather than leaving buried:

- **`deploy-freshness.mjs`** — checks whether production is actually running what's on `main` (the exact "a merge is not a verification" principle CLAUDE.md's own issue-handling policy already states in prose, apparently mechanized in a script nobody pointed to).
- **`agent-pr-sweep.mjs`** — finds agent PRs that fell out of the merge pipeline despite green CI, written 2026-08-21 in direct response to the documented 36-PR "draft deadlock" incident in this same CLAUDE.md file — the fix for a problem this file narrates at length isn't linked from the narration.
- **`findings-verify-stale.mjs`** — re-verifies FINDINGS.md entries whose "fixed" status may be stale by checking the code directly — exactly the kind of tool the "re-verify old FINDINGS.md claims" clause of the standing DISCOVERY brief would want to know about.
- **`staging-index-check.mjs`** — checks whether the decommissioned `staging.blackouttrades.com` is still indexed by Google, an open P2 SEO-adjacent question.
- **`force-nighthawk-rebuild.mjs`**, **`test-date-bomb-scan.mjs`**, **`screenshot-0dte.mjs`** — each does a specific, non-obvious operational job (admin force-rebuild+debrief, scanning tests that will hard-fail CI on a future date purely from a hardcoded date literal, live 0DTE board screenshot capture) that a session hunting for "is there already a tool for this" would not find by reading CLAUDE.md alone.
- Large undocumented clusters by prefix, presumably each lane's own working scripts that never got folded back into the shared doc: `largo-*` (~20 files — probes/stress/quality-audit scripts), `vector-*` (~25), `helix-*` (~7), `x-*` social-posting tools (~8), `zerodte-*` (~8), `meridian-*` (~4), plus 4 more `findings-*` reconciliation tools alongside the 2 already documented.

### Why this is a write-up, not a same-cycle fix

CLAUDE.md's own toolkit entries are not one-liners — the existing 39 average several sentences each, several run to a full paragraph with methodology, caveats, and first-run results, because that's the standard this file has set for itself (see the entries immediately surrounding this one). Writing 136 entries to that same bar in one PR is not a "small self-contained fix" by any reading of the standing brief — it would be a very large diff, mostly authored from reading each script's own header comment rather than from having run and verified each one, and it would touch a single shared file every active lane also edits constantly (this exact failure mode — concurrent edits to one shared doc going stale within minutes — is why `findings-staging/` exists as a pattern in the first place, per this file's own README). Whichever lane(s) own the `largo-*`/`vector-*`/`helix-*`/`zerodte-*`/`meridian-*` clusters are also the right owners to write an accurate, tested description of their own tools, not a cross-lane sweep guessing at intent from a header comment.

### Suggested next step

1. Each owning lane periodically folds its own new `scripts/audit/*.mjs` additions into CLAUDE.md's toolkit list as part of shipping them, the same discipline already applied to the ~39 documented ones — this is a process gap (new tools ship without a doc update) more than a one-time backlog to clear.
2. If a one-time catch-up pass is wanted, it should be split by lane/prefix (`largo-*` owner writes those N entries, `vector-*` owner writes those, etc.) rather than attempted as a single cross-cutting PR — both to keep each entry accurate (written by whoever actually knows the tool) and to avoid one huge diff colliding with the very active concurrent edit stream on `main`.
3. The 4 tools called out above (`deploy-freshness.mjs`, `agent-pr-sweep.mjs`, `findings-verify-stale.mjs`, `staging-index-check.mjs`) look like the highest-value candidates to document first if anyone wants to start small rather than lane-by-lane.
