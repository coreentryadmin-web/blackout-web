## 2026-10-18 — [FINDING, security] Next.js SSG/ISR cache-poisoning CVE + transitive high-severity vulns

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 |
| **Surface** | `next` (direct dep), `brace-expansion`/`fast-uri` (transitive, under `glob`) |

### Symptom

`npm audit --omit=dev` (production-reachable dependency scope) reported 3 vulnerabilities while
auditing the live site's overall security posture:

- **`next` 15.5.19–15.5.26 (moderate, direct dependency)** — two real CVEs
  ([GHSA-4jqv-mc3x-m676](https://github.com/advisories/GHSA-4jqv-mc3x-m676),
  [GHSA-mcj8-r9mp-w47p](https://github.com/advisories/GHSA-mcj8-r9mp-w47p)): cache poisoning of
  SSG/ISR pages in self-hosted deployments, leading to cross-user content substitution and
  persistent DoS. This repo is self-hosted on ECS (not Vercel), so the self-hosted attack surface
  applies.
- **`brace-expansion` (high, transitive under `glob`)** — ReDoS / stack-exhaustion DoS
  ([GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr),
  [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7),
  [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p)).
- **`fast-uri` (moderate, transitive)** — host-case-normalization inconsistency
  ([GHSA-hrr3-gc8f-f4qj](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj)).

Found during a live production security review (headers, cookies, exposed files, admin-route
gating, CORS, error disclosure, and `npm audit`) run at the operator's explicit request right
after the 2026-10-18 production outage recovered. Every other check passed clean (strong security
headers including HSTS/CSP/X-Frame-Options, no exposed `.env`/credentials/debug endpoints, all 6
probed admin routes correctly 401/307 when unauthenticated, no CORS reflection for an arbitrary
origin, no stack-trace leakage on malformed requests) — this dependency-CVE set was the only real
gap.

### Fix

- Bumped `next` from `^15.5.19` to `^15.5.28` (current stable; the CVEs are fixed as of 15.5.27).
  Patch-level bump, not the major v15→v16 migration already sitting in Dependabot PR #5547 — this
  closes the CVE without taking on that migration's risk/blast-radius.
- `npm audit fix` (non-forcing) cleared `brace-expansion` and `fast-uri`.

`npm audit --omit=dev` now reports **0 vulnerabilities**. `tsc --noEmit` clean on Node 20. Full
`npm test` run in progress to confirm no regression from the patch bump.

### Deliberately left alone (out of scope)

The remaining 15 vulnerabilities (2 moderate, 13 high) surfaced by a full (non-`--omit=dev`)
`npm audit` are entirely in **devDependencies** — the `stylelint`/`postcss`/`tailwindcss` lint
toolchain, which never runs in the deployed application and has zero production attack surface.
Clearing them needs `npm audit fix --force` (major-version bumps of stylelint and tailwindcss),
a real breaking-change migration unrelated to runtime security. Left for a separate, deliberate PR
if the team wants to take on that toolchain upgrade — forcing it here would be scope creep on a
security-only patch.
