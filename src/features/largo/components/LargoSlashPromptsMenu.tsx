"use client";

import { clsx } from "clsx";
import { ExternalLink, X } from "lucide-react";
import type { SlashPrompt, SlashPromptsPayload } from "@/lib/largo/slash-prompt-utils";
import type { SlashSubmoduleItem } from "@/lib/largo/slash-submodules";

export type SlashPanelTab = "modules" | "live";

export function LargoSlashPromptsMenu({
  open,
  payload,
  loading,
  tab,
  onTabChange,
  modules,
  prompts,
  activeIndex,
  onPickModule,
  onPick,
  onHover,
  onClose,
  onOpenDesk,
  native = false,
}: {
  open: boolean;
  payload: SlashPromptsPayload | null | undefined;
  loading: boolean;
  tab: SlashPanelTab;
  onTabChange: (tab: SlashPanelTab) => void;
  modules: SlashSubmoduleItem[];
  prompts: SlashPrompt[];
  activeIndex: number;
  onPickModule: (mod: SlashSubmoduleItem) => void;
  onPick: (prompt: SlashPrompt) => void;
  onHover: (index: number) => void;
  onClose: () => void;
  onOpenDesk?: (href: string) => void;
  native?: boolean;
}) {
  if (!open) return null;

  const activeList = tab === "modules" ? modules : prompts;
  const hasModules = modules.length > 0;
  const hasLive = prompts.length > 0 || loading;

  return (
    <div
      id="largo-slash-prompts"
      className={clsx("largo-slash-prompts", native && "largo-slash-prompts-native")}
      role="listbox"
      aria-label={`Questions about ${payload?.label ?? "desk"}`}
    >
      <div className="largo-slash-prompts-head">
        <div>
          <p className="largo-slash-prompts-kicker font-mono">/{payload?.command ?? "desk"}</p>
          <p className="largo-slash-prompts-title font-syne">{payload?.label ?? "Desk"}</p>
        </div>
        <div className="largo-slash-prompts-head-actions">
          {payload?.href && onOpenDesk && (
            <button
              type="button"
              className="largo-slash-open-desk"
              onClick={() => onOpenDesk(payload.href!)}
              title={`Open ${payload.label} in a new view`}
            >
              <ExternalLink size={12} aria-hidden />
              Open desk
            </button>
          )}
          <button type="button" className="largo-slash-prompts-close" onClick={onClose} aria-label="Close">
            <X size={14} aria-hidden />
          </button>
        </div>
      </div>

      {hasModules && (
        <div className="largo-slash-prompts-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "modules"}
            className={clsx("largo-slash-tab", tab === "modules" && "largo-slash-tab-active")}
            onClick={() => onTabChange("modules")}
          >
            Modules
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "live"}
            className={clsx("largo-slash-tab", tab === "live" && "largo-slash-tab-active")}
            onClick={() => onTabChange("live")}
          >
            Live
          </button>
        </div>
      )}

      {tab === "live" && loading && !prompts.length && (
        <p className="largo-slash-prompts-loading font-mono">Pulling live desk reads…</p>
      )}

      {tab === "live" && !loading && !prompts.length && !hasModules && (
        <p className="largo-slash-prompts-loading font-mono">No live prompts — type your question and send.</p>
      )}

      {tab === "modules" && !modules.length && (
        <p className="largo-slash-prompts-loading font-mono">Type a question or pick Live prompts.</p>
      )}

      {activeList.length > 0 && (
        <ul className="largo-slash-prompts-list">
          {tab === "modules"
            ? modules.map((m, i) => (
                <li key={m.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === activeIndex}
                    className={clsx(
                      "largo-slash-prompt-item largo-slash-module-item",
                      i === activeIndex && "largo-slash-prompt-item-active"
                    )}
                    onMouseEnter={() => onHover(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onPickModule(m)}
                  >
                    <span className="largo-slash-prompt-label font-syne">{m.label}</span>
                    <span className="largo-slash-module-id font-mono">{m.id}</span>
                    <span className="largo-slash-prompt-hint">{m.description}</span>
                  </button>
                </li>
              ))
            : prompts.map((p, i) => (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === activeIndex}
                    className={clsx(
                      "largo-slash-prompt-item",
                      i === activeIndex && "largo-slash-prompt-item-active"
                    )}
                    onMouseEnter={() => onHover(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onPick(p)}
                  >
                    <span className="largo-slash-prompt-label font-syne">{p.label}</span>
                    {p.live && <span className="largo-slash-prompt-live font-mono">{p.live}</span>}
                    {p.hint && !p.live && <span className="largo-slash-prompt-hint">{p.hint}</span>}
                  </button>
                </li>
              ))}
        </ul>
      )}

      <p className="largo-slash-menu-hint font-mono">
        {hasModules
          ? "↑↓ pick · Tab switch Modules/Live · Enter ask · Esc close"
          : "↑↓ pick a question · Enter ask · type to filter · Esc close"}
      </p>
    </div>
  );
}
