"use client";

import useSWR from "swr";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  filterLargoSlashCommands,
  largoSlashQueryFromInput,
  parseLargoSlashInput,
  type LargoSlashCommand,
} from "@/lib/largo/slash-commands";
import {
  filterSlashPrompts,
  slashArgsFromInput,
  slashDeskKeyFromCommand,
  type SlashPrompt,
  type SlashPromptsPayload,
} from "@/lib/largo/slash-prompt-utils";
import { parseDeskSlashArgs } from "@/lib/largo/desk-scope";
import { filterSubmodules, type SlashSubmoduleItem } from "@/lib/largo/slash-submodules";
import type { SlashPanelTab } from "@/features/largo/components/LargoSlashPromptsMenu";

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
  const [panelTab, setPanelTab] = useState<SlashPanelTab>("modules");
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
  const allModules = promptPayload?.modules ?? [];

  const { submoduleToken, filterQuery } = useMemo(() => {
    if (!activeDesk || !promptArgs) {
      return { submoduleToken: "", filterQuery: promptArgs };
    }
    const parsed = parseDeskSlashArgs(promptArgs, activeDesk.command);
    if (parsed.submodule) {
      return { submoduleToken: parsed.submodule, filterQuery: promptArgs.replace(/^\S+\s*/, "") };
    }
    const first = promptArgs.split(/\s+/)[0] ?? "";
    return { submoduleToken: "", filterQuery: first };
  }, [activeDesk, promptArgs]);

  const moduleMatches = useMemo(
    () => (activeDesk ? filterSubmodules(allModules, filterQuery) : []),
    [activeDesk, allModules, filterQuery]
  );
  const promptMatches = useMemo(
    () => (activeDesk ? filterSlashPrompts(allPrompts, filterQuery) : []),
    [activeDesk, allPrompts, filterQuery]
  );

  const activeList = panelTab === "modules" && moduleMatches.length ? moduleMatches : promptMatches;
  const clampedPromptIndex = activeList.length ? Math.min(promptIndex, activeList.length - 1) : 0;

  // Prefer Modules tab when typing matches a stable submodule prefix.
  useEffect(() => {
    if (!activeDesk || !filterQuery) return;
    if (moduleMatches.length && !promptMatches.length) setPanelTab("modules");
    else if (promptMatches.length && !moduleMatches.length) setPanelTab("live");
  }, [activeDesk, filterQuery, moduleMatches.length, promptMatches.length]);

  const selectDesk = useCallback(
    (cmd: LargoSlashCommand) => {
      setActiveDesk(cmd);
      setInput(`/${cmd.command}`);
      setPromptIndex(0);
      setCommandIndex(0);
      setPanelTab("modules");
    },
    [setInput]
  );

  const clearDesk = useCallback(() => {
    setActiveDesk(null);
    setPromptIndex(0);
    setPanelTab("modules");
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
    const topLive = promptMatches[0];
    if (!topLive) return;
    autoAskArmedRef.current = false;
    onAutoAsk(topLive.question, {
      deskScope: activeDesk.command,
      deskScopeArgs: parseDeskSlashArgs(promptArgs, activeDesk.command),
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
      if (activeDesk && activeList.length) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setPromptIndex((i) => (i + 1) % activeList.length);
          return "handled";
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setPromptIndex((i) => (i - 1 + activeList.length) % activeList.length);
          return "handled";
        }
        if (e.key === "Tab") {
          e.preventDefault();
          if (allModules.length) {
            setPanelTab((t) => (t === "modules" ? "live" : "modules"));
            setPromptIndex(0);
          }
          return "handled";
        }
        if (e.key === "Enter" && e.shiftKey) {
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
      activeList,
      allModules.length,
      commandMenuOpen,
      commandMatches,
      clampedCommandIndex,
      applyCommand,
      clearDesk,
      setInput,
    ]
  );

  const highlightedPrompt = panelTab === "live" ? (promptMatches[clampedPromptIndex] ?? null) : null;
  const highlightedModule =
    panelTab === "modules" ? (moduleMatches[clampedPromptIndex] as SlashSubmoduleItem | null) : null;

  return {
    commandMenuOpen,
    commandMatches,
    commandIndex: clampedCommandIndex,
    activeDesk,
    promptPayload,
    promptsLoading,
    panelTab,
    setPanelTab,
    moduleMatches,
    promptMatches,
    promptIndex: clampedPromptIndex,
    highlightedPrompt,
    highlightedModule,
    submoduleToken,
    applyCommand,
    selectDesk,
    clearDesk,
    onInputChange,
    handleKeyDown,
    setCommandIndex,
    setPromptIndex,
    parseArgsForDesk: (args: string) =>
      activeDesk ? parseDeskSlashArgs(args, activeDesk.command) : parseDeskSlashArgs(args),
  };
}
