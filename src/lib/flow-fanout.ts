// Pure, zero-dependency fan-out predicate for flow alerts. Lives in its own file
// so it can be unit-tested under `npx tsx --test` without pulling in the @/lib/*
// alias chain (db/pg, flow-events, unusual-whales) that importing flow-persist.ts
// would drag in.
//
// inserted     - the INSERT actually created a new row (ON CONFLICT DO NOTHING
//                returned a row). false = a genuine duplicate.
// usingDb      - a database is configured. When false there is nothing to dedup
//                against, so always publish.
// insertFailed - the INSERT threw (transient DB error), so `inserted` is an
//                unreliable false. Publish anyway: only a real ON-CONFLICT
//                duplicate (returns false WITHOUT throwing) should be suppressed.
export function shouldFanOut(
  inserted: boolean,
  usingDb: boolean,
  insertFailed = false
): boolean {
  return inserted || !usingDb || insertFailed;
}
