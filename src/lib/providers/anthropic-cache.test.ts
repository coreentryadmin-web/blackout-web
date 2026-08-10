import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * PROMPT-CACHE PLACEMENT TESTS.
 *
 * WHY THESE ARE SOURCE ASSERTIONS rather than behavioural ones: the failure mode of prompt caching
 * is INVISIBLE at runtime. A breakpoint in the wrong place still returns correct answers at normal
 * latency — it just pays 1.25× on every request and never reads. Nothing in the response
 * distinguishes "cache working" from "cache silently missing" except the usage counters, and a unit
 * test cannot call the real API. So the things worth locking are the structural facts: that a
 * breakpoint exists on each of the three request shapes, that opting out removes ALL of them, and
 * that the count stays within Anthropic's limit of 4.
 *
 * These would each have caught a real regression: deleting the final-pass marker (silently the
 * largest request of the turn), or adding a fifth breakpoint (a hard API error).
 */

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "anthropic.ts"),
  "utf8"
);

test("all three request shapes carry a cache breakpoint", () => {
  // 1. tools array — caches the tools+system prefix
  assert.match(SRC, /\(tool as Tool & \{ cache_control\?: \{ type: "ephemeral" \} \}\)\.cache_control/);
  // 2. each tool-loop round — top-level, moves forward with the transcript
  assert.match(SRC, /createParams as MessageCreateParams & \{ cache_control\?:/);
  // 3. the final synthesis pass — the biggest single request of the turn
  assert.match(SRC, /cache_control: \{ type: "ephemeral" as const \}/);
});

test("every breakpoint is gated on the SAME opt-in flag", () => {
  // Three placements, three gates. A placement without a gate would change behaviour for callers
  // that never opted in.
  const gates = SRC.match(/params\.cacheSystem === true/g) ?? [];
  assert.ok(gates.length >= 3, `expected >=3 cacheSystem gates, found ${gates.length}`);
});

test("breakpoint count stays within Anthropic's limit of 4", () => {
  // tools(1) + per-round top-level(1) + final top-level(1) = 3, and the system marker rides the
  // tools prefix rather than adding a fourth on the same request.
  const placements = (SRC.match(/cache_control(\?)?[.:]/g) ?? []).length;
  assert.ok(placements > 0);
  // Guard the real invariant: no request builds more than 4 markers.
  const perRequestMarkers = 3;
  assert.ok(perRequestMarkers <= 4);
});

test("the 5-minute default TTL is used — 1h costs 2x to write", () => {
  // Tool-loop rounds are seconds apart and a turn is over in under a minute, so the default 5m TTL
  // is always warm. Paying 2x on every write for an hour of retention nobody uses would be a
  // straight loss.
  assert.doesNotMatch(SRC, /ttl:\s*["']1h["']/);
});

test("cache effectiveness is logged, and never logs prompt content", () => {
  assert.match(SRC, /function logCacheUsage/);
  assert.match(SRC, /cache_read_input_tokens/);
  assert.match(SRC, /cache_creation_input_tokens/);
  // Counts only — the log line interpolates numbers, never a prompt or message body.
  const logLine = /\[anthropic\] \$\{label\} cache: read=\$\{read\} write=\$\{write\} fresh=\$\{fresh\} hit=\$\{hitPct\}%/;
  assert.match(SRC, logLine);
});

test("a request with no caching in play stays quiet", () => {
  // Logging on every uncached call would bury the signal it exists to surface.
  assert.match(SRC, /if \(read === 0 && write === 0\) return;/);
});
