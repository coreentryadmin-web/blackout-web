## 2026-10-18 — [FINDING, deploy] ECR deploy false-fails when Cloudflare blocks GHA egress

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 |
| **Surface** | `scripts/validate-static-assets.mjs`, `ecr-push-production.yml` |

### Symptom

`build-and-push` on `94d132283` failed at **Validate static assets on origin**: `/`, `/sign-in`,
`/sign-up` returned **HTTP 403** with Cloudflare “you have been blocked” HTML during the live
outage (WAF blocking GitHub Actions egress). ECS roll may have succeeded; CI treated it as broken
`/_next/static` hashes.

### Fix

Detect Cloudflare edge-block HTML (exit code 2). After the full retry window, if every failure was
edge-block only, warn and exit 0 so deploy pipeline does not cry-wolf. Real asset mismatches still
exit 1.
