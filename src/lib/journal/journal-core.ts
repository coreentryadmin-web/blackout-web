// Pure, alias-free trade-journal core. No @/ imports so tsx --test resolves it
// directly and no React/DB/Next coupling. Annotation-only: this module never
// touches any money-path data — it only models per-user notes keyed by play id.

export type JournalEntry = {
  /** Stable key: spx_play_outcomes.open_play_id of the play being annotated. */
  open_play_id: number;
  /** Free-text note. Trimmed; empty string means "no note" (delete). */
  note: string;
  /** Optional lightweight tags (e.g. ["chased","good-entry"]). */
  tags: string[];
  /** ISO timestamp of last edit. */
  updated_at: string;
};

export type JournalMap = Record<string, JournalEntry>;

export const JOURNAL_NOTE_MAX = 2000;
export const JOURNAL_TAG_MAX = 24;
export const JOURNAL_TAGS_MAX = 12;

/** localStorage key, namespaced per Clerk user so notes never bleed across accounts. */
export function journalStorageKey(userId: string): string {
  return `blackout:trade-journal:${userId}`;
}

/** Normalize a single tag: trim, collapse spaces, cap length. Drops empties. */
export function normalizeTag(raw: string): string {
  return String(raw).trim().replace(/\s+/g, " ").slice(0, JOURNAL_TAG_MAX);
}

/** Parse a comma/space separated tag string into a clean, de-duped, capped list. */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw).split(/[,\n]/)) {
    const t = normalizeTag(part);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= JOURNAL_TAGS_MAX) break;
  }
  return out;
}

/** Sanitize note text: trim and hard-cap to JOURNAL_NOTE_MAX. */
export function sanitizeNote(raw: string): string {
  return String(raw ?? "").slice(0, JOURNAL_NOTE_MAX).trim();
}

/** True when an entry carries no content and should be removed rather than stored. */
export function isEmptyEntry(note: string, tags: string[]): boolean {
  return sanitizeNote(note).length === 0 && tags.length === 0;
}

/**
 * Apply an edit to a journal map immutably. Returns a NEW map.
 * Empty note + empty tags deletes the entry (keeps storage tidy).
 */
export function upsertEntry(
  map: JournalMap,
  openPlayId: number,
  note: string,
  tagsRaw: string | string[],
  now: string = new Date().toISOString()
): JournalMap {
  const key = String(openPlayId);
  const cleanNote = sanitizeNote(note);
  const tags = Array.isArray(tagsRaw) ? parseTags(tagsRaw.join(",")) : parseTags(tagsRaw);
  const next: JournalMap = { ...map };
  if (isEmptyEntry(cleanNote, tags)) {
    delete next[key];
    return next;
  }
  next[key] = { open_play_id: openPlayId, note: cleanNote, tags, updated_at: now };
  return next;
}

/** Read a single entry (or null) by play id. */
export function getEntry(map: JournalMap, openPlayId: number): JournalEntry | null {
  return map[String(openPlayId)] ?? null;
}

/** Parse stored JSON → JournalMap, tolerating corruption (returns {} on any error). */
export function parseJournalMap(raw: string | null | undefined): JournalMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: JournalMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const e = v as Record<string, unknown>;
      const openId = Number(e.open_play_id ?? k);
      if (!Number.isFinite(openId)) continue;
      const note = sanitizeNote(typeof e.note === "string" ? e.note : "");
      const tags = Array.isArray(e.tags) ? parseTags((e.tags as unknown[]).map(String).join(",")) : [];
      if (isEmptyEntry(note, tags)) continue;
      out[String(openId)] = {
        open_play_id: openId,
        note,
        tags,
        updated_at: typeof e.updated_at === "string" ? e.updated_at : new Date(0).toISOString(),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** Serialize a JournalMap for storage. */
export function serializeJournalMap(map: JournalMap): string {
  return JSON.stringify(map);
}
