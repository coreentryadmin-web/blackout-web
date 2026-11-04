> **kind:** FINDING

## `play-brief-intel` short-vol ratio test date-bombed past fundamentals ancient ceiling — FIXED

| | |
|---|---|
| **Symptom** | CI `verify` on `232c0459`: `catalystsSection: short vol ratio renders…` — `assert.ok(section)` falsy |
| **Root cause** | Test used fixed `as_of: "2026-09-05"`. `fundamentalsAncient()` omits fundamentals older than 60d; by 2026-11-04 the section is entirely null. |
| **Fix** | Anchor `as_of` to `Date.now() - 5d` like sibling catalystsSection tests. |
| **Status** | FIXED |
