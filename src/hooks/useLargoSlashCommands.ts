"use client";

import { useCallback, useMemo, useState } from "react";
import {
  filterLargoSlashCommands,
  largoSlashQueryFromInput,
  type LargoSlashCommand,
  type SlashMatch,
} from "@/lib/largo/slash-commands";

export function useLargoSlashCommands(input: string, setInput: (v: string) => void) {
  const query = largoSlashQueryFromInput(input);
  const open = query !== null;
  const matches = useMemo(() => (open ? filterLargoSlashCommands(query ?? "") : []), [open, query]);
  const [activeIndex, setActiveIndex] = useState(0);

  const clampedIndex = matches.length ? Math.min(activeIndex, matches.length - 1) : 0;

  const applyCommand = useCallback(
    (cmd: LargoSlashCommand, replaceWhole = false) => {
      const next = `/${cmd.command} `;
      if (replaceWhole || input.trimStart().startsWith("/")) {
        setInput(next);
      } else {
        setInput(`${input}${next}`);
      }
      setActiveIndex(0);
    },
    [input, setInput]
  );

  const onInputChange = useCallback(
    (next: string) => {
      setInput(next);
      setActiveIndex(0);
    },
    [setInput]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>): boolean => {
      if (!open || !matches.length) return false;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % matches.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
        return true;
      }
      if (e.key === "Tab" || (e.key === "Enter" && e.shiftKey)) {
        e.preventDefault();
        applyCommand(matches[clampedIndex]!, true);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setInput("");
        return true;
      }
      return false;
    },
    [open, matches, clampedIndex, applyCommand, setInput]
  );

  return {
    open,
    matches,
    activeIndex: clampedIndex,
    applyCommand,
    onInputChange,
    handleKeyDown,
    setActiveIndex,
  } satisfies {
    open: boolean;
    matches: SlashMatch[];
    activeIndex: number;
    applyCommand: (cmd: LargoSlashCommand, replaceWhole?: boolean) => void;
    onInputChange: (next: string) => void;
    handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => boolean;
    setActiveIndex: (i: number) => void;
  };
}
