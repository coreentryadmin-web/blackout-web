> **kind:** `FINDING`

## Admin Track Record page advertised an "embed on your site" snippet that has been admin-only (and therefore broken for its stated purpose) since before PR #2836 — FIXED

**Status.** FIXED (PR #6785, open).

### Area

`src/components/track-record/TrackRecordView.tsx` (Admin console "Track record" tab) and
`src/components/track-record/format.ts`. Non-owned — no owned-lane imports.

### Found by

DISCOVERY-lane live-UI sweep of the Admin console, 2026-10-26 — opened `/track-record`
(redirects to `/admin?tab=track-record`) with a temp admin Clerk session via `proxy-browser.cjs`.

### Symptom

The admin Track Record view renders a card titled "EMBED ON YOUR SITE" containing:

```html
<iframe src="https://blackouttrades.com/embed/track-record" width="400" height="420" frameborder="0" style="border-radius:12px;overflow:hidden;" />
```

with a "Copy snippet" button, implying this is a ready-to-paste public embed for an external
site.

### Root cause

`/embed/track-record` has been gated by `requireAdmin()`
(`src/app/embed/track-record/layout.tsx`) — confirmed intentional via its own in-code comment
("Admin-only embed preview (formerly public social-proof iframe)") and via
`TrackRecordEmbed.tsx`'s own header doc comment: *"the admin-only `/embed/track-record` iframe
preview... the legacy public `/track-record` route now just redirects to the admin console."*
This predates PR #2836 (which fixed a `redirect()`-not-firing bug affecting this and other
gates app-wide — the admin-only *intent* for this route was already in place before that fix;
the fix only made the existing gate actually work).

Live-verified the consequence: loading `/embed/track-record` with a non-admin session (minted
Clerk session, `publicMetadata: {}`) does not render the widget — it redirects to the
pricing/upsell page. So any admin who followed the admin UI's own "Copy snippet" instruction and
pasted that iframe onto an external site would show every real (non-admin) visitor of that site
a paywall redirect instead of the track-record widget — the feature visibly promised
functionality it could not deliver, likely since before PR #2836, possibly longer.

The actual working public social-proof surface already exists and is unaffected: `/methodology`
renders the identical `TrackRecordEmbed` component server-side directly (not via the gated
iframe route) — confirmed clean in an earlier DISCOVERY-lane pass the same day.

### Fix

Removed the "Embed on your site" card, its `handleCopy`/`copied` state, and the now-unused
`TRACK_RECORD_EMBED_SNIPPET` constant (`format.ts`). No security change — the admin-only gate on
`/embed/track-record` is untouched and was already correct by design; this only removes the
misleading UI that told admins the opposite.

### Blast radius

`TRACK_RECORD_EMBED_SNIPPET` had exactly one consumer, confirmed via repo-wide grep:
`TrackRecordView.tsx`. Nothing else references it.

### Tests

New `TrackRecordView.test.ts`: source-level regression asserting the component never references
"Embed on your site" / "Copy snippet" / `TRACK_RECORD_EMBED_SNIPPET`, and that `format.ts` no
longer exports the dead constant. RED→GREEN confirmed via `git stash` (2/2 new tests fail
pre-fix, pass post-fix). `npx tsc --noEmit` clean. Full suite: 16990 pass / 0 fail / 3
pre-existing skips (unrelated).
