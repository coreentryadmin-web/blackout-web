"use client";

import { motion } from "framer-motion";
import { ProductMark } from "@/components/marks/ProductMark";
import { largoModuleStarterCards, type LargoModuleStarterCard } from "@/lib/largo/largo-module-starter-cards";
import type { DeskSlashArgs } from "@/lib/largo/desk-scope";

export type LargoStarterPick = {
  question: string;
  deskScope: string;
  deskScopeArgs: DeskSlashArgs;
};

/**
 * Commanding empty state for the full-page terminal (BIE Master Spec §6 —
 * "Not a small chat box"). Presents Largo as the platform's decision-intelligence
 * surface with desk submodule cards so the first impression matches the slash CLI.
 */
export function LargoEmptyState({
  onPick,
}: {
  onPick: (pick: LargoStarterPick) => void;
}) {
  const cards = largoModuleStarterCards();

  function pickCard(card: LargoModuleStarterCard) {
    onPick({
      question: card.question,
      deskScope: card.desk,
      deskScopeArgs: { submodule: card.submodule },
    });
  }

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
          Largo is the decision-intelligence engine behind BlackOut — pick a desk module or type{" "}
          <span className="font-mono text-cyan-400">/spx-slayer gex</span> for a scoped read.
        </p>
      </div>

      <p className="largo-empty-label">Desk modules</p>
      <div className="largo-empty-grid">
        {cards.map((p) => (
          <button
            key={p.id}
            type="button"
            className="largo-empty-card largo-empty-card-module"
            onClick={() => pickCard(p)}
          >
            <span className="largo-empty-card-desk font-mono">{p.deskLabel}</span>
            <span className="largo-empty-card-q">{p.moduleLabel}</span>
            <span className="largo-empty-card-hint">{p.hint}</span>
          </button>
        ))}
      </div>
    </motion.div>
  );
}
