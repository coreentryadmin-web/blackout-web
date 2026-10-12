## 2026-10-12 — [Security] x-intel cron echoed raw exception text in its HTTP response — FIXED
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Security / cron hygiene | MEDIUM — authenticated-cron info leak | FIXED |

**What's wrong.** `src/app/api/cron/x-intel/route.ts`'s catch block returned
`{ ok: false, error: "X intel generation failed", detail: message }`, where `message` is the
raw caught exception's `.message` — putting internal exception text directly into the cron's
HTTP JSON response.

**Why this is a regression of an already-fixed class, not a new category.** The 2026-07-29
`[Security] Medium hygiene: cron redact + Largo budget + flows rate limit` FINDINGS.md entry
fixed exactly this pattern across ~14 cron routes: "HTTP bodies no longer echo `err.message` /
`detail`; `logCronRun` still keeps detail" (internal logging keeps the detail for ops;
confirmed live: every other catch block checked — `banger-discovery`, `zerodte-grade`,
`legacy-live-sync`, `welcome-sequence`, `spx-evaluate`, etc. — computes the detail once for
`console.error`/`logCronRun` but returns only a generic string in `NextResponse.json(...)`).
`x-intel/route.ts` was added **2026-08-24** (`#2823`), a month after that sweep, and shipped
the exact same leak un-fixed — not because the original fix regressed, but because nothing
re-applies that fix to a cron route added afterward.

**Fix.** Removed `detail: message` from the HTTP response, matching the established pattern
exactly — `logCronRun` (line 308-312, unchanged) still gets `message` for internal ops
visibility; the HTTP caller now only sees the generic `"X intel generation failed"` string.

**Regression guard added.** A new repo-wide test,
`src/app/api/cron/cron-error-detail-redaction.test.ts`, scans every
`src/app/api/cron/*/route.ts` (not just the ~14 originally fixed, nor just x-intel) for a
caught-error identifier (bound via the `X instanceof Error ? X.message : ...` idiom) appearing
as a bare property value inside a `NextResponse.json(...)` call. This closes the actual gap:
the original fix was per-file and had no mechanism to catch a *future* cron route repeating the
same mistake. Verified RED→GREEN: stashing just the x-intel fix fails the new test exactly on
`x-intel/route.ts`; restoring it passes (1/1).

**Blast radius.** `x-intel/route.ts` only. `tsc --noEmit` clean.

**Verification.**
```
npx tsx --experimental-test-module-mocks --test src/app/api/cron/cron-error-detail-redaction.test.ts
# 1 pass, 0 fail
```

Found while re-verifying the 2026-07-29 security-hygiene finding's claims against current
source (standing DISCOVERY-lane practice of re-checking old FINDINGS.md entries) — the original
5 claims all still held, but the sweep extended naturally into checking whether any newer cron
route had drifted from the established pattern, which this one had.
