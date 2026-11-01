# 2026-10-31 GA4 pending-signup storage key hardcoded as a duplicate literal in 3 places instead of the exported constant

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 code-quality / latent maintenance hazard (confirmed zero behavior change today) |

## Root cause

`src/lib/analytics/utm.ts` exports `GA4_PENDING_SIGNUP_KEY = "bo_ga4_pending_signup_v1"` as the
named source of truth for this sessionStorage key — but a repo-wide, word-bounded,
all-file-types grep for the identifier `GA4_PENDING_SIGNUP_KEY` found exactly **one** hit in the
whole repo: its own declaration. Nothing imported it.

The reason it reads as unused despite the *key itself* being very much alive: `src/lib/analytics/
ga4-client.ts`'s `markPendingSignUp`/`hasPendingSignUp`/`consumePendingSignUp` — the three
functions that actually read/write this sessionStorage slot (used by `Ga4Attribution.tsx` to gate
the `/upgrade` signup GA4 + Google Ads conversion fire until gtag has loaded) — each independently
spelled the same string out as a hardcoded literal (`"bo_ga4_pending_signup_v1"`, three separate
times) instead of importing the constant `utm.ts` already exports for exactly this purpose. The
sibling key in the same file, `GA4_ONCE_STORAGE_KEY`, IS imported and used correctly by
`ga4OncePerSession` — so this isn't a missing pattern, it's one constant that fell through the
crack when the sibling pattern was applied.

Today the three literals and the constant agree byte-for-byte, so there is no live bug — but
nothing enforced that agreement. `GA4_PENDING_SIGNUP_KEY` is the obviously-correct, discoverable
place to change this key (it's exported, named, and sits right next to the other GA4 storage-key
constants); a future edit there would silently leave all three call sites in `ga4-client.ts`
reading/writing the OLD key, breaking the pending-signup dedupe/retry flow (`Ga4Attribution.tsx`'s
whole reason for existing, per that file's own regression-test header: avoid losing the signup
conversion event to a gtag-not-ready race) with no compiler error, no test failure, and no runtime
error — just a conversion event that silently stops firing after a key rename that looked complete.

## Evidence

Fresh grep against `origin/main` (f2ee8f3), word-bounded, across `*.ts/*.tsx/*.js/*.jsx/*.mjs/
*.cjs/*.md/*.json`, excluding `node_modules`/`.git`:

```
$ grep -rlw "GA4_PENDING_SIGNUP_KEY" --include='*.ts' ... | wc -l
1   # only src/lib/analytics/utm.ts:5 (its own declaration)
```

and the three literal duplicates it should have been:

```
src/lib/analytics/ga4-client.ts:69:    sessionStorage.setItem("bo_ga4_pending_signup_v1", "1");
src/lib/analytics/ga4-client.ts:84:    return sessionStorage.getItem("bo_ga4_pending_signup_v1") === "1";
src/lib/analytics/ga4-client.ts:93:    const v = sessionStorage.getItem("bo_ga4_pending_signup_v1");
src/lib/analytics/ga4-client.ts:95:    sessionStorage.removeItem("bo_ga4_pending_signup_v1");
```

RED→GREEN proof (behavior is identical either way since the values already matched, so the
regression test pins the fix at the *source* level instead): a new test,
`"the pending-signup storage key is never hardcoded as a duplicate literal in this file"` in
`src/lib/analytics/ga4-client.test.ts`, reads `ga4-client.ts`'s own source and asserts it imports
`GA4_PENDING_SIGNUP_KEY` and never re-spells the literal string. `git stash` on `ga4-client.ts`
alone (test file + finding kept) reproduces the pre-fix source and the new test fails
(`ga4-client.ts must import and reference the shared GA4_PENDING_SIGNUP_KEY constant`); restoring
the fix makes it pass, 7/7 in the file, 34/34 across all five `src/lib/analytics/*.test.ts` files.

## Blast radius

Only `ga4-client.ts`'s three call sites used the literal — `Ga4Attribution.tsx` and
`Ga4ConversionTracker` call the exported `markPendingSignUp`/`hasPendingSignUp`/
`consumePendingSignUp` functions, never the raw string, so no other file needed a change. The
sibling `hasPurchaseFired`/`markPurchaseFired` pair (same file) uses a per-user **template**
literal (`` `bo_ga4_purchase_fired:${userId}` ``) that cannot be a plain exported constant the same
way — left untouched, out of scope for this fix.

## Fix rationale

Import `GA4_PENDING_SIGNUP_KEY` from `./utm` (same import line as the already-correct
`GA4_ONCE_STORAGE_KEY`) and use it at all three call sites in `ga4-client.ts`. This was chosen over
simply deleting the now-"zero-reference" `GA4_PENDING_SIGNUP_KEY` export (the round's other
candidate framing, dead-code removal): deleting it would have left the real drift hazard in place
and only hidden the symptom (the unused-export signal), whereas wiring it in removes the actual
duplication and makes the constant the single real source of truth it was clearly meant to be.
Zero behavior change confirmed by `tsc --noEmit` (clean), `eslint` (clean) on both touched files,
and the full `src/lib/analytics/*.test.ts` suite (34/34 pass).
