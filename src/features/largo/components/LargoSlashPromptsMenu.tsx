"use client";

import { clsx } from "clsx";
import { ExternalLink, X } from "lucide-react";
import type { SlashPrompt } from "@/lib/largo/slash-prompt-utils";
import type { SlashPromptsPayload } from "@/lib/largo/slash-prompt-utils";

export function LargoSlashPromptsMenu({
  open,
  payload,
  loading,
  prompts,
  activeIndex,
  onPick,
  onHover,
  onClose,
  onOpenDesk,
  native = false,
}: {
  open: boolean;
  payload: SlashPromptsPayload | null | undefined;
  loading: boolean;
  prompts: SlashPrompt[];
  activeIndex: number;
  onPick: (prompt: SlashPrompt) => void;
  onHover: (index: number) => void;
  onClose: () => void;
  onOpenDesk?: (href: string) => void;
  native?: boolean;
}) {
  if (!open) return null;

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

      {loading && !prompts.length && (
        <p className="largo-slash-prompts-loading font-mono">Pulling live desk reads…</p>
      )}

      {!loading && !prompts.length && (
        <p className="largo-slash-prompts-loading font-mono">No live prompts — type your question and send.</p>
      )}

      {prompts.length > 0 && (
        <ul className="largo-slash-prompts-list">
          {prompts.map((p, i) => (
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
        ↑↓ pick a question · Enter ask · type to filter · Esc close
      </p>
    </div>
  );
}
