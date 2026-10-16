## 2026-10-16 — [FINDING, P3, admin UI] AdminApiDashboard's registry probe-status filter was missing `rate_limited`, a real live outcome — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Severity** | P3 — admin-only UI gap, no member/data impact. An admin triaging the endpoint registry had no way to filter the table down to just rate-limited (429) endpoints. |
| **Trigger** | DISCOVERY-lane sweep of `AdminApiDashboard.tsx`, cross-checking its locally-declared `ProbeFilter` literal union against `admin-endpoint-registry.ts`'s exported `RegistryProbeStatus` type. |
| **Root cause** | `ProbeFilter` was a separately hand-maintained literal union (`"all" \| "ok" \| "fail" \| "blocked" \| "unknown"`) instead of deriving from `RegistryProbeStatus` (`"ok" \| "fail" \| "blocked" \| "rate_limited" \| "unknown"`, `admin-endpoint-registry.ts`). `rate_limited` is a real, observed probe outcome (`probe.status === 429` sets it directly) with its own dedicated "429" badge in `probeBadge()` — so the component already distinguishes it visually — but the filter-tab array hardcoded `["all", "ok", "fail", "blocked", "unknown"]`, omitting it entirely. Same class of bug as other recent fixes this session (a type/list maintained in two places silently drifting): the data model gained a status, the filter UI never did. |
| **Fix** | `ProbeFilter` now reads `"all" \| RegistryProbeStatus` (imported type), tying it to the single source of truth so it can't drift from it again. Added `"rate_limited"` to the rendered filter-tab array. The underlying filter logic (`if (probeFilter !== "all" && row.probeStatus !== probeFilter) return false;`) already worked generically for any status value — no change needed there. |
| **Evidence (tests)** | New `admin-api-dashboard-probe-filter.test.ts` — source-text assertion (this repo's established convention for "use client" components, per `AdminLaunchStatusPanel.test.ts`'s own comment), 2 cases. RED→GREEN proven via `git stash` (pre-fix: 2 failed; post-fix: 2 passed). `npx tsc --noEmit -p .` clean. |
| **Blast radius** | One file changed (`AdminApiDashboard.tsx`), one new test file. No API route, data model, or other admin panel touched — `probeBadge()`'s `cls`/`label` records already had a `rate_limited` entry, so no change needed there. |
| **Fix rationale** | Deriving `ProbeFilter` from the exported `RegistryProbeStatus` type (rather than just adding the missing literal) closes the drift vector permanently — a future status addition to the registry's probe outcomes will now be a type error at the filter-tab array until rendered, instead of a silent UI gap. |
| **Status** | FIXED |
