# GHA RTH deep audit false RED on ECONNRESET + socket-health blip

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|
| **Severity** | P2 — scheduled `RTH deep audit` noise |
| **Discovered** | 2026-10-22 workflow run 39836457065 (~15:02 ET) |

## Symptom

`gha-rth-audit.mjs` failed with `postgres: read ECONNRESET` and `socket-health: HTTP 503` while full-site deep audit reported 39 passes (one P1 nighthawk premium-cap advisory only).

## Root cause

Postgres catch treated `ECONNRESET` as a hard failure (regex omitted reset/terminated patterns that `rth-open-check` already skips). `socket-health` used a single HTTP fetch — transient 503/warming failed the run while `probeOptionsSocketWithRetries` already exists for `rth-open-check`.

## Fix

Align `scripts/gha-rth-audit.mjs`: retry Postgres block, skip on `isTransientAuditPgError`, and probe socket-health with shared retry helper.

## Verify

Next `RTH deep audit` on GHA should warn-skip Postgres on proxy blips and retry socket-health before RED.
