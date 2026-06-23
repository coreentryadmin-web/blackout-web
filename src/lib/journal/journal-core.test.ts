// Run: npx tsx --test src/lib/journal/journal-core.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  upsertEntry,
  getEntry,
  parseTags,
  sanitizeNote,
  parseJournalMap,
  serializeJournalMap,
  isEmptyEntry,
  JOURNAL_NOTE_MAX,
  JOURNAL_TAGS_MAX,
  type JournalMap,
} from "./journal-core.ts";

test("upsert then read round-trips", () => {
  const m = upsertEntry({}, 101, "chased the entry", "fomo, late", "2026-06-22T00:00:00.000Z");
  const e = getEntry(m, 101);
  assert.equal(e?.note, "chased the entry");
  assert.deepEqual(e?.tags, ["fomo", "late"]);
  assert.equal(e?.open_play_id, 101);
});

test("upsert is immutable", () => {
  const a: JournalMap = {};
  const b = upsertEntry(a, 1, "x", "");
  assert.notEqual(a, b);
  assert.equal(Object.keys(a).length, 0);
});

test("empty note + empty tags deletes the entry", () => {
  let m = upsertEntry({}, 5, "note", "tag");
  assert.ok(getEntry(m, 5));
  m = upsertEntry(m, 5, "   ", "");
  assert.equal(getEntry(m, 5), null);
});

test("tags are trimmed, de-duped, capped", () => {
  const tags = parseTags("A, a , b,  b ,c");
  assert.deepEqual(tags, ["A", "b", "c"]);
  const many = parseTags(Array.from({ length: 30 }, (_, i) => `t${i}`).join(","));
  assert.equal(many.length, JOURNAL_TAGS_MAX);
});

test("note is capped to max length", () => {
  const big = "x".repeat(JOURNAL_NOTE_MAX + 500);
  assert.equal(sanitizeNote(big).length, JOURNAL_NOTE_MAX);
});

test("isEmptyEntry", () => {
  assert.equal(isEmptyEntry("  ", []), true);
  assert.equal(isEmptyEntry("hi", []), false);
  assert.equal(isEmptyEntry("", ["t"]), false);
});

test("parse tolerates corrupt JSON", () => {
  assert.deepEqual(parseJournalMap("{not json"), {});
  assert.deepEqual(parseJournalMap(null), {});
  assert.deepEqual(parseJournalMap("[1,2,3]"), {});
});

test("parse/serialize round-trip drops empties", () => {
  const m = upsertEntry({}, 9, "keep", "a");
  const round = parseJournalMap(serializeJournalMap(m));
  assert.deepEqual(round, m);
  // entry with no content is filtered on parse
  const dirty = JSON.stringify({ "7": { open_play_id: 7, note: "", tags: [] } });
  assert.deepEqual(parseJournalMap(dirty), {});
});
