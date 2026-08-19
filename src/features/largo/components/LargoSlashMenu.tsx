"use client";

import { clsx } from "clsx";
import type { LargoSlashCommand, SlashMatch } from "@/lib/largo/slash-commands";

export function LargoSlashMenu({
  open,
  matches,
  activeIndex,
  onPick,
  onHover,
  native = false,
}: {
  open: boolean;
  matches: SlashMatch[];
  activeIndex: number;
  onPick: (cmd: LargoSlashCommand) => void;
  onHover: (index: number) => void;
  native?: boolean;
}) {
  if (!open || !matches.length) return null;

  return (
    <div
      id="largo-slash-menu"
      className={clsx("largo-slash-menu", native && "largo-slash-menu-native")}
      role="listbox"
      aria-label="Desk commands"
    >
      <p className="largo-slash-menu-label font-mono">Desk commands</p>
      <ul className="largo-slash-menu-list">
        {matches.map((cmd, i) => (
          <li key={cmd.id}>
            <button
              type="button"
              role="option"
              aria-selected={i === activeIndex}
              className={clsx("largo-slash-menu-item", i === activeIndex && "largo-slash-menu-item-active")}
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => {
                // Keep focus on input — don't blur before pick.
                e.preventDefault();
              }}
              onClick={() => onPick(cmd)}
            >
              <span className="largo-slash-menu-cmd font-mono">/{cmd.command}</span>
              <span className="largo-slash-menu-meta">
                <span className="largo-slash-menu-title font-syne">{cmd.label}</span>
                <span className="largo-slash-menu-desc">{cmd.description}</span>
              </span>
              <span className="largo-slash-menu-kind font-mono" aria-hidden>
                {cmd.kind === "navigate" ? "Open" : "Ask"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="largo-slash-menu-hint font-mono">
        ↑↓ select · Tab complete · Enter send · type to filter
      </p>
    </div>
  );
}
