// Pure, alias-free dedup key for the unified tape. EXCLUDES premium: the same
// print (kind|time|label) can re-arrive with a refreshed premium; including premium
// let re-prints survive as duplicates. Both merge loops iterate [...incoming, ...prev]
// keeping first-seen, so the latest premium is retained automatically once premium is
// out of the key.
export function tapeDedupKey(t: { kind: string; time: string; label: string }): string {
  return `${t.kind}|${t.time}|${t.label}`;
}
