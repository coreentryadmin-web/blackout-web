"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { prepareImage, ImageRejected, type PreparedImage } from "@/features/largo/lib/prepare-image";
import { queryLargoStream, fetchLargoSession, LargoStreamAborted } from "@/lib/api";
import { LARGO_SESSION_KEY } from "@/lib/session-cache";
import { isIosAppShell } from "@/lib/ios-app-shell";
import { largoStreamErrorMessage } from "@/lib/largo-stream-errors";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import {
  conversationTitle,
  loadConversations,
  removeConversation,
  saveConversations,
  upsertConversation,
  type LargoConversation,
} from "@/features/largo/conversation-history";

export type LargoMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools?: string[];
  /**
   * Populated structured answer from synthesis (#59), when the query API returns
   * one. Preferred over the markdown shim by LargoAnswerMessage; absent on trivial
   * answers, historical (rehydrated) turns, and until the server PR deploys.
   */
  envelope?: BieAnswerEnvelope | null;
  /**
   * The persisted turn this answer came from, and the server's auto-render directive.
   *
   * Both are carried on the MESSAGE rather than in a single "latest turn" slot because the
   * transcript keeps every turn on screen: a card action on the third answer must rebuild the
   * third turn, not whichever one happened to arrive last.
   */
  turnId?: number | null;
  visual?: { size: "x_landscape" | "x_portrait" | "square" | "story" } | null;
  /** Object/data URLs for images sent with a user turn, rendered as thumbnails in the bubble. */
  images?: string[];
};

const TOOL_LABEL: Record<string, string> = {
  blackout_intelligence: "BLACKOUT Intelligence",
  live_feed_capture: "live desk feed",
  get_spx_structure: "SPX desk",
  get_spx_confluence: "confluence engine",
  get_spx_play: "SPX play",
  get_gex: "GEX map",
  get_positioning: "dealer positioning",
  get_greek_flow: "dealer greek flow",
  get_options_flow: "options flow",
  get_global_flow: "market flow",
  get_flow_tape: "HELIX flow tape",
  get_dark_pool: "dark pool",
  get_market_context: "market context",
  get_market_breadth: "market breadth",
  get_technicals: "technicals",
  get_quote: "live quote",
  get_nbbo: "NBBO",
  get_news: "news",
  get_web_search: "web search",
  get_nighthawk_edition: "Night Hawk",
  get_zerodte_plays: "0DTE Command plays",
  get_greeks: "greeks",
  get_max_pain: "max pain",
  get_iv_stats: "IV rank",
  get_options_chain: "options chain",
  get_open_plays: "open plays",
  get_lotto_live: "lotto play",
  get_earnings: "earnings",
  get_analyst_ratings: "analyst ratings",
  get_catalysts: "catalysts",
  get_congress_trades: "congress trades",
  get_predictions_consensus: "predictions",
};

export function largoToolLabel(name: string): string {
  return TOOL_LABEL[name] ?? name.replace(/^get_/, "").replace(/_/g, " ");
}

export const LARGO_WELCOME: LargoMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Largo online. Ask anything specific — SPX levels, a ticker, flow, news. I pull live data on every question and keep the thread.",
};

/** Compact-panel chips. Same intent as LARGO_EXAMPLE_PROMPTS above — cross-product first. */
export const LARGO_SUGGESTIONS = [
  "What matters now across the platform?",
  "Why is SPX moving right now?",
  "Where do the systems disagree?",
  "What changed in the last 30 minutes?",
] as const;

/**
 * Empty-state showcase prompts — the first impression of what Largo IS.
 *
 * The previous set ("SPX trend?", "NVDA wall dynamics") was accurate and badly chosen: every one
 * of them is a single-product lookup, so the terminal introduced itself as a nicer ticker search.
 * Anything with a search box can plausibly answer them, which makes them the worst possible
 * advertisement for the one thing Largo can do that nothing else here can.
 *
 * These four are picked for what they REQUIRE, not what they mention. Not one can be answered from
 * a single product:
 *   - ranking demands a comparable view across every board at once;
 *   - synthesis demands four engines reconciled into one causal read;
 *   - disagreement is only visible if you hold several systems side by side — and it is the
 *     question a member cannot answer for themselves at any speed;
 *   - "what changed" demands a temporal diff across flow, gamma, levels, regime and open plays,
 *     which no single panel keeps.
 *
 * Phrased as the question a trader actually has, not as a query. "Why is SPX moving" is what
 * someone thinks at 10:04; "SPX trend?" is what they type when they have given up on being
 * understood.
 */
export const LARGO_EXAMPLE_PROMPTS: { label: string; hint: string }[] = [
  {
    label: "What matters now?",
    hint: "Ranks live opportunities across every board on the platform",
  },
  {
    label: "Why is SPX moving?",
    hint: "Helix flow + Thermal gamma + Vector structure + Slayer, reconciled",
  },
  {
    label: "Where do the systems disagree?",
    hint: "Conflicting signals across BlackOut — and which side has the evidence",
  },
  {
    label: "What changed in the last 30 minutes?",
    hint: "Flow, gamma, levels, regime and active plays — the temporal diff",
  },
];

function upsertAssistantMessage(
  messages: LargoMessage[],
  assistantId: string,
  patch: Partial<LargoMessage> & { content: string }
): LargoMessage[] {
  const existing = messages.find((msg) => msg.id === assistantId);
  if (!existing) {
    return [...messages, { id: assistantId, role: "assistant", ...patch }];
  }
  return messages.map((msg) => (msg.id === assistantId ? { ...msg, ...patch } : msg));
}

function firstUserQuestion(messages: LargoMessage[]): string {
  return messages.find((m) => m.role === "user")?.content ?? "";
}

/** Mirrors MAX_IMAGES_PER_TURN on the server; the server is still the authority that enforces it. */
const MAX_COMPOSER_IMAGES = 4;

function newSessionId(): string {
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Shared Largo chat session + streaming (web desk + native mobile). */
export function useLargoChat() {
  const [messages, setMessages] = useState<LargoMessage[]>([LARGO_WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [followups, setFollowups] = useState<string[]>([]);
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [awaitingFirstToken, setAwaitingFirstToken] = useState(false);
  const [conversations, setConversations] = useState<LargoConversation[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [canRegenerate, setCanRegenerate] = useState(false);
  const sessionId = useRef("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const msgId = useRef(1);
  const streamBufRef = useRef("");
  const streamFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // First question of the active thread — the stable label for the history index.
  const threadTitleRef = useRef("");
  // Last user question, replayed by regenerate().
  const lastQueryRef = useRef("");
  // Images staged in the composer for the NEXT question. Held in a ref as well as state because
  // runQuery reads them at send time and a stale closure would silently send the previous set.
  const [attachments, setAttachments] = useState<PreparedImage[]>([]);
  const attachmentsRef = useRef<PreparedImage[]>([]);
  attachmentsRef.current = attachments;
  const [attachError, setAttachError] = useState<string | null>(null);
  // The instrument the SERVER resolved for the most recent answer — the contextual rail's only
  // source. Kept across follow-ups so the rail persists through a chain about the same name.
  const [activeTicker, setActiveTicker] = useState<string | null>(null);

  const setSession = useCallback((id: string) => {
    sessionId.current = id;
    setActiveSessionId(id);
    if (typeof window !== "undefined") sessionStorage.setItem(LARGO_SESSION_KEY, id);
  }, []);

  useEffect(() => {
    setConversations(loadConversations());
  }, []);

  useEffect(() => {
    const stored =
      typeof window !== "undefined" ? sessionStorage.getItem(LARGO_SESSION_KEY) : null;
    const initial = stored || newSessionId();
    setSession(initial);

    fetchLargoSession(initial)
      .then((data) => {
        if (data.session_id) setSession(data.session_id);
        if (data.messages?.length) {
          const hydratedMsgs = data.messages.map((m) => ({
            id: `m-${m.id}`,
            role: m.role,
            content: m.content,
            tools: m.tools_used?.length ? m.tools_used : undefined,
          }));
          setMessages(hydratedMsgs);
          threadTitleRef.current = firstUserQuestion(hydratedMsgs);
          setCanRegenerate(
            hydratedMsgs.some((m) => m.role === "assistant" && m.id !== "welcome")
          );
        }
      })
      .catch(() => {
        /* keep welcome */
      })
      .finally(() => setHydrated(true));
  }, [setSession]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q?.trim()) setInput(q.trim().slice(0, 500));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, activeTools]);

  const recordConversation = useCallback((id: string, title: string, drop?: string) => {
    setConversations((prev) => {
      let next = prev;
      // A provisional id may differ from the server's authoritative session_id;
      // drop the stale provisional entry so the thread appears once.
      if (drop && drop !== id) next = removeConversation(next, drop);
      next = upsertConversation(next, {
        id,
        title: conversationTitle(title),
        updatedAt: Date.now(),
      });
      saveConversations(next);
      return next;
    });
  }, []);

  const runQuery = useCallback(
    async (rawQ: string, opts?: { regenerate?: boolean }) => {
      const q = rawQ.trim();
      // Attachments are captured ONCE, here, and cleared immediately. A chart pasted while the
      // previous answer was still streaming must not ride along on the next question too.
      const staged = opts?.regenerate ? [] : attachmentsRef.current;
      // An image on its own is a complete question — pasting a chart into an empty box and hitting
      // send means "what do you make of this?", and the server supplies exactly that text.
      if ((!q && staged.length === 0) || loading || !hydrated) return;
      if (staged.length) {
        setAttachments([]);
        setAttachError(null);
      }

      const regenerate = opts?.regenerate ?? false;
      setInput("");
      setFollowups([]);
      setActiveTools([]);
      setStatusMessage(null);
      setAwaitingFirstToken(true);
      setCanRegenerate(false);
      // Label an image-only turn so the history index and regenerate() are not left blank.
      const label = q || (staged.length ? "Chart upload" : "");
      lastQueryRef.current = q;

      if (!threadTitleRef.current) threadTitleRef.current = label;

      if (!regenerate) {
        const userId = `u-${++msgId.current}`;
        setMessages((m) => [
          ...m.filter((x) => x.id !== "welcome"),
          {
            id: userId,
            role: "user",
            content: q,
            images: staged.length ? staged.map((a) => a.previewUrl) : undefined,
          },
        ]);
      } else {
        // Replace the previous answer in place: drop the trailing assistant turn.
        setMessages((m) => {
          const lastAssistant = [...m].reverse().find((x) => x.role === "assistant");
          return lastAssistant ? m.filter((x) => x.id !== lastAssistant.id) : m;
        });
      }

      setLoading(true);
      setStreaming(false);

      const assistantId = `a-${++msgId.current}`;
      const provisionalSid = sessionId.current;

      streamBufRef.current = "";
      if (streamFlushRef.current) {
        clearTimeout(streamFlushRef.current);
        streamFlushRef.current = null;
      }

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await queryLargoStream(
          q,
          sessionId.current,
          (token) => {
            streamBufRef.current += token;
            setAwaitingFirstToken(false);
            setStreaming(true);
            if (!streamFlushRef.current) {
              streamFlushRef.current = setTimeout(() => {
                streamFlushRef.current = null;
                const content = streamBufRef.current;
                setMessages((m) => upsertAssistantMessage(m, assistantId, { content }));
              }, 50);
            }
          },
          (toolName) => {
            const label = largoToolLabel(toolName);
            setActiveTools((prev) => (prev.includes(label) ? prev : [...prev, label]));
          },
          controller.signal,
          (message) => setStatusMessage(message),
          () => {
            // The round that just streamed ended in tool calls, so what it wrote was the model
            // narrating its plan, not answering. Clear the buffer AND the rendered bubble —
            // clearing only the buffer would leave the last flushed chatter on screen until the
            // next token overwrote it.
            streamBufRef.current = "";
            if (streamFlushRef.current) {
              clearTimeout(streamFlushRef.current);
              streamFlushRef.current = null;
            }
            setMessages((m) => upsertAssistantMessage(m, assistantId, { content: "" }));
          },
          staged.map((a) => ({ data: a.data, media_type: a.media_type }))
        );
        setSession(res.session_id);
        setMessages((m) =>
          upsertAssistantMessage(m, assistantId, {
            content: res.answer,
            tools: res.tools_used,
            // Prefer the real structured envelope when synthesis (#59) returns one;
            // null keeps LargoAnswerMessage on the markdown shim (no regression).
            envelope: res.envelope ?? null,
            // Independent of `envelope`: an answer that missed the section contract still has a
            // persisted turn, and that turn is all a card needs. Gating these on the envelope is
            // what left "create an image of todays 0DTE results" with nothing to render from.
            turnId: res.turn_id ?? null,
            visual: res.visual ? { size: res.visual.size } : null,
          })
        );
        // Only overwrite when the server actually resolved one: a follow-up that names no ticker
        // ("and the put side?") must keep the rail on the instrument under discussion, not blank it.
        if (res.ticker) setActiveTicker(res.ticker);
        setFollowups(Array.isArray(res.followups) ? res.followups.slice(0, 3) : []);
        setCanRegenerate(true);
        recordConversation(res.session_id, threadTitleRef.current || label, provisionalSid);
      } catch (err) {
        if (err instanceof LargoStreamAborted) {
          // User pressed Stop. Keep whatever streamed so far; if nothing did,
          // drop the empty assistant bubble rather than showing an error.
          const partial = streamBufRef.current;
          if (partial.trim()) {
            setMessages((m) =>
              upsertAssistantMessage(m, assistantId, {
                content: `${partial}\n\n_Stopped._`,
              })
            );
            setCanRegenerate(true);
          } else {
            setMessages((m) => m.filter((x) => x.id !== assistantId));
          }
        } else {
          const content = largoStreamErrorMessage(err instanceof Error ? err.message : "", {
            ios: isIosAppShell(),
          });
          setMessages((m) => upsertAssistantMessage(m, assistantId, { content }));
          setCanRegenerate(true);
        }
      } finally {
        if (streamFlushRef.current) {
          clearTimeout(streamFlushRef.current);
          streamFlushRef.current = null;
        }
        abortRef.current = null;
        setLoading(false);
        setStreaming(false);
        setActiveTools([]);
        setStatusMessage(null);
        setAwaitingFirstToken(false);
      }
    },
    [loading, hydrated, setSession, recordConversation]
  );

  /**
   * Stage image files from the file picker, a paste, or a drop.
   *
   * Rejections are surfaced, never swallowed: a member whose upload silently failed goes on to ask
   * about a chart Largo cannot see, and gets a fluent answer about nothing.
   */
  const addAttachments = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    setAttachError(null);
    for (const file of list) {
      // Read against the ref, not the state variable: this loop awaits between iterations, so the
      // captured `attachments` value would be stale by the second file and the cap would not hold.
      if (attachmentsRef.current.length >= MAX_COMPOSER_IMAGES) {
        setAttachError(`Up to ${MAX_COMPOSER_IMAGES} images per question.`);
        return;
      }
      try {
        const prepared = await prepareImage(file);
        attachmentsRef.current = [...attachmentsRef.current, prepared];
        setAttachments(attachmentsRef.current);
      } catch (err) {
        setAttachError(
          err instanceof ImageRejected ? err.message : "That image could not be attached."
        );
        return;
      }
    }
  }, []);

  /** Drop a staged image, releasing its object URL so the blob can be collected. */
  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => {
      const target = prev[index];
      if (target?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(target.previewUrl);
      const next = prev.filter((_, i) => i !== index);
      attachmentsRef.current = next;
      return next;
    });
    setAttachError(null);
  }, []);

  /** Abort the in-flight turn; partial streamed content is preserved. */
  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** Re-run the last question, replacing the previous answer in place. */
  const regenerate = useCallback(() => {
    if (loading || !lastQueryRef.current) return;
    void runQuery(lastQueryRef.current, { regenerate: true });
  }, [loading, runQuery]);

  /** Start a fresh thread (new server session on the next question). */
  const newConversation = useCallback(() => {
    if (loading) return;
    setSession(newSessionId());
    setMessages([LARGO_WELCOME]);
    setFollowups([]);
    setInput("");
    setCanRegenerate(false);
    threadTitleRef.current = "";
    lastQueryRef.current = "";
    setActiveTicker(null); // a new thread is a new subject
  }, [loading, setSession]);

  /** Re-open a stored conversation by session id. */
  const switchConversation = useCallback(
    async (id: string) => {
      if (loading || id === sessionId.current) return;
      setSession(id);
      setFollowups([]);
      setInput("");
      setHydrated(false);
      try {
        const data = await fetchLargoSession(id);
        if (data.session_id) setSession(data.session_id);
        const msgs: LargoMessage[] = data.messages?.length
          ? data.messages.map((m) => ({
              id: `m-${m.id}`,
              role: m.role,
              content: m.content,
              tools: m.tools_used?.length ? m.tools_used : undefined,
            }))
          : [LARGO_WELCOME];
        setMessages(msgs);
        threadTitleRef.current = firstUserQuestion(msgs);
        setCanRegenerate(msgs.some((m) => m.role === "assistant" && m.id !== "welcome"));
      } catch {
        setMessages([LARGO_WELCOME]);
      } finally {
        setHydrated(true);
      }
    },
    [loading, setSession]
  );

  const isFresh = messages.length === 1 && messages[0]?.id === "welcome";

  return {
    messages,
    input,
    setInput,
    loading,
    streaming,
    hydrated,
    followups,
    activeTools,
    statusMessage,
    awaitingFirstToken,
    conversations,
    activeSessionId,
    canRegenerate,
    bottomRef,
    runQuery,
    activeTicker,
    attachments,
    attachError,
    addAttachments,
    removeAttachment,
    cancel,
    regenerate,
    newConversation,
    switchConversation,
    isFresh,
  };
}
