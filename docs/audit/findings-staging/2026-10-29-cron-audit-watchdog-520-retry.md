# Cron audit query failed on watchdog HTTP 520 — FIXED

> **kind:** FINDING

| **Status** | FIXED (PR pending) |

## What broke

`query` job on `c722f91eb` used HTTP watchdog fallback and failed immediately on Cloudflare **520** — transient origin blip, not cron staleness.

## Fix

Treat **520** as transient origin error; retry watchdog fetch up to 3× (same as `ops:collect`).

## Validation

Next scheduled Cron audit query should survive brief 520/502/503 during deploy.
