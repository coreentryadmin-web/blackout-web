> **kind:** FINDING

## play-brief-intel short vol ratio test date bomb — FIXED

| **Status** | Fixed in `fix/play-brief-intel-test-readMs` |
| **CI** | verify run `41912724499` on `232c0459` |

**What was broken:** `catalystsSection` short-vol audit test used `as_of: 2026-09-05` with default `Date.now()` readMs. After Nov 2026, `fundamentalsAncient()` omits the block → `catalystsSection` returns null → `assert.ok(section)` fails verify.

**What changed:** Anchor `readMs` to 2026-09-06 so fundamentals stay within the ancient ceiling; pass as `SwingPlayBriefContext` second arg (production path).
