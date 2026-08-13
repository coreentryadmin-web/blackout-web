import { dbClient, dbConfigured, dbQuery } from "@/lib/db";
import type { AnthropicMessage } from "@/lib/providers/anthropic";
import {
  extractWatchlistFromText,
  mergeSessionMetadata,
  type LargoSessionMetadata,
} from "@/lib/largo/session-metadata";

export type LargoStoredMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  tools_used: string[];
  created_at: string;
};

const MAX_MESSAGES_LOAD = 28;
/** Max rows stored per session in Postgres (UI/Claude still use last MAX_MESSAGES_LOAD). */
const MAX_MESSAGES_STORED = 50;
const MAX_MEMORY_SESSIONS = 500;
const DEFAULT_RETENTION_DAYS = 7;
const memorySessions = new Map<string, AnthropicMessage[]>();
const memorySessionOwners = new Map<string, string>();

function touchMemorySession(sessionId: string, hist: AnthropicMessage[]): void {
  memorySessions.delete(sessionId);
  memorySessions.set(sessionId, hist);
  while (memorySessions.size > MAX_MEMORY_SESSIONS) {
    const oldest = memorySessions.keys().next().value;
    if (oldest) memorySessions.delete(oldest);
  }
}

export async function ensureLargoSession(sessionId: string, userId: string): Promise<void> {
  if (!dbConfigured()) return;
  // Atomic upsert: collapses check+insert+touch into one statement so two concurrent
  // requests for a brand-new session id can't both pass an existence check and race the
  // INSERT (the loser previously hit a 23505 primary-key violation surfaced as a 500).
  // ON CONFLICT only touches updated_at (title intentionally left unset on insert, matching
  // prior behavior); RETURNING user_id is the existing owner on conflict, so we assert
  // ownership against it exactly as before. Do NOT add user_id to the DO UPDATE SET — that
  // would let a second user silently hijack someone else's session.
  const upserted = await dbQuery<{ user_id: string }>(
    `INSERT INTO largo_sessions (id, user_id, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET updated_at = NOW()
     RETURNING user_id`,
    [sessionId, userId]
  );
  if (upserted.rows[0]?.user_id !== userId) {
    throw new Error("Largo session not found");
  }
}

export async function fetchLargoSessionMetadata(
  sessionId: string,
  userId: string
): Promise<LargoSessionMetadata> {
  if (!dbConfigured()) return {};
  if (!(await sessionOwnedByUser(sessionId, userId))) return {};
  const res = await dbQuery<{ metadata: LargoSessionMetadata | null }>(
    `SELECT metadata FROM largo_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );
  const raw = res.rows[0]?.metadata;
  return raw && typeof raw === "object" ? (raw as LargoSessionMetadata) : {};
}

export async function updateLargoSessionMetadata(
  sessionId: string,
  userId: string,
  patch: Partial<LargoSessionMetadata>
): Promise<LargoSessionMetadata> {
  if (!dbConfigured()) return mergeSessionMetadata({}, patch);
  await ensureLargoSession(sessionId, userId);
  const prev = await fetchLargoSessionMetadata(sessionId, userId);
  const next = mergeSessionMetadata(prev, patch);
  await dbQuery(
    `UPDATE largo_sessions SET metadata = $3::jsonb, updated_at = NOW() WHERE id = $1 AND user_id = $2`,
    [sessionId, userId, JSON.stringify(next)]
  );
  return next;
}

/** If the question asks to remember tickers, persist to session metadata. */
export async function maybePersistWatchlistFromQuestion(
  sessionId: string,
  userId: string,
  question: string
): Promise<LargoSessionMetadata> {
  const list = extractWatchlistFromText(question);
  if (!list?.length) return fetchLargoSessionMetadata(sessionId, userId);
  return updateLargoSessionMetadata(sessionId, userId, { watchlist: list });
}

export async function sessionOwnedByUser(sessionId: string, userId: string): Promise<boolean> {
  if (!dbConfigured()) return true;
  const res = await dbQuery<{ ok: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM largo_sessions WHERE id = $1 AND user_id = $2) AS ok`,
    [sessionId, userId]
  );
  return Boolean(res.rows[0]?.ok);
}

export async function fetchLargoHistory(
  sessionId: string,
  userId: string
): Promise<AnthropicMessage[]> {
  if (!dbConfigured()) {
    const owner = memorySessionOwners.get(sessionId);
    if (owner !== undefined && owner !== userId) return [];
    return memorySessions.get(sessionId) ?? [];
  }

  if (!(await sessionOwnedByUser(sessionId, userId))) {
    return [];
  }

  const res = await dbQuery<{ role: string; content: string }>(
    `SELECT role, content
     FROM largo_messages
     WHERE session_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [sessionId, MAX_MESSAGES_LOAD]
  );

  // id tiebreaker keeps same-millisecond user/assistant rows in insert order
  // after reverse() — without it ties replayed out of order (LARGO-2).
  return res.rows.reverse().map((r) => ({
    role: r.role,
    content: r.content,
  }));
}

export type PreviousUserTurn = { content: string; askedAtMs: number };

/**
 * The member's PREVIOUS question in this session, with when they asked it.
 *
 * Exists because `fetchLargoHistory` deliberately projects only `role`/`content` — that is the
 * Anthropic message shape and adding a field to it would leak a wire format into the model
 * transcript. But "what changed since I last asked" is exactly answerable and the answer lives in
 * this column: without the timestamp the temporal layer builds an unbounded window and Largo has
 * to decline a question it could have answered precisely.
 *
 * Safe to call before the current turn is persisted — the current question is written only AFTER
 * the assistant turn completes (see the LARGO-3 note in largo-terminal), so the newest user row
 * here is genuinely the PREVIOUS one.
 *
 * Fails soft: returns null when the DB is absent or the row carries no usable timestamp. A missing
 * start is reported to the model as missing; it is never guessed.
 */
export async function fetchPreviousUserTurn(
  sessionId: string,
  userId: string
): Promise<PreviousUserTurn | null> {
  if (!dbConfigured()) return null;
  if (!(await sessionOwnedByUser(sessionId, userId))) return null;
  const res = await dbQuery<{ content: string; created_at: Date }>(
    `SELECT content, created_at
     FROM largo_messages
     WHERE session_id = $1 AND role = 'user'
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [sessionId]
  );
  const row = res.rows[0];
  if (!row) return null;
  const askedAtMs = new Date(row.created_at).getTime();
  if (!Number.isFinite(askedAtMs)) return null;
  return { content: row.content, askedAtMs };
}

export async function fetchLargoMessagesPublic(
  sessionId: string,
  userId: string
): Promise<LargoStoredMessage[]> {
  if (!dbConfigured()) {
    // Owner check parity with fetchLargoHistory — without it, a premium user
    // could read another user's in-memory conversation in no-DB mode (LARGO-10).
    const owner = memorySessionOwners.get(sessionId);
    if (owner !== undefined && owner !== userId) return [];
    const rows = memorySessions.get(sessionId) ?? [];
    return rows.map((m, i) => ({
      id: i + 1,
      role: m.role as "user" | "assistant",
      content: typeof m.content === "string" ? m.content : "",
      tools_used: [],
      created_at: new Date().toISOString(),
    }));
  }

  if (!(await sessionOwnedByUser(sessionId, userId))) return [];

  const res = await dbQuery<{
    id: number;
    role: string;
    content: string;
    tools_used: string[] | null;
    created_at: Date;
  }>(
    `SELECT id, role, content, tools_used, created_at
     FROM largo_messages
     WHERE session_id = $1
     ORDER BY created_at ASC, id ASC
     LIMIT $2`,
    [sessionId, MAX_MESSAGES_LOAD]
  );

  return res.rows.map((r) => ({
    id: Number(r.id),
    role: r.role as "user" | "assistant",
    content: r.content,
    tools_used: Array.isArray(r.tools_used) ? r.tools_used : [],
    created_at: new Date(r.created_at).toISOString(),
  }));
}

export type RecentLargoAnswer = {
  id: number;
  content: string;
  tool_results: unknown[];
  created_at: string;
};

/**
 * Cross-user, cron-readable recent Largo ANSWERS that carry tool_results — the piece
 * largo-verifier.ts's numeric-grounding engine needed but didn't have (see that file's header
 * comment). Unlike fetchLargoMessagesPublic (requires sessionId+userId, single-session), this
 * is a bounded global read across all sessions — deliberately narrow: assistant rows only,
 * only those with a non-null tool_results. Only rows from before this column existed are
 * excluded now (NULL, pre-migration history with no grounding data to check).
 *
 * Task #166 fix: BIE-router-composed answers (largo-terminal.ts's tryBieRoute/composeBieAnswer
 * path — 0DTE plays, SPX structure, market context) used to be excluded here too, because
 * appendLargoMessage() was called for them WITHOUT a toolResults argument. That made sense only
 * on the surface ("the router doesn't call a Largo tool, so there's nothing to persist") — in
 * reality composeBieAnswer() still reads real platform state (routed.context: the SPX desk
 * snapshot, market-context payload, or 0DTE board) to build a deterministic answer, and that
 * state IS the ground truth this exact query needs. Excluding router turns meant the nightly
 * audit had ZERO coverage of the router/composer path: a regression in composeSpxStructure /
 * composeMarketContext / composeZeroDtePlays (src/lib/bie/composers.ts) that fed stale or
 * mis-mapped numbers into an answer had no independent after-the-fact detector. Fixed by having
 * largo-terminal.ts's two router call sites pass `[routed.context]` as toolResults, so router
 * turns now persist non-null tool_results and are picked up here like Claude-tool-loop turns.
 */
export async function fetchRecentLargoAnswersWithResults(limit = 50): Promise<RecentLargoAnswer[]> {
  if (!dbConfigured()) return [];
  const res = await dbQuery<{ id: number; content: string; tool_results: unknown; created_at: Date }>(
    `SELECT id, content, tool_results, created_at
     FROM largo_messages
     WHERE role = 'assistant' AND tool_results IS NOT NULL
     ORDER BY created_at DESC, id DESC
     LIMIT $1`,
    [limit]
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    content: r.content,
    tool_results: Array.isArray(r.tool_results) ? r.tool_results : [],
    created_at: new Date(r.created_at).toISOString(),
  }));
}

export type LargoTurnResults = {
  id: number;
  sessionId: string;
  question: string | null;
  answer: string;
  toolResults: unknown[];
  createdAt: string;
};

/**
 * ONE turn's persisted tool results, scoped to its OWNER.
 *
 * WHY THIS EXISTS. The visual renderer builds a card from the same `capturedResults` the written
 * answer used — that identity is what stops the graphic and the prose disagreeing. But raw tool
 * output never crosses to the browser (it is unbounded and untyped), so the client can only pass
 * back what the answer ENVELOPE carries: levels and gexShifts. Anything the envelope does not
 * carry — a ledger row, a flow tape — was unreachable, which is why TRADE_RECAP could never fire
 * from the UI. This reader closes that gap: the client sends a turn id, the server loads that
 * turn's own results, and the card is built from the full evidence surface without shipping it.
 *
 * OWNERSHIP IS ENFORCED IN THE QUERY, NOT THE CALLER. The join to `largo_sessions` on `user_id`
 * means a member cannot render a card from another member's turn even by guessing an id — and
 * `largo_messages.id` is a sequential integer, so guessing is trivial. A caller-side check would
 * be one forgotten `if` away from an IDOR on someone else's private desk questions.
 *
 * Returns null when the row does not exist, is not an assistant turn, or is not owned by
 * `userId` — deliberately the SAME answer for all three, so the endpoint cannot be used to probe
 * which turn ids exist.
 */
export async function fetchLargoTurnResults(
  messageId: number,
  userId: string
): Promise<LargoTurnResults | null> {
  if (!dbConfigured()) return null;
  if (!Number.isInteger(messageId) || messageId <= 0 || !userId) return null;
  const res = await dbQuery<{
    id: number;
    session_id: string;
    content: string;
    tool_results: unknown;
    created_at: Date;
    question: string | null;
  }>(
    `SELECT m.id,
            m.session_id,
            m.content,
            m.tool_results,
            m.created_at,
            (
              SELECT q.content
              FROM largo_messages q
              WHERE q.session_id = m.session_id
                AND q.role = 'user'
                AND q.id < m.id
              ORDER BY q.id DESC
              LIMIT 1
            ) AS question
     FROM largo_messages m
     JOIN largo_sessions s ON s.id = m.session_id
     WHERE m.id = $1
       AND m.role = 'assistant'
       AND s.user_id = $2`,
    [messageId, userId]
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    sessionId: r.session_id,
    // The question is looked up as the nearest PRECEDING user row in the same session, so a
    // replayed card can route on the same wording the answer replied to rather than requiring the
    // client to send it back (and possibly send back something different).
    question: r.question ?? null,
    answer: r.content,
    toolResults: Array.isArray(r.tool_results) ? r.tool_results : [],
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function appendLargoMessage(
  sessionId: string,
  userId: string,
  role: "user" | "assistant",
  content: string,
  toolsUsed: string[] = [],
  toolResults?: unknown[]
  /**
   * Returns the inserted row id for ASSISTANT turns, or null (no DB, empty content, or a user
   * row). The id is what lets a client later ask the server to rebuild a visual from THIS turn's
   * own tool results — see `fetchLargoTurnResults`. Returning it rather than having the caller
   * re-query avoids a "most recent row wins" lookup, which would attach the wrong evidence to a
   * card whenever a member asks a second question before acting on the first.
   */
): Promise<number | null> {
  const trimmed = content.trim();
  if (!trimmed) return null;

  if (!dbConfigured()) {
    const hist = memorySessions.get(sessionId) ?? [];
    if (!memorySessionOwners.has(sessionId)) memorySessionOwners.set(sessionId, userId);
    hist.push({ role, content: trimmed });
    if (hist.length > MAX_MESSAGES_LOAD) hist.splice(0, hist.length - MAX_MESSAGES_LOAD);
    touchMemorySession(sessionId, hist);
    return null;
  }

  await ensureLargoSession(sessionId, userId);

  const client = await dbClient();
  try {
    await client.query("BEGIN");

    // tool_results is the ground-truth data the answer was grounded in (largo-verifier.ts's
    // numeric-grounding engine) — populated for Claude-tool-loop turns (captured tool-call
    // results) AND, since task #166, BIE-router-composed turns (the composer's source payload,
    // passed in as a single-element array by largo-terminal.ts's router call sites). NULL (not
    // '[]') only for pre-migration history rows that predate this column, so a reader can still
    // distinguish "no grounding data was ever tracked for this row" from "zero tools called."
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO largo_messages (session_id, role, content, tools_used, tool_results)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
       RETURNING id`,
      [
        sessionId,
        role,
        trimmed,
        JSON.stringify(toolsUsed),
        toolResults && toolResults.length ? JSON.stringify(toolResults) : null,
      ]
    );

    await client.query(
      `DELETE FROM largo_messages
       WHERE session_id = $1
         AND id NOT IN (
           SELECT id FROM largo_messages
           WHERE session_id = $1
           ORDER BY created_at DESC, id DESC
           LIMIT $2
         )`,
      [sessionId, MAX_MESSAGES_STORED]
    );

    if (role === "user") {
      await client.query(
        `UPDATE largo_sessions
         SET updated_at = NOW(),
             title = COALESCE(title, LEFT($2, 120))
         WHERE id = $1 AND user_id = $3`,
        [sessionId, trimmed, userId]
      );
    } else {
      await client.query(
        `UPDATE largo_sessions SET updated_at = NOW() WHERE id = $1 AND user_id = $2`,
        [sessionId, userId]
      );
    }

    await client.query("COMMIT");
    // Only assistant rows are addressable as a "turn" — a user row carries no tool results and
    // nothing can be rendered from it.
    return role === "assistant" ? (Number(inserted.rows[0]?.id) || null) : null;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export function largoSessionRetentionDays(): number {
  const raw = process.env.LARGO_SESSION_RETENTION_DAYS?.trim();
  const n = raw ? Number(raw) : DEFAULT_RETENTION_DAYS;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_RETENTION_DAYS;
  return Math.min(Math.round(n), 365);
}

/** Remove Largo sessions inactive longer than retention (messages cascade). */
export async function purgeStaleLargoSessions(retentionDays = largoSessionRetentionDays()): Promise<{
  ok: boolean;
  retention_days: number;
  sessions_deleted: number;
  skipped?: boolean;
  reason?: string;
}> {
  if (!dbConfigured()) {
    return { ok: true, retention_days: retentionDays, sessions_deleted: 0, skipped: true, reason: "no_database" };
  }

  const res = await dbQuery<{ id: string }>(
    `DELETE FROM largo_sessions
     WHERE updated_at < NOW() - ($1::text || ' days')::interval
     RETURNING id`,
    [String(retentionDays)]
  );

  return {
    ok: true,
    retention_days: retentionDays,
    sessions_deleted: res.rowCount ?? res.rows.length,
  };
}
