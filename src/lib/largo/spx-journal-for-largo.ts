import { fetchUserJournal } from "@/lib/journal/journal-store";
import { etStamp } from "@/lib/largo/temporal/bar-session-date";

export async function spxJournalForLargo(userId: string, openPlayId?: number) {
  if (!userId || userId === "default") {
    return {
      available: false,
      error: "user_session_required",
      note: "SPX journal entries are per-member — only available when the member is signed in.",
      entries: {},
    };
  }

  const entries = await fetchUserJournal(userId);
  const keys = Object.keys(entries);

  if (openPlayId != null && Number.isFinite(openPlayId) && openPlayId > 0) {
    const entry = entries[String(openPlayId)] ?? null;
    return {
      available: true,
      as_of: new Date().toISOString(),
      as_of_et: etStamp(Date.now()),
      open_play_id: openPlayId,
      entry,
      total_entries: keys.length,
    };
  }

  return {
    available: true,
    as_of: new Date().toISOString(),
    as_of_et: etStamp(Date.now()),
    total_entries: keys.length,
    entries,
  };
}
