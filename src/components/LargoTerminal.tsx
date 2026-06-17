"use client";

import { useState, useRef, useEffect } from "react";
import { queryLargo } from "@/lib/api";
import { clsx } from "clsx";

interface Message {
  role: "user" | "assistant";
  content: string;
  ts: number;
}

const SUGGESTIONS = [
  "How is SPX looking today?",
  "What are the key GEX levels to watch?",
  "Show me the top flows from this morning",
  "Is the market in a risk-on or risk-off regime?",
  "What's NVDA's flow streak looking like?",
];

export function LargoTerminal() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const sessionId = useRef(`web-${Date.now()}`);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(question?: string) {
    const q = (question ?? input).trim();
    if (!q || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: q, ts: Date.now() }]);
    setLoading(true);

    try {
      const { answer } = await queryLargo(q, sessionId.current);
      setMessages((prev) => [...prev, { role: "assistant", content: answer, ts: Date.now() }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Largo is unavailable — check back during market hours.", ts: Date.now() },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex flex-col flex-1 bg-[#080808] border border-surface-3 rounded-sm overflow-hidden" style={{ minHeight: 560 }}>
      {/* Terminal bar */}
      <div className="bg-surface-2 px-4 py-3 flex items-center gap-2 border-b border-surface-3 shrink-0">
        <div className="w-2.5 h-2.5 rounded-full bg-surface-4" />
        <div className="w-2.5 h-2.5 rounded-full bg-surface-4" />
        <div className="w-2.5 h-2.5 rounded-full bg-surface-4" />
        <span className="ml-3 text-[10px] tracking-[3px] uppercase text-text-muted font-mono">
          Largo — BlackOut AI Desk
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] text-bull">
          <span className="w-1.5 h-1.5 rounded-full bg-bull animate-pulse" />
          Online
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 font-mono text-[13px]">
        {messages.length === 0 && (
          <div className="space-y-6">
            <div>
              <p className="text-text-muted leading-relaxed">
                <span className="text-white">Largo</span> is BlackOut&apos;s AI trading desk. Ask me anything about
                SPX structure, options flow, sector rotation, or specific tickers.
              </p>
            </div>
            <div>
              <p className="text-[10px] tracking-[2px] uppercase text-surface-4 mb-3">Suggestions</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-[11px] px-3 py-2 border border-surface-3 text-text-muted hover:border-surface-4 hover:text-text-secondary transition-colors text-left"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.ts} className={clsx("flex gap-3", m.role === "user" ? "flex-row-reverse" : "flex-row")}>
            <div className={clsx("text-[10px] tracking-[1px] uppercase shrink-0 mt-1", m.role === "user" ? "text-surface-4" : "text-text-muted")}>
              {m.role === "user" ? "you" : "largo"}
            </div>
            <div
              className={clsx(
                "max-w-[85%] text-[13px] leading-relaxed whitespace-pre-wrap",
                m.role === "user" ? "text-text-secondary" : "text-text-primary"
              )}
            >
              {m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="text-[10px] tracking-[1px] uppercase text-text-muted shrink-0 mt-1">largo</div>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-surface-2 p-4 shrink-0">
        <div className="flex items-end gap-3">
          <span className="font-mono text-[13px] text-surface-4 mb-2.5">›</span>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask Largo anything about the market…"
            rows={1}
            className="flex-1 bg-transparent font-mono text-[13px] text-text-primary placeholder:text-surface-4 focus:outline-none resize-none leading-relaxed"
            style={{ minHeight: 24, maxHeight: 120 }}
            disabled={loading}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || loading}
            className="shrink-0 px-4 py-2 text-[10px] tracking-[2px] uppercase bg-white text-black font-bold disabled:opacity-30 hover:bg-white/90 transition-opacity"
          >
            Send
          </button>
        </div>
        <p className="text-[10px] text-surface-4 mt-2 font-mono">↵ Enter to send · Shift+Enter for newline</p>
      </div>
    </div>
  );
}
