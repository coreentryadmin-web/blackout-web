> **kind:** FINDING

## `public/sw.js`'s `notificationclick` same-origin guard is bypassed by a leading backslash — FIXED

| | |
|---|---|
| **Area** | `public/sw.js` (the PWA service worker's push-notification click handler) |
| **Status** | FIXED, regression test added (`src/lib/push/sw.test.ts`) |
| **Severity** | P2 (open-redirect from a push-notification tap) |
| **Bug shape** | string-prefix check standing in for URL parsing — a new instance of the "pattern-match a cross-origin string instead of parsing it" class |

### Root cause

`sw.js`'s `notificationclick` handler takes `url` from the push payload (`data.url`, set
server-side in `src/app/api/push/send/route.ts` / `public/sw.js`'s own `push` handler) and was
guarding it with:

```js
var target =
  typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//")
    ? raw
    : "/dashboard";
```

The comment above it says "Only open same-origin paths — reject absolute/protocol-relative URLs
from push payloads." The guard does reject an EXPLICIT protocol-relative string like
`"//evil.com"`. It does **not** reject `"/\evil.com"` or `"/\\evil.com"` — both satisfy
`startsWith("/") && !startsWith("//")`, because the string literally starts with one forward
slash, not two.

But the WHATWG URL parser (used by every browser, and by Node's own `URL`, which implements the
same spec) treats `"\"` exactly like `"/"` while parsing a relative reference for a *special*
scheme (`http`/`https` are special schemes). A leading `"/"` immediately followed by `"\"` is
therefore ALSO read as the two-"slash-like"-character prefix that starts a **network-path
reference** — i.e. it resolves against the BASE URL's scheme but takes its **host from the text
that follows**, exactly like `"//evil.com"` does:

```js
new URL("/\\evil.com/phish", "https://blackouttrades.com/").origin
// => "https://evil.com"   (NOT "https://blackouttrades.com")
```

So a push payload with `url: "/\\evil.com/phish"` passes the old guard unchanged (`target =
raw`), and `self.clients.openWindow(target)` (or whatever existing tab happens to match the
`.includes()` check first) opens the user's browser at `evil.com`, not at the site's own
`/dashboard` fallback the guard was written to enforce. This is a real, named class of bug —
PortSwigger and others document the identical backslash-normalization trick as a standing
technique for bypassing exactly this shape of string-prefix "same-origin" check.

### Evidence

Verified directly against Node's `URL` (same WHATWG implementation browsers use):

```
$ node -e 'console.log(new URL("/\\evil.com/phish", "https://blackouttrades.com/").origin)'
https://evil.com
$ node -e 'console.log("/\\evil.com/phish".startsWith("//"))'
false
```

The second line is the whole bug: the string the old guard was built to reject is exactly the
string it let through.

New regression test `src/lib/push/sw.test.ts` loads the REAL `public/sw.js` source (not a copy)
into a sandboxed `vm` context — `sw.js` is a classic, unbundled script with no `import`/`export`,
so there is nothing for a normal test module to `import`, and executing the actual shipped file is
the only way to test it without introducing a second implementation that can drift from the first
(the exact failure class `src/lib/clerk-client-cookie.ts` / `cookie-split.ts` and this file's own
new comment call out). RED on `main`: all 9 cases fail with `sw.js must define
resolveNotificationTarget at top level` (the function didn't exist before this fix — confirmed via
`git stash`). GREEN after the fix: all 9 pass, including the two that directly cover the
regression (`"/\evil.com/phish"` and `"/\\evil.com/phish"` both resolve to the `/dashboard`
fallback instead of leaking the attacker host), plus coverage for the already-correct
`"//evil.com"` case, a fully-qualified cross-origin URL, a fully-qualified same-origin URL, and
non-string/empty/unparseable input.

### Blast radius

`resolveNotificationTarget` is the **only** call site that builds the `notificationclick` target
(grep-confirmed) — there is no second copy of this logic elsewhere in the service worker. The only
other place a `url` can reach this code path is the `push` handler a few lines up
(`data.url || "/dashboard"`, from the same payload), which already flows into the same guard;
nothing else needed to change.

Exploitability requires either: (a) an admin-authorized caller of `POST /api/push/send`
deliberately setting a malicious `url`, since that route is `requireAdminApi`-gated and is the
only first-party sender of this payload today, or (b) some other actor obtaining the ability to
send an arbitrarily-shaped payload through a subscriber's push channel. Both are a materially
higher bar than a public, unauthenticated open redirect, which is why this is filed P2 rather than
P0/P1 — but the guard's own comment states an intent ("reject absolute/protocol-relative URLs")
that the code did not actually deliver, and defense-in-depth against a compromised or
misconfigured sender is exactly what a same-origin check like this exists for.

### Fix rationale

Replaced the string-prefix heuristic with actual URL parsing: resolve `raw` against
`self.location.origin` with the real `URL` constructor, then require the RESOLVED `.origin` to
equal the service worker's own origin before using any part of it. This closes every variant that
normalizes to a cross-origin reference (bare backslash, double backslash, a fully-qualified
`https://evil.com` URL) in one check, rather than adding more string patterns to reject as new
variants are found — the same "parse, don't pattern-match" principle `publishable-session.ts` and
other modules in this repo already apply to date/session-boundary checks. Deliberately left
unchanged: the `client.url.includes(target)` focus-matching loop a few lines below (a separate,
lower-severity imprecision — it can focus an already-open tab whose URL merely *contains* the
target substring rather than matching it exactly — out of scope for this fix, which is about the
cross-origin leak, not the focus-targeting heuristic).
