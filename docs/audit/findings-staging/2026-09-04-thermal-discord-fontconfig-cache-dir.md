# 2026-09-04 — thermal-discord fontconfig cache dir — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Priority** | P3 perf-latency |
| **Surface** | `src/lib/thermal-discord-card.ts` (`renderThermalDiscordCardPng`), `deploy/Dockerfile` |
| **Status** | FIXED in PR |

## Evidence

CloudWatch Logs Insights, 24h window: 72 occurrences of the bare stderr line `Fontconfig error: No
writable cache directories`, clustered in groups of exactly 4 per occurrence, exclusively during
RTH hours, roughly every 15-30 minutes. That cadence matches `cron-registry.ts`'s `thermal-discord`
entry (`schedule_label: "~Every 15 min (market hours)"`) — the only cron whose "full" mode calls
`renderThermalDiscordCardPng` (`src/lib/thermal-discord-run.ts:120`, `mode === "full"`). The same
invocations report success right around these lines (fontconfig degrades gracefully rather than
throwing), matching the finding's description that functionality is unaffected.

## Root cause

`renderThermalDiscordCardPng` rasterises an SVG string through `sharp(svg).png()`
(`src/lib/thermal-discord-card.ts`), whose SVG backend is librsvg — a real fontconfig client, unlike
`src/lib/x-desk-card.tsx`'s satori/`next/og` path (font *buffers*, no fontconfig at all; see that
file's own header comment on why it was moved off sharp/librsvg in the first place — a different,
already-fixed bug about which typeface renders, not this one).

`deploy/Dockerfile`'s runner stage installs fonts and runs `fc-cache -f` as **root** at build time
(lines 105-108), which populates fontconfig's system cache dir (`/var/cache/fontconfig`) owned
`root:root`. The container then runs as the unprivileged `nextjs` user (`useradd --system --uid
1001 --gid nodejs nextjs`, **no `-m`** — no home directory created, and the exec-form `CMD ["node",
"server.js"]` never invokes a shell that would populate `$HOME` either). Fontconfig's own
`fonts.conf` lists a per-user XDG fallback cache dir (`$XDG_CACHE_HOME/fontconfig`, defaulting to
`~/.cache/fontconfig`) for whenever the system cache dir isn't writable by the running user — and
with no `$HOME` and no `$XDG_CACHE_HOME` set anywhere in the image or task definition, that fallback
resolves to nothing fontconfig can create either. Every cold render (each cron firing runs in a
fresh request context) hits both cases, logs "No writable cache directories" once per candidate
directory it tried (matches the observed cluster-of-4), and falls back to resolving fonts without a
persistent cache — correct output, but a full font-cache rebuild paid on every single invocation
instead of ever reusing a warm one.

## Blast radius

Exactly one call site in the whole repo invokes `sharp` on an SVG string:
`renderThermalDiscordCardPng` in `src/lib/thermal-discord-card.ts` (confirmed via
`grep -r 'from "sharp"' src/` — the only other match is `x-desk-card.test.ts`, which *asserts*
`x-desk-card.tsx` does **not** use sharp). No other cron or product surface is affected by this
root cause.

## Fix

Added `ensureFontconfigCacheDir()` (`src/lib/thermal-discord-card.ts`), called at the top of
`renderThermalDiscordCardPng` before the `sharp()` call. It sets `process.env.XDG_CACHE_HOME` to a
writable directory under `os.tmpdir()` (Fargate task ephemeral storage always includes a writable
`/tmp` — see this repo's "Environment realities" notes) the first time it runs in a process, and
creates that directory if it doesn't exist yet. A stale value from an earlier request in the same
task is deliberately reused for the task's lifetime — that reuse *is* the fix, since it lets
fontconfig keep a warm cache across renders instead of rebuilding cold every time. It never
overrides an operator-supplied `XDG_CACHE_HOME` (checked before writing), so a future infra-level
fix (below) composes cleanly with this one rather than fighting it.

**Deliberately NOT changed:** the Dockerfile/task-definition. The finding's own suggested fix
correctly anticipated this might need an infra-level change (e.g. giving the `nextjs` user a real
home directory, or making `/var/cache/fontconfig` group-writable so the build-time cache itself
persists instead of being rebuilt via `/tmp`) — that is a legitimate follow-up, but per this repo's
"AWS / terraform" standing caution, infra changes to a live production task definition are not
something to make from this sandbox on a P3 latency finding, and the code-level fix above already
gets the same practical outcome (a warm, persistent cache for the life of a task) without touching
the image or task definition at all. Documented here as the infra-level follow-up rather than left
silently undone, per this finding's own instructions.

## Regression test

`src/lib/thermal-discord-card.test.ts` — three new tests: `ensureFontconfigCacheDir` sets an
existing, writable `XDG_CACHE_HOME` when unset; it never overrides an operator-supplied one;
`renderThermalDiscordCardPng` itself leaves a real, existing cache dir behind after rendering (i.e.
the fix actually runs on the real code path, not just in isolation). RED→GREEN proved via
`git stash` on just the `src/lib/thermal-discord-card.ts` change — with the fix stashed,
`ensureFontconfigCacheDir`/`__resetFontconfigCacheDirForTest` don't exist and the new tests fail to
even import; with it restored, all three pass alongside the file's existing 9 tests.

## AWS/CloudWatch note

This finding's evidence (the 72-line/24h CloudWatch count) was supplied by the audit sweep that
produced it; this session did not have live AWS credentials to independently re-pull the
CloudWatch Logs Insights query. The code-level root cause (Dockerfile `useradd` without `-m`, root-
owned `fc-cache` at build time) was confirmed by reading the current `deploy/Dockerfile` and
`src/lib/thermal-discord-card.ts` directly, independent of the CloudWatch evidence.
