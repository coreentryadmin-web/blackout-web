> **kind:** FINDING

## /account's Upgrade CTA used a plain `<a>` instead of `next/link` — FIXED

| **Status** | FIXED — `src/components/account/AccountMembershipPanel.tsx` now uses `next/link` |

### Root cause

`AccountMembershipPanel`'s free-tier "Upgrade" CTA was a plain `<a href="/upgrade">`. `/upgrade`
is an internal route in the same Next.js app, so a plain anchor forces a full page reload
(re-fetching every asset, re-running the whole client bootstrap) instead of the client-side SPA
navigation the rest of the app uses via `next/link`. Repo-wide grep for `<a href="/` found this
as the only internal-route anchor outside the component's own correctly-external `manageHref`
link (Whop's billing portal — genuinely external, correctly kept as `<a target="_blank"
rel="noopener noreferrer">`).

### Evidence

`grep -rn '<a href="/' src --include="*.tsx"` returned exactly one match before this fix:
`AccountMembershipPanel.tsx:55`.

### Blast radius

Single call site, single component, one route (`/account` → `/upgrade`).

### Fix rationale

Swapped the one internal anchor for `next/link`'s `Link`, matching the pattern used everywhere
else in the app for internal navigation. Zero behavior change for the external Whop link. Added
a source-level regression test (`AccountMembershipPanel.test.tsx`) asserting the import and JSX
tag, since rendered HTML markup is identical between `<a>` and `<Link>` (both resolve to an
`<a>` tag) and can't distinguish the two — a plain `renderToStaticMarkup` assertion on the
output wouldn't catch a regression back to a bare anchor, so the test instead checks the source.
