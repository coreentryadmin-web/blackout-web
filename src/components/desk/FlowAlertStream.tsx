"use client";

import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import type { FlowAlert } from "@/lib/api";
import { fmtPremium } from "@/lib/api";
import { DeskPanel } from "./DeskPanel";

export function FlowAlertStream({ flows, live }: { flows: FlowAlert[]; live?: boolean }) {
  return (
    <DeskPanel title="Flow Tape" subtitle="Unusual Whales · live sweep" variant="purple" live={live} glow>
      <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
        <AnimatePresence initial={false}>
          {flows.length === 0 ? (
            <p className="text-grey-500 text-sm font-mono py-8 text-center">
              {live ? "Waiting for flow alerts…" : "Add UW_API_KEY on Railway for live flow tape"}
            </p>
          ) : (
            flows.map((flow, i) => (
              <motion.div
                key={`${flow.ticker}-${flow.alerted_at}-${i}`}
                initial={{ opacity: 0, x: -24, scale: 0.98 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                className="desk-flow-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-anton text-xl text-white">{flow.ticker}</span>
                      <span
                        className={clsx(
                          "desk-flow-badge",
                          flow.option_type?.toLowerCase() === "call" ? "desk-flow-call" : "desk-flow-put"
                        )}
                      >
                        {flow.option_type}
                      </span>
                      <span className="text-[10px] font-mono text-grey-500 uppercase">{flow.direction}</span>
                    </div>
                    <p className="font-mono text-xs text-grey-400 mt-1">
                      ${flow.strike} · {flow.expiry} · {flow.route}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-lg font-bold text-bull">{fmtPremium(flow.premium)}</p>
                    <p className="text-[10px] font-mono text-grey-500">score {flow.score}</p>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </DeskPanel>
  );
}
