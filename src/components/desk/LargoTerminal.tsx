"use client";

import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { queryLargo } from "@/lib/api";
import { DeskPanel } from "./DeskPanel";

type Message = { role: "user" | "assistant"; content: string };

export function LargoTerminal() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Largo online. Ask about tickers, flows, macro, or tonight's setups — powered by your UW + Polygon + Finnhub stack.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const sessionId = useRef(`web-${Date.now()}`);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || loading) return;

    setInput("");
    setMessages((m) => [...m, { role: "user", content: q }]);
    setLoading(true);

    try {
      const res = await queryLargo(q, sessionId.current);
      sessionId.current = res.session_id;
      setMessages((m) => [...m, { role: "assistant", content: res.answer }]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Engine unreachable. Deploy BlackOut-Uw-Alerts and set NEXT_PUBLIC_API_BASE." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <DeskPanel title="Largo Terminal" subtitle="AI desk · Claude + live data" variant="purple" glow className="min-h-[560px] flex flex-col">
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2 max-h-[420px]">
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={msg.role === "user" ? "desk-largo-user" : "desk-largo-assistant"}
            >
              <p className="text-[9px] font-mono uppercase tracking-widest text-grey-500 mb-1">
                {msg.role === "user" ? "You" : "Largo"}
              </p>
              <p className="text-sm text-grey-100 leading-relaxed whitespace-pre-wrap">{msg.content}</p>
            </motion.div>
          ))}
          {loading && (
            <p className="font-mono text-xs text-purple-light animate-pulse">Largo thinking…</p>
          )}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={submit} className="desk-largo-input-row">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Largo anything…"
            className="desk-largo-input"
            disabled={loading}
          />
          <button type="submit" disabled={loading || !input.trim()} className="desk-largo-send">
            Send
          </button>
        </form>
      </div>
    </DeskPanel>
  );
}
