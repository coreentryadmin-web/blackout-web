"use client";

import { clsx } from "clsx";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import type { DeskScopeKey } from "@/lib/largo/desk-scope";
import {
  formatLargoScopePrefill,
  largoDeskStarterCards,
  largoSubmoduleCardsForDesk,
  type LargoDeskStarterCard,
  type LargoModuleStarterCard,
  type LargoScopePick,
  type LargoStarterPick,
} from "@/lib/largo/largo-module-starter-cards";

export function LargoDeskModulePicker({
  variant = "empty",
  desks,
  onScope,
  onAsk,
  className,
}: {
  variant?: "empty" | "compact" | "native";
  desks?: LargoDeskStarterCard[];
  /** Set scope only — member types their question in the composer (submodule optional). */
  onScope: (pick: LargoScopePick) => void;
  /** Optional one-tap ask with the module's default question (Talon-style quick chip). */
  onAsk?: (pick: LargoStarterPick) => void;
  className?: string;
}) {
  const [selectedDesk, setSelectedDesk] = useState<DeskScopeKey | null>(null);
  const deskList = desks ?? largoDeskStarterCards();
  const selectedMeta = deskList.find((d) => d.id === selectedDesk);
  const modules = selectedDesk ? largoSubmoduleCardsForDesk(selectedDesk) : [];

  function selectDesk(id: DeskScopeKey) {
    const meta = deskList.find((d) => d.id === id);
    setSelectedDesk(id);
    if (meta) {
      onScope({
        deskScope: id,
        prefill: formatLargoScopePrefill(meta.command),
      });
    }
  }

  function scopeModule(card: LargoModuleStarterCard) {
    onScope({
      deskScope: card.desk,
      deskScopeArgs: { submodule: card.submodule },
      prefill: formatLargoScopePrefill(card.desk, card.submodule),
    });
  }

  function quickAskModule(card: LargoModuleStarterCard, e: React.MouseEvent) {
    e.stopPropagation();
    onAsk?.({
      question: card.question,
      deskScope: card.desk,
      deskScopeArgs: { submodule: card.submodule },
    });
  }

  if (selectedDesk && modules.length) {
    return (
      <div className={clsx("largo-desk-module-picker", `largo-desk-module-picker-${variant}`, className)}>
        <div className="largo-desk-module-picker-head">
          <button
            type="button"
            className="largo-desk-module-back"
            onClick={() => setSelectedDesk(null)}
          >
            <ChevronLeft size={14} aria-hidden />
            All desks
          </button>
          <p className={clsx("largo-desk-module-picker-title", variant === "empty" && "font-syne")}>
            {selectedMeta?.label}
          </p>
          <p className="largo-desk-module-picker-sub font-mono">
            Type your question below — module lens optional
          </p>
        </div>

        {variant === "compact" || variant === "native" ? (
          <div className="largo-desk-module-chip-row">
            {modules.map((m) => (
              <div key={m.id} className="largo-module-chip-wrap">
                <button
                  type="button"
                  className={clsx(
                    "largo-suggestion-chip largo-suggestion-chip-module",
                    variant === "native" && "largo-native-suggestion largo-native-suggestion-module"
                  )}
                  onClick={() => scopeModule(m)}
                  title={`Scope to ${m.moduleLabel} — then type your question`}
                >
                  {variant === "compact" && <span aria-hidden className="largo-suggestion-arrow">▸</span>}
                  {m.moduleLabel}
                </button>
                {onAsk && (
                  <button
                    type="button"
                    className="largo-module-quick-ask font-mono"
                    onClick={(e) => quickAskModule(m, e)}
                    title="Ask default question now"
                  >
                    Ask
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="largo-empty-grid">
            {modules.map((m) => (
              <div key={m.id} className="largo-empty-card largo-empty-card-module largo-empty-card-module-wrap">
                <button type="button" className="largo-empty-card-module-main" onClick={() => scopeModule(m)}>
                  <span className="largo-empty-card-desk font-mono">{m.submodule}</span>
                  <span className="largo-empty-card-q">{m.moduleLabel}</span>
                  <span className="largo-empty-card-hint">{m.hint}</span>
                  <span className="largo-empty-card-meta font-mono">Click to scope · type your question</span>
                </button>
                {onAsk && (
                  <button
                    type="button"
                    className="largo-module-quick-ask-block font-mono"
                    onClick={(e) => quickAskModule(m, e)}
                  >
                    Quick ask →
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={clsx("largo-desk-module-picker", `largo-desk-module-picker-${variant}`, className)}>
      {variant === "empty" && <p className="largo-empty-label">Pick a desk</p>}
      {(variant === "compact" || variant === "native") && (
        <p className={clsx(variant === "native" ? "largo-native-suggestions-label" : "largo-suggestions-label")}>
          Pick a desk
        </p>
      )}

      {variant === "compact" || variant === "native" ? (
        <div className="largo-desk-module-chip-row">
          {deskList.map((d) => (
            <button
              key={d.id}
              type="button"
              className={clsx(
                "largo-suggestion-chip largo-suggestion-chip-desk",
                variant === "native" && "largo-native-suggestion largo-native-suggestion-desk"
              )}
              onClick={() => selectDesk(d.id)}
              title={d.description}
            >
              {variant === "compact" && <span aria-hidden className="largo-suggestion-arrow">▸</span>}
              {d.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="largo-empty-grid">
          {deskList.map((d) => (
            <button
              key={d.id}
              type="button"
              className="largo-empty-card largo-empty-card-desk largo-empty-card-desk-only"
              onClick={() => selectDesk(d.id)}
            >
              <span className="largo-empty-card-q">{d.label}</span>
              <span className="largo-empty-card-hint">{d.description}</span>
              <span className="largo-empty-card-meta font-mono">{d.moduleCount} modules · type after pick</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
