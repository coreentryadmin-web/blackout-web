## PWA manifest's "maskable" icon reused the edge-to-edge "any" bitmap, with no safe-zone padding — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (PWA install/home-screen polish — no runtime crash, no data-correctness impact) |
| **Found by** | DISCOVERY-lane round 90, PWA manifest correctness check |
| **Scope** | `public/manifest.webmanifest`, new `public/icon-192-maskable.png`, new `src/lib/pwa-manifest.test.ts` |

### Root cause

`public/manifest.webmanifest` declared two icon entries at 192×192 — one `purpose: "any"`, one
`purpose: "maskable"` — but both pointed at the SAME file, `/icon-192.png`. That bitmap is a square
green-bordered "B" logo drawn edge-to-edge (the border frame sits within a few pixels of the image
boundary on all four sides).

The W3C maskable-icon spec requires a maskable icon's meaningful content to sit inside a centered
"safe zone" — an inner circle at roughly 80% of the icon's width/height — because platforms that
honor `purpose: "maskable"` (primarily Android home-screen launchers applying an adaptive-icon
mask: circle, squircle, rounded-square, etc. depending on the device's icon pack) crop everything
outside that safe zone. An icon authored edge-to-edge and declared maskable gets its border frame
(and, depending on the mask shape, part of the "B" glyph) silently clipped on install — the "any"
variant is fine as-is (nothing masks it), but reusing it as the maskable variant was never correct.

### Fix

Generated a properly safe-zoned maskable icon via `sharp` (already a repo dependency): scaled the
existing `icon-192.png` content down to 80% (154×154) and centered it on a new 192×192 canvas
filled with the manifest's own `background_color` (`#040407`), producing `public/icon-192-maskable.png`
— so a circular/squircle OS mask now crops only the background padding, never the logo. Updated
the manifest's `maskable`-purpose entry to point at the new file, leaving the `any`-purpose entry
unchanged (it was always correct).

### Regression guard

New `src/lib/pwa-manifest.test.ts`:
- every icon `src` in the manifest resolves to a real file under `public/` (catches a future typo'd
  or deleted icon path going unnoticed, since a broken manifest icon fails silently — no browser
  console error, no build failure, only a missing icon on an actual install attempt)
- the `any` and `maskable` icons are required to be **different files**, specifically to prevent
  this exact regression (reusing one edge-to-edge bitmap for both purposes) from being reintroduced
  without a test catching it

RED→GREEN confirmed via a temp-file swap of the manifest back to the pre-fix shape (both icons
pointing at `/icon-192.png`): the distinct-file assertion fails as expected; restoring the fix
passes both tests. `tsc --noEmit` and `eslint` clean on the new test file.

### Blast radius

Two static assets (`public/manifest.webmanifest`, new `public/icon-192-maskable.png`) and one new
test file. No application code changed; the `any`-purpose icon (used by browser tab/bookmark UI,
which does not apply a mask) is untouched.
