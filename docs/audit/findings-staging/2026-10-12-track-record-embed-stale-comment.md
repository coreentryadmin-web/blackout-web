## 2026-10-12 — [FINDING, P4 docs/discovery] `TrackRecordEmbed`'s doc comment named three consumers, all now wrong — FIXED
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Public embeds | P4 — doc-only, no behavior change | FIXED |

**What's wrong.** `src/components/embeds/TrackRecordEmbed.tsx`'s header comment claimed:

```
Presentational social-proof card. PURE props in (no fetching) so it renders
both server-side (public /track-record page + iframe) and client-side
(dashboard). No grey text per house rule — bull / cyan-400 / sky-300 / white.
```

All three named consumers are stale:
- **"public /track-record page"** — `src/app/(site)/track-record/page.tsx` is now just
  `redirect("/admin?tab=track-record")`; it's a legacy-URL redirect to the admin console, not a
  public page.
- **"iframe"** — the only iframe route, `src/app/embed/track-record/page.tsx`, is gated by its
  layout's `requireAdmin()` call and is explicitly commented `"Admin-only embed preview (formerly
  public social-proof iframe)"`. Not public anymore.
- **"client-side (dashboard)"** — no client-side/dashboard usage exists anywhere in the tree
  (repo-wide grep for `TrackRecordEmbed` found exactly two real call sites, both server-rendered).

The actual real public consumer — `MethodologyContent.tsx`, rendered inside `/methodology` — went
unmentioned.

**Fix.** Rewrote the comment to name the two real current consumers: the public `/methodology`
page (the real public surface) and the admin-only `/embed/track-record` iframe preview, noting the
legacy public route now just redirects. Doc-only, no logic change.

**Verification.** `tsc --noEmit` clean.

**Blast radius.** One doc comment. No runtime behavior touched.

**Separately verified, not re-flagged**: the same sweep confirmed the 2026-09-10 FINDINGS.md entry
about `/methodology`'s `DatasetJsonLd`/`PropertyValue` schema is still correctly wired — gated
behind `spxRecord.available`, every `PropertyValue` sourced from the same `buildPublicTrackRecord()`
object `TrackRecordEmbed` renders, no drift. Also checked (no bugs found): the PWA manifest's icon
references, the service worker's cache-shell list, `/offline`'s links, and the embed route +
`/api/public/track-record`'s admin-gating (defense-in-depth, correctly matched, not over/under
gated).

Found via a background Explore-agent sweep of public embed/offline/PWA surfaces,
independently re-verified (confirmed the exact stale comment text, the real two call sites via
repo-wide grep, the admin-gated layout, and the legacy redirect) before fixing.
