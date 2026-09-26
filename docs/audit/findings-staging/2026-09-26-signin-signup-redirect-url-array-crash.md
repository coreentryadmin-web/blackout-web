## Sign-in/sign-up pages crash on a repeated `redirect_url` query key — `"a?.trim is not a function"`

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Auth — `/sign-up`, `/sign-in` (Clerk post-auth redirect resolution) |
| **Severity** | P1 (member-facing 500 on the sign-up/sign-in entry point, real live traffic hit it) |
| **Status** | FIXED |
| **Files** | `src/lib/clerk-redirect-url.ts`, `src/lib/clerk-redirect-url.test.ts`, `src/app/sign-in/[[...sign-in]]/page.tsx`, `src/app/sign-up/[[...sign-up]]/page.tsx` |

**Root cause.** Both `SignInPage`/`SignUpPage` declared their `searchParams` prop as
`Promise<{ redirect_url?: string }>` and passed `sp.redirect_url` straight into
`clerkPostAuthReturnPath(raw: string | undefined | null)`, whose first line is
`const trimmed = raw?.trim();`. Next.js actually parses a REPEATED query key
(`?redirect_url=a&redirect_url=b` — trivially producible by a malformed link, a browser
extension, or a bot) into a `string[]`, not a `string`, regardless of what the route's own
`Props` type claims. `tsc` cannot catch this: the declared type is simply wrong about what
Next.js delivers, not unsound relative to its own (false) premise. An array has no `.trim`
method, so the page crashed with `TypeError: a?.trim is not a function` (minified var name;
confirmed via the full stack: `at q (.../page.js:2:8401)`).

**Evidence.** Live CloudWatch `/ecs/blackout-production`, 2026-09-26 ~20:00 UTC: 30 occurrences
of the identical digest (`273586978`) in a ~19-second burst across 5 distinct ECS task log
streams — the same deterministic bug hit repeatedly by one client's retry storm, not a fluke.
Confirmed by reproducing the exact live error message in a regression test against the
pre-fix code (`git stash` the fix, re-run the new test — reproduces `raw?.trim is not a
function` byte-for-byte, then restore).

**Why this wasn't caught earlier**: no test previously exercised `clerkPostAuthReturnPath`
with anything but a `string | undefined`, matching the (incorrect) type contract every caller
assumed. The bug needed a repeated query key specifically — a normal single `?redirect_url=`
request is unaffected, which is likely why it went unnoticed until a bot/retry pattern
produced the array shape.

**The fix.** Added `firstRedirectParam()` inside `clerk-redirect-url.ts` — the actual external
boundary function (`clerkPostAuthReturnPath`, called with raw external `redirect_url` input
from both page.tsx files and, via `URLSearchParams.get()`, from `middleware-clerk.ts`) now
widens its parameter type to `string | string[] | undefined | null` and takes the first value
when given an array, mirroring what `URLSearchParams.get()` already does for the middleware
caller — so the three current callers, and any future one, get the same safe behavior from one
place. Also corrected both page.tsx `Props.searchParams` types from `{ redirect_url?: string }`
to `{ redirect_url?: string | string[] }` so the type system reflects Next.js's real contract
going forward, rather than continuing to hide this exact class of bug from `tsc`.

**Blast radius.** `clerkStagingReturnPath`/`clerkSanitizeStagingReturnUrl` (the two internal
helpers `clerkPostAuthReturnPath` calls) are never reached with unnormalized external input
directly — their only other caller (`clerkSatelliteAuthRedirect` in `clerk-env.ts`) always
passes an already-resolved plain string — so fixing the one external entry point closes the
gap for the whole call graph. `middleware-clerk.ts`'s three call sites use
`req.nextUrl.searchParams.get("redirect_url")`, which already returns `string | null` (first
value only) by the Web `URLSearchParams` spec, so middleware was never vulnerable to this
specific crash — confirmed, not assumed, by reading its call sites.

**Fix rationale — what was deliberately left unchanged.** Did not touch
`clerkSanitizeStagingReturnUrl`/`clerkStagingReturnPath`'s own signatures (still
`string | undefined | null`) since every real caller already passes a string by the time
those are reached; widening them too would be unused defensive surface, not a fix for an
actual gap. Did not add a generic "handle arrays everywhere" utility — this is the one
concrete external boundary that needed it.

**Evidence (tests).**
- `npx tsx --experimental-test-module-mocks --test src/lib/clerk-redirect-url.test.ts` —
  13/13 pass post-fix; the new test reproduces the exact live crash pre-fix (`git stash` the
  fix, re-run: `TypeError: raw?.trim is not a function` at `clerkPostAuthReturnPath`), then
  passes clean post-fix.
- `npx tsx --experimental-test-module-mocks --test src/lib/clerk-env.test.ts
  src/lib/clerk-session-recovery.test.ts src/app/native-signin/route.test.ts` — 13/13 pass,
  no regression in the surrounding auth-redirect call graph.
- `npx tsc --noEmit` — clean.
- `npx next lint --file src/lib/clerk-redirect-url.ts --file "src/app/sign-in/[[...sign-in]]/page.tsx" --file "src/app/sign-up/[[...sign-up]]/page.tsx"` — clean.

**RTH check.** Not RTH-gated — this is a Clerk-auth entry point, live 24/7, not a market-hours
feature. Once deployed: re-run the CloudWatch grep for `"a?.trim is not a function"` over a
few hours and confirm zero new occurrences; a genuine open-redirect regression would instead
show up as `clerkPostAuthReturnPath` returning something other than `/` or `/flows`-shaped
paths for a crafted external URL, which the existing open-redirect tests in this same file
already cover.
