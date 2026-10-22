## 2026-10-22 — [FINDING, CI] RTH deep audit false-red on Postgres ECONNRESET

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 |
| **Surface** | `scripts/gha-rth-audit.mjs` |

### Symptom

Scheduled **RTH deep audit** on `7b0f46b` failed `postgres: read ECONNRESET` in
`gha-rth-audit.mjs` while platform checks mostly passed.

### Fix

Reuse `isPrivateDbUnreachableError` / `isStaleAuditDbAuthError` for the Postgres catch path
(same discipline as `rth-open-check.mjs` after #6581).
