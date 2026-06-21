"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { FlowAlert } from "@/lib/api";

const REFRESH_MS = 10 * 60 * 1000;
const MIN_ALERTS = 5;

async function fetchBrief(alerts: FlowAlert[]): Promise<string | null> {
  try {
    const res = await fetch("/api/market/flow-brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alerts: alerts.slice(0, 20) }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()).brief ?? null;
  } catch {
    return null;
  }
}

export function FlowBrief({ alerts }: { alerts: FlowAlert[] }) {
  const [brief, setBrief]         = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const lastFpRef = useRef("");

  const refresh = useCallback(async (forAlerts: FlowAlert[]) => {
    if (forAlerts.length < MIN_ALERTS) return;
    const fp = forAlerts.slice(0, 3).map((a) => a.alerted_at).join("|");
    if (fp === lastFpRef.current) return;
    lastFpRef.current = fp;
    setLoading(true);
    const text = await fetchBrief(forAlerts);
    setLoading(false);
    if (text) setBrief(text);
  }, []);

  useEffect(() => { refresh(alerts); }, [alerts, refresh]);
  useEffect(() => {
    const id = setInterval(() => refresh(alerts), REFRESH_MS);
    return () => clearInterval(id);
  }, [alerts, refresh]);

  if (!brief && !loading) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="relative overflow-hidden rounded-lg"
        style={{
          background: "linear-gradient(135deg, rgba(217,70,239,0.12) 0%, rgba(0,0,0,0.7) 40%, rgba(0,255,102,0.08) 100%)",
          border: "1px solid",
          borderImage: "linear-gradient(90deg, rgba(217,70,239,0.6), rgba(0,255,102,0.5)) 1",
          boxShadow: "0 0 30px rgba(217,70,239,0.15), 0 0 60px rgba(0,255,102,0.05)",
        }}
      >
        {/* Animated top gradient line */}
        <div className="absolute inset-x-0 top-0 h-[2px]" style={{
          background: "linear-gradient(90deg, transparent, #e879f9, #00ff66, transparent)",
          animation: "brief-scan 3s ease-in-out infinite",
        }} />

        <div className="flex items-start gap-3 px-4 py-3">
          {/* AI icon */}
          <div className="flex-shrink-0 flex items-center gap-1.5 pt-0.5">
            <div className="relative">
              <span className="w-2 h-2 rounded-full block relative z-10" style={{ background: "#e879f9", boxShadow: "0 0 8px #e879f9" }} />
              <span className="absolute inset-0 rounded-full animate-ping opacity-50" style={{ background: "#e879f9" }} />
            </div>
            <span className="font-mono text-[9px] tracking-[0.35em] uppercase font-bold" style={{ color: "#e879f9", textShadow: "0 0 8px rgba(232,121,249,0.7)" }}>
              AI BRIEF
            </span>
            <span className="font-mono text-[8px] tracking-[0.2em] uppercase" style={{ color: "#00e566", textShadow: "0 0 6px rgba(0,229,102,0.6)" }}>
              · LIVE
            </span>
          </div>

          {/* Text */}
          <AnimatePresence mode="wait">
            {loading && !brief ? (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 space-y-1.5 py-0.5">
                <div className="flow-skeleton h-[11px] rounded w-full" />
                <div className="flow-skeleton h-[11px] rounded w-3/4" />
              </motion.div>
            ) : (
              <motion.p
                key={brief}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.4 }}
                className="flex-1 font-mono text-[12px] leading-relaxed font-medium"
                style={{ color: "#f0f0f0", textShadow: "0 0 1px rgba(255,255,255,0.3)" }}
              >
                {brief}
              </motion.p>
            )}
          </AnimatePresence>

          {/* Updating indicator */}
          {loading && brief && (
            <span className="flex-shrink-0 font-mono text-[9px] animate-pulse pt-0.5" style={{ color: "#00e566" }}>
              updating
            </span>
          )}
        </div>

        {/* Bottom line */}
        <div className="absolute inset-x-0 bottom-0 h-px" style={{
          background: "linear-gradient(90deg, transparent, rgba(0,255,102,0.3), rgba(217,70,239,0.3), transparent)",
        }} />
      </motion.div>
    </AnimatePresence>
  );
}
