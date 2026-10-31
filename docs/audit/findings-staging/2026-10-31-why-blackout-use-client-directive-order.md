> **kind:** FINDING

## `WhyBlackoutContent.tsx`'s `"use client"` directive was silently inert — a type import landed above it — FIXED

| | |
|---|---|
| **Area** | `src/components/landing/WhyBlackoutContent.tsx` (`/why-blackout` marketing page) |
| **Severity** | P3 (latent — no live user-facing symptom today, but a real, silently-broken module directive) |
| **Status** | FIXED |

### Root cause

A JS/TS module directive (`"use strict"`, and Next.js's own `"use client"`) only takes effect
when it is the **literal first statement** in the file — before any other statement, including an
`import` statement, even a type-only one that is fully erased at compile time. This is the same
rule `"use strict"` has always had; Next.js's React Server Components compiler applies it
identically when scanning a module's directive prologue for `"use client"`.

`WhyBlackoutContent.tsx` shipped originally (commit `0728f9d07`, "Add /why-blackout landing page",
PR #1471) with `"use client";` correctly on line 1. A later, unrelated breadcrumbs fix
(`c3d10141c` / `6ab7ef731`, PR #1944, "breadcrumbs rendered under the fixed nav on 12 marketing
pages") added a `breadcrumbs?: ReactNode` prop and, with it, `import type { ReactNode } from
"react";` — inserted **above** the pre-existing `"use client";` line:

```ts
import type { ReactNode } from "react";
"use client";

import Link from "next/link";
```

From that commit onward, `"use client";` was no longer the first statement in the module. Next.js's
directive-prologue scan stops looking the moment it sees a non-directive statement, so the literal
is demoted to an ordinary, no-op string-expression statement — it compiles fine, produces no error,
and simply does nothing. The file has silently been a plain module (Server Component, by default)
rather than a Client Component ever since, with no indication anywhere that the directive stopped
working.

### Evidence

- `git log -p --all -- src/components/landing/WhyBlackoutContent.tsx -S'"use client"'` shows the
  directive was on line 1 at file creation and the breadcrumbs-fix commit is exactly the diff that
  inserted the import above it (confirmed via `git log --all -S'import type { ReactNode } from
  "react";" -- src/components/landing/WhyBlackoutContent.tsx` → `c3d10141c`/`6ab7ef731`).
- Repo-wide sweep — `grep -rl '"use client"' src --include="*.tsx" --include="*.ts"`, then checking
  each file's first non-blank line — confirms `WhyBlackoutContent.tsx` was the **only** file in the
  entire repository where `"use client"` is not the literal first line. Every other client
  component (helix panels, `AdminSpxDashboard.tsx`, `EmbedFrame.tsx`, SPX components, etc.) puts it
  first, confirming this is a genuine regression, not an intentional repo pattern.
- Reproduced RED→GREEN on the new regression test (below): asserting `"use client";` equals the
  file's first non-blank line fails on `origin/main`'s current content (`got:
  "import type { ReactNode } from \"react\";"`) and passes once the two lines are swapped.

### Why this hasn't caused a visible production symptom (yet)

`WhyBlackoutContent` itself uses no hooks and no browser-only APIs — it renders static JSX
(`Link`, plain markup) plus `<MarkdownBody>`, which carries its **own**, correctly-placed
`"use client"` directive. So whether `WhyBlackoutContent` itself compiles as a Server or Client
Component makes no difference to what currently renders, which is exactly why this went unnoticed
for every "did the page render" audit round since PR #1944. The risk is latent, not cosmetic: the
next edit that adds a `useState`/`useEffect` (or any other client-only hook) directly inside this
component will pass `tsc --noEmit` and the unit suite cleanly, then hard-fail `next build` with
"You're importing a component that needs client-only ..." — the exact failure shape
`client-server-boundary.test.ts`'s own doc comment documents for a different, already-caught case
in this codebase (a bundler-only failure that neither `tsc` nor the unit suite can see).

### Fix

Moved `"use client";` back above the `import type { ReactNode } from "react";` line, restoring the
directive to the first statement in the module — i.e. restoring the file to what commit `0728f9d07`
originally shipped, with the breadcrumbs prop/import now ordered after it instead of before it.
This is the minimal, intent-preserving fix: it does not remove the directive (which the component
was written with and may still want if it ever grows interactivity) and does not change any
runtime behavior visible today, since nothing in the file currently depends on the client/server
boundary either way.

### Blast radius

Single file, single directive, no other call sites. No duplicated instance of this exact mistake
exists elsewhere — confirmed via the repo-wide "use client" first-line sweep above, which found
exactly one offender.

### Regression test

Extended `src/components/landing/WhyBlackoutContent.test.ts` (nearest existing test file for this
component) with a new test: `'"use client" is the literal first line — not merely present, but a
real directive'`. It reads the component's first non-blank source line and asserts it is exactly
`"use client";`, catching any future statement (import or otherwise) that lands above it.
Verified RED (fails against the broken ordering, `git stash` on the source file alone) → GREEN
(passes with the fix), `tsc --noEmit` clean, ESLint clean, and the related
`client-server-boundary.test.ts` / `public-record-scope-claims.test.ts` /
`breadcrumbs-placement.test.ts` suites all still pass unmodified.
