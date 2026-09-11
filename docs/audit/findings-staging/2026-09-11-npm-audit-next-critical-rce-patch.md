# `npm audit` critical: Next.js unauthenticated RCE (Image Optimization API), plus 8 more high/moderate transitive vulns — clean patch bump applied

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P0/Critical (production-reachable RCE), bundled with 6 High + 2 Moderate dev/transitive fixes |
| **Area** | Dependencies — `next` (direct, production), `sharp` (direct + nested, production), plus 6 dev/transitive packages (`js-yaml`, `browserslist`, `fast-uri`, `nanoid`, `baseline-browser-mapping`, `colord`) |
| **Found by** | Operator-authorized adversarial dependency/supply-chain audit, 2026-09-11 |

## Root cause

`npm audit --json` (run on Node 20.20.2, per CLAUDE.md's Node-version guidance) reported 9 total
vulnerabilities: **1 Critical, 6 High, 2 Moderate**. The Critical is the one that matters most:

- **`next` (installed `15.5.23`, range `^15.5.19`) — GHSA-2xp9-vwfh-vxw4**: unauthenticated Remote
  Code Execution in the **Image Optimization API** when AVIF files are processed. This is reachable
  in production — `next/image`'s optimization endpoint is live, first-party framework code, not a
  dev-only or opt-in surface.
  - A second advisory on the same package, GHSA-p293-qw3h-jr36 (Windows-hosted RCE), is **not**
    exploitable in this deployment (prod runs `node:20-bookworm-slim` on ECS, not Windows) but is
    fixed by the same bump regardless.
- **`sharp`** (direct dep `0.35.4`, and a second, more-vulnerable copy nested at
  `next/node_modules/sharp@0.34.5`, range `<=0.35.4-rc.0`) — inherited `libvips`/`libheif` CVEs
  (GHSA-f88m-g3jw-g9cj, GHSA-rgj7-g3m4-5g8c). Same production surface as the Next.js image pipeline.
- The remaining 6 (`js-yaml`, `browserslist`, `fast-uri`, `nanoid` via `docx`,
  `baseline-browser-mapping`, `colord`) are dev-tooling or low-blast-radius transitives (build
  chain / a `docx` internal ID generator) — lower real risk, but real CVEs with clean fixes, so
  fixed in the same pass rather than left open.

**Why it wasn't caught earlier**: nothing in the standing CI/audit pipeline currently runs
`npm audit` as a gate — the existing `verify` CI job runs tests/tsc/build/lint but not a dependency
vulnerability scan, so a security advisory landing after the last manual dependency bump had no
automatic trigger to surface it.

## Evidence

- `npm audit --json` (Node 20.20.2, clean `npm ci`'d tree): `{"info":0,"low":0,"moderate":2,"high":6,"critical":1,"total":9}`.
- `npm audit fix --dry-run` confirmed every one of the 9 resolves within existing `package.json`
  semver ranges (no `--force`, no major-version bump) before actually applying anything.
- Applied `npm audit fix` (no `--force`): `next` → `15.5.25` (past the `15.5.24` fix line),
  `sharp` stays at the already-patched `0.35.4` (nested copy under `next` now matches), all 9
  advisories cleared — post-fix `npm audit` reports **0 vulnerabilities**.
- `npx tsc --noEmit`: clean, exit 0.
- Full `npm test`: **13764 pass / 0 fail / 3 skipped** (pre-existing skips, unrelated to this
  change) — same suite, before and after, no regressions from the bump.

## Blast radius

- `next`'s Image Optimization API is used wherever the app renders `next/image` against any
  AVIF-capable source — worth a follow-up check (separate from this fix) on whether any
  user-influenced image URL reaches that pipeline, to bound real-world exploitability further.
- `sharp` is exercised via the same Next.js image pipeline in production; no other direct
  server-side image-processing call site was found in this pass.
- The dev/transitive fixes (`js-yaml`, `browserslist`, `fast-uri`, `nanoid`, `baseline-browser-mapping`,
  `colord`) touch only the build/lint toolchain and a `docx` internal dependency — not shipped to
  end users, included here because they were clean, available, no-risk fixes bundled in the same
  `npm audit fix` invocation.

## Fix rationale

`npm audit fix` (without `--force`) was the correct instrument here specifically because every one
of the 9 findings had a semver-compatible patch/minor available — verified via `--dry-run` before
applying anything, per the task's explicit instruction not to blindly force major bumps. No manual
version pins were hand-edited; the lockfile absorbed the bump within the ranges already declared in
`package.json` (`next`'s `^15.5.19` already permits `15.5.25`). Nothing was deliberately left
unfixed — all 9 advisories are resolved in this one PR since none required a breaking change.

## Not done in this pass (deliberately out of scope)

- **CI workflow supply-chain findings** (unpinned-by-SHA GitHub Actions tags, one workflow —
  `cron-audit-query.yml` — running live AWS credentials on a same-repo `pull_request` trigger
  without the dry-run gate its sibling `seo-syndicate.yml` already has) are **report-only** per this
  audit's explicit scope — no workflow files were touched. See the full audit write-up (shared with
  the operator separately) for detail; those are operator-review items given the trust-boundary
  nature of CI changes.
- **Node.js 20 LTS End-of-Life** (production pins `node:20-bookworm-slim`; Node 20 "Iron" LTS ended
  2026-04-30) is a separate, larger infrastructure lift (new base image, re-validate native deps)
  and is flagged for roadmap planning, not bundled into this dependency-patch PR.

## Market-open validation

Not applicable in the usual RTH-data sense (this is a framework/library patch, not a
data-correctness fix), but the natural post-merge check is: confirm the production ECS deploy picks
up `next@15.5.25` cleanly (image builds, `next build` succeeds — already proven by this PR's own
CI), and spot-check that `next/image`-rendered images still render correctly on a live page (e.g.
`/nighthawk` or any page using `next/image`) after the next production deploy, since an Image
Optimization API version bump is exactly the kind of change that's worth a quick visual sanity check
even though it's semver-non-breaking.
