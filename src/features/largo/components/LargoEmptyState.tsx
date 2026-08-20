"use client";

import { motion } from "framer-motion";
import { ProductMark } from "@/components/marks/ProductMark";
import { LargoDeskModulePicker } from "@/features/largo/components/LargoDeskModulePicker";
import type { LargoScopePick, LargoStarterPick } from "@/lib/largo/largo-module-starter-cards";

export type { LargoScopePick, LargoStarterPick };

export function LargoEmptyState({
  onScope,
  onAsk,
}: {
  onScope: (pick: LargoScopePick) => void;
  onAsk?: (pick: LargoStarterPick) => void;
}) {
  return (
    <motion.div
      className="largo-empty"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="largo-empty-hero">
        <ProductMark product="largo" size={44} />
        <h2 className="largo-empty-title">Ask the desk anything.</h2>
        <p className="largo-empty-lead">
          Pick a desk (optional: a module lens), type your question, send — or use{" "}
          <span className="font-mono text-cyan-400">/spx-slayer gex</span> in the composer.
        </p>
      </div>

      <LargoDeskModulePicker variant="empty" onScope={onScope} onAsk={onAsk} />
    </motion.div>
  );
}
