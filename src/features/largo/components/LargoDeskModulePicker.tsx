"use client";

import { clsx } from "clsx";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import type { DeskScopeKey } from "@/lib/largo/desk-scope";
import {
  largoDeskStarterCards,
  largoSubmoduleCardsForDesk,
  type LargoDeskStarterCard,
  type LargoModuleStarterCard,
} from "@/lib/largo/largo-module-starter-cards";
import type { LargoStarterPick } from "@/lib/largo/largo-module-starter-cards";

export function LargoDeskModulePicker({
  variant = "empty",
  desks,
  onPick,
  className,
}: {
  variant?: "empty" | "compact" | "native";
  /** Override desk list (e.g. compact row omits track-record). */
  desks?: LargoDeskStarterCard[];
  onPick: (pick: LargoStarterPick) => void;
  className?: string;
}) {
  const [selectedDesk, setSelectedDesk] = useState<DeskScopeKey | null>(null);
  const deskList = desks ?? largoDeskStarterCards();
  const selectedLabel = deskList.find((d) => d.id === selectedDesk)?.label;
  const modules = selectedDesk ? largoSubmoduleCardsForDesk(selectedDesk) : [];

  function pickModule(card: LargoModuleStarterCard) {
    onPick({
      question: card.question,
      deskScope: card.desk,
      deskScopeArgs: { submodule: card.submodule },
    });
    setSelectedDesk(null);
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
            {selectedLabel}
          </p>
          <p className="largo-desk-module-picker-sub font-mono">Pick a module</p>
        </div>

        {variant === "compact" || variant === "native" ? (
          <div className="largo-desk-module-chip-row">
            {modules.map((m) => (
              <button
                key={m.id}
                type="button"
                className={clsx(
                  "largo-suggestion-chip largo-suggestion-chip-module",
                  variant === "native" && "largo-native-suggestion largo-native-suggestion-module"
                )}
                onClick={() => pickModule(m)}
                title={m.hint}
              >
                {variant === "compact" && <span aria-hidden className="largo-suggestion-arrow">▸</span>}
                {m.moduleLabel}
              </button>
            ))}
          </div>
        ) : (
          <div className="largo-empty-grid">
            {modules.map((m) => (
              <button
                key={m.id}
                type="button"
                className="largo-empty-card largo-empty-card-module"
                onClick={() => pickModule(m)}
              >
                <span className="largo-empty-card-desk font-mono">{m.submodule}</span>
                <span className="largo-empty-card-q">{m.moduleLabel}</span>
                <span className="largo-empty-card-hint">{m.hint}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={clsx("largo-desk-module-picker", `largo-desk-module-picker-${variant}`, className)}>
      {variant === "empty" && (
        <p className="largo-empty-label">Pick a desk</p>
      )}
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
              onClick={() => setSelectedDesk(d.id)}
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
              onClick={() => setSelectedDesk(d.id)}
            >
              <span className="largo-empty-card-q">{d.label}</span>
              <span className="largo-empty-card-hint">{d.description}</span>
              <span className="largo-empty-card-meta font-mono">{d.moduleCount} modules</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
