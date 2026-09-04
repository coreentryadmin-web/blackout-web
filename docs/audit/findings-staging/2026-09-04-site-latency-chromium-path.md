# 2026-09-04 — site-latency-audit Playwright chromium path on cloud agents — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Area** | `scripts/site-latency-audit.mjs` |
| **Severity** | P3 — audit harness only, no member-facing impact |

## Symptom

`npm run validate:site-latency` (and scheduled site-latency runs) crashed at browser launch on cloud agents without `/opt/pw-browsers`:

```
browserType.launch: Executable doesn't exist at /home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1234/...
```

API warm pass completed; browser paint section never ran.

## Root cause

`site-latency-audit.mjs` called `chromium.launch()` with no `executablePath`. PR #3564 added `resolveChromiumPath()` for tunnel-based harnesses (`proxy-tunnel-context.cjs`) but this npm-wired latency script was not updated.

## Fix

Import `resolveChromiumPath` from `scripts/audit/lib/playwright-chromium-path.mjs` and pass `executablePath` when launching Chromium (falls back to system `google-chrome` on cloud agents).

## Regression guard

`scripts/site-latency-audit.test.ts` — asserts import + `resolveChromiumPath()` usage.
