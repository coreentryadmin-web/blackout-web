// Pure, alias-free: does a uwGet error message denote a transient upstream 5xx?
// Anchored to uwGet's `Unusual Whales <path> → <status>` message format. Kept in its
// own module so it is unit-testable under `npx tsx --test` without loading the heavy
// unusual-whales provider module.
export function isUwUpstream5xx(msg: string): boolean {
  return /→\s*5\d\d\b/.test(msg);
}
