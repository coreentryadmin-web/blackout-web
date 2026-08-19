"use client";

import useSWR from "swr";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  filterLargoSlashCommands,
  largoSlashQueryFromInput,
  parseLargoSlashInput,
  type LargoSlashCommand,
  type SlashMatch,
} from "@/lib/largo/slash-commands";
import {
  filterSlashPrompts,
  slashArgsFromInput,
  slashDeskKeyFromCommand,
  type SlashPrompt,
  type SlashPromptsPayload,
} from "@/lib/largo/slash-prompt-utils";
import { parseDeskSlashArgs } from "@/lib/largo/desk-scope";

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));

export function useLargoSlashCommands(
  input: string,
  setInput: (v: string) => void,
  onAutoAsk?: (
    question: string,
    scope?: { deskScope: string; deskScopeArgs?: ReturnType<typeof parseDeskSlashArgs> }
  ) => void
) {
  const [activeDesk, setActiveDesk] = useState<LargoSlashCommand | null>(null);
  const [promptIndex, setPromptIndex] = useState(0);
  const autoAskArmedRef = useRef(false);

  const commandQuery = largoSlashQueryFromInput(input);
  const commandMenuOpen = commandQuery !== null && !activeDesk;
  const commandMatches = useMemo(
    () => (commandMenuOpen ? filterLargoSlashCommands(commandQuery ?? "") : []),
    [commandMenuOpen, commandQuery]
  );
  const [commandIndex, setCommandIndex] = useState(0);
  const clampedCommandIndex = commandMatches.length
    ? Math.min(commandIndex, commandMatches.length - 1)
    : 0;

  const deskKey = activeDesk ? slashDeskKeyFromCommand(activeDesk) : null;
  const { data: promptPayload, isLoading: promptsLoading } = useSWR<SlashPromptsPayload | null>(
    deskKey ? `/api/market/largo/slash-prompts?desk=${encodeURIComponent(deskKey)}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 15_000 }
  );

  const promptArgs = activeDesk ? slashArgsFromInput(input, activeDesk.command) : "";
  const allPrompts = promptPayload?.prompts ?? [];
  const promptMatches = useMemo(
    () => (activeDesk ? filterSlashPrompts(allPrompts, promptArgs) : []),
    [activeDesk, allPrompts, promptArgs]
  );
  const clampedPromptIndex = promptMatches.length ? Math.min(promptIndex, promptMatches.length - 1) : 0;

  const selectDesk = useCallback(
    (cmd: LargoSlashCommand) => {
      setActiveDesk(cmd);
      setInput(`/${cmd.command}`);
      setPromptIndex(0);
      setCommandIndex(0);
    },
    [setInput]
  );

  const clearDesk = useCallback(() => {
    setActiveDesk(null);
    setPromptIndex(0);
  }, []);

  const applyCommand = useCallback(
    (cmd: LargoSlashCommand) => {
      autoAskArmedRef.current = Boolean(onAutoAsk);
      selectDesk(cmd);
    },
    [selectDesk, onAutoAsk]
  );

  useEffect(() => {
    if (!autoAskArmedRef.current || !onAutoAsk || !activeDesk || promptsLoading) return;
    const top = promptMatches[0];
    if (!top) return;
    autoAskArmedRef.current = false;
    onAutoAsk(top.question, {
      deskScope: activeDesk.command,
      deskScopeArgs: parseDeskSlashArgs(promptArgs),
    });
    setActiveDesk(null);
    setInput("");
  }, [activeDesk, promptsLoading, promptMatches, onAutoAsk, setInput, promptArgs]);

  const onInputChange = useCallback(
    (next: string) => {
      setInput(next);
      setCommandIndex(0);
      setPromptIndex(0);

      const trimmed = next.trimStart();
      if (!trimmed.startsWith("/")) {
        setActiveDesk(null);
        return;
      }

      const { command } = parseLargoSlashInput(trimmed);
      if (command && activeDesk && command.command !== activeDesk.command) {
        setActiveDesk(command);
      } else if (command && !activeDesk && largoSlashQueryFromInput(trimmed) === null) {
        setActiveDesk(command);
      } else if (!command) {
        setActiveDesk(null);
      }
    },
    [setInput, activeDesk]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>): "prompt-pick" | "handled" | false => {
      if (activeDesk && promptMatches.length) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setPromptIndex((i) => (i + 1) % promptMatches.length);
          return "handled";
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setPromptIndex((i) => (i - 1 + promptMatches.length) % promptMatches.length);
          return "handled";
        }
        if (e.key === "Tab" || (e.key === "Enter" && e.shiftKey)) {
          e.preventDefault();
          return "prompt-pick";
        }
        if (e.key === "Escape") {
          e.preventDefault();
          clearDesk();
          setInput("");
          return "handled";
        }
        return false;
      }

      if (!commandMenuOpen || !commandMatches.length) return false;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCommandIndex((i) => (i + 1) % commandMatches.length);
        return "handled";
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCommandIndex((i) => (i - 1 + commandMatches.length) % commandMatches.length);
        return "handled";
      }
      if (e.key === "Tab" || (e.key === "Enter" && e.shiftKey)) {
        e.preventDefault();
        applyCommand(commandMatches[clampedCommandIndex]!);
        return "handled";
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setInput("");
        return "handled";
      }
      return false;
    },
    [
      activeDesk,
      promptMatches,
      commandMenuOpen,
      commandMatches,
      clampedCommandIndex,
      applyCommand,
      clearDesk,
      setInput,
    ]
  );

  const highlightedPrompt = promptMatches[clampedPromptIndex] ?? null;

  return {
    commandMenuOpen,
    commandMatches,
    commandIndex: clampedCommandIndex,
    activeDesk,
    promptPayload,
    promptsLoading,
    promptMatches,
    promptIndex: clampedPromptIndex,
    highlightedPrompt,
    applyCommand,
    selectDesk,
    clearDesk,
    onInputChange,
    handleKeyDown,
    setCommandIndex,
    setPromptIndex,
  };
}
