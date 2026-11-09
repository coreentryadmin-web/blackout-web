// Client-side conversation history for the Largo terminal.
//
// WHY a separate, pure module: the terminal's "conversation history list" (BIE
// Master Spec §6 — persistent, revisitable analysis) is a frontend concern that
// must survive a page reload without waiting on a backend endpoint. The server
// keys every thread by `session_id` (see fetchLargoSession), so all we persist
// locally is a lightweight index of {id,title,updatedAt} — enough to render the
// list and re-open a thread by re-fetching it. Keeping the merge/sort/cap logic
// pure (operating on a passed-in array) makes it unit-testable with no DOM/storage.

import { truncateText } from "@/lib/truncate-text";

export type LargoConversation = {
  /** The Largo `session_id` — the key the server rehydrates a thread from. */
  id: string;
  /** First user question in the thread, used as the list label. */
  title: string;
  /** Epoch ms of the last activity; drives newest-first ordering. */
  updatedAt: number;
};

/** Cap the stored index so a heavy user never bloats localStorage. */
export const MAX_CONVERSATIONS = 24;

export const LARGO_CONVERSATIONS_KEY = "blackout:largo-conversations";

/**
 * Trim a raw question into a stable, readable list label.
 *
 * BUG FIX (round 436): this used to hard-slice at 59 chars and append "…" directly
 * (`${clean.slice(0, 59).trimEnd()}…`) — the exact duplicate of the bug `truncate-text.ts`
 * was written to fix in its three OTHER copies (headlineFromMarkdown, x-content-humanize,
 * generic-extract). This fourth copy was never migrated, so it kept both defects that
 * module's header documents: no word-boundary backup (a long word straddling char 59 is cut
 * mid-token, reading as a rendering fault) and no trailing-punctuation strip before the
 * ellipsis (a question ending "...right now," at the cut produced the list label
 * "...right now,…" — doubled punctuation, the identical artifact `truncate-text.ts`'s
 * header calls out as "flow, …"). Fixed by routing through the shared, already-hardened
 * `truncateText` instead of re-deriving the same logic a fourth time.
 */
export function conversationTitle(question: string): string {
  const clean = question.replace(/\s+/g, " ").trim();
  if (!clean) return "New conversation";
  return truncateText(clean, 60);
}

/**
 * Insert-or-update a conversation in the index. Pure: returns a new array,
 * newest-first, deduped by id, capped at MAX_CONVERSATIONS. An existing entry's
 * title is preserved (the thread's first question shouldn't change under it) but
 * its updatedAt is bumped so it floats to the top on new activity.
 */
export function upsertConversation(
  list: LargoConversation[],
  entry: LargoConversation
): LargoConversation[] {
  const existing = list.find((c) => c.id === entry.id);
  const merged: LargoConversation = existing
    ? { id: entry.id, title: existing.title || entry.title, updatedAt: entry.updatedAt }
    : entry;
  const rest = list.filter((c) => c.id !== entry.id);
  return [merged, ...rest]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS);
}

/** Remove a conversation from the index (pure). */
export function removeConversation(
  list: LargoConversation[],
  id: string
): LargoConversation[] {
  return list.filter((c) => c.id !== id);
}

/** Narrowing guard for values coming back out of localStorage. */
function isConversation(value: unknown): value is LargoConversation {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.updatedAt === "number"
  );
}

/** Read the persisted index; tolerant of absent/corrupt storage (returns []). */
export function loadConversations(): LargoConversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LARGO_CONVERSATIONS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isConversation).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/** Persist the index; swallows quota/serialization errors (best-effort UX). */
export function saveConversations(list: LargoConversation[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LARGO_CONVERSATIONS_KEY, JSON.stringify(list));
  } catch {
    /* storage full or unavailable — history is a convenience, never load-bearing */
  }
}
