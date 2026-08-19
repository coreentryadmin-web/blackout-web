"use client";

import { clsx } from "clsx";
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { LargoMessageBody } from "@/features/largo/components/LargoMessageBody";
import { LargoAnswerMessage } from "@/features/largo/components/LargoAnswerMessage";
import { LargoThinkingState } from "@/features/largo/components/LargoThinkingState";
import { resetIosViewport } from "@/hooks/useIosKeyboardInset";
import { largoModuleComposerChips } from "@/lib/largo/largo-module-starter-cards";
import { largoToolLabel, useLargoChat } from "@/hooks/useLargoChat";
import { useLargoSlashCommands } from "@/hooks/useLargoSlashCommands";
import { resolveLargoSlashSubmit } from "@/lib/largo/slash-commands";
import { parseDeskSlashArgs } from "@/lib/largo/desk-scope";
import { slashArgsFromInput } from "@/lib/largo/slash-prompt-utils";
import type { SlashSubmoduleItem } from "@/lib/largo/slash-submodules";
import { LargoProactiveComposer } from "@/features/largo/components/LargoProactiveComposer";
import { LargoDeskScopeBanner } from "@/features/largo/components/LargoDeskScopeBanner";
import { LargoStatusStrip } from "@/features/largo/components/LargoStatusStrip";
import { LargoSlashMenu } from "@/features/largo/components/LargoSlashMenu";
import { LargoSlashPromptsMenu } from "@/features/largo/components/LargoSlashPromptsMenu";

const PLACEHOLDER = "Type / for desk commands — SPX, flow, news…";
const PLACEHOLDER_BUSY = "Pulling live data…";

/** Mobile-only Largo desk — no web Panel, no responsive breakpoints. */
export function LargoNativeTerminal() {
  const {
    messages,
    input,
    setInput,
    loading,
    streaming,
    hydrated,
    activeTools,
    statusMessage,
    awaitingFirstToken,
    bottomRef,
    runQuery,
    cancel,
    newConversation,
    isFresh,
    activeSessionId,
    activeDeskScope,
    setActiveDeskScope,
    activeDeskScopeArgs,
    setActiveDeskScopeArgs,
    activeTicker,
  } = useLargoChat();

  const router = useRouter();
  const slash = useLargoSlashCommands(input, setInput, (q, scope) =>
    void runQuery(q, { deskScope: scope?.deskScope, deskScopeArgs: scope?.deskScopeArgs })
  );
  const inputRef = useRef<HTMLInputElement>(null);

  function askFromSlash(question: string, submodule?: string | null) {
    const desk = slash.activeDesk;
    const args = desk ? slashArgsFromInput(input, desk.command) : "";
    const parsed = desk ? parseDeskSlashArgs(args, desk.command) : parseDeskSlashArgs(args);
    void runQuery(question, {
      deskScope: desk?.command ?? null,
      deskScopeArgs: submodule ? { ...parsed, submodule } : parsed,
    });
    setInput("");
    slash.clearDesk();
  }

  function askFromModule(mod: SlashSubmoduleItem) {
    askFromSlash(mod.exampleQuestion, mod.id);
  }

  function submitSlashOrQuery(text: string) {
    const resolved = resolveLargoSlashSubmit(text, slash.promptMatches);
    if (resolved.type === "query") {
      void runQuery(resolved.question, {
        deskScope: resolved.deskScope ?? null,
        deskScopeArgs: resolved.deskScopeArgs,
      });
      setInput("");
      slash.clearDesk();
      return;
    }
    void runQuery(resolved.text);
    slash.clearDesk();
  }

  return (
    <div className="largo-native-desk">
      {/* The intelligence strip belongs on EVERY Largo surface, not just the desktop one.
          It was wired into LargoTerminal only, so mobile — a separate component — showed the
          new prompts and no strip, which reads as the feature not existing rather than as
          a surface it was never added to. */}
      <LargoStatusStrip />
      {!isFresh && (
        <div className="largo-native-topbar">
          <button
            type="button"
            className="largo-native-newchat"
            onClick={newConversation}
            disabled={loading}
          >
            + New chat
          </button>
        </div>
      )}
      <div className="largo-native-messages" role="log" aria-live="polite" aria-atomic="false">
        {messages.map((msg, idx) => (
          <div
            key={msg.id}
            className={clsx(
              "largo-native-bubble",
              msg.role === "user" ? "largo-native-bubble-user" : "largo-native-bubble-assistant",
              msg.id === "welcome" && "largo-native-bubble-welcome"
            )}
          >
            <p className="largo-native-bubble-label">{msg.role === "user" ? "You" : "Largo"}</p>
            {msg.role === "assistant" ? (
              msg.id === "welcome" ? (
                <LargoMessageBody content={msg.content} className="largo-native-body" />
              ) : (
                <LargoAnswerMessage
                  content={msg.content}
                  envelope={msg.envelope}
                  turnId={msg.turnId ?? null}
                  compareCard={msg.compareCard}
                  playSimilarity={msg.playSimilarity}
                  preEarningsPack={msg.preEarningsPack}
                  actions={msg.actions}
                  sessionId={activeSessionId}
                  question={
                    idx > 0 && messages[idx - 1]?.role === "user" ? messages[idx - 1]?.content : null
                  }
                  streaming={
                    loading && idx === messages.length - 1 && msg.role === "assistant"
                  }
                  className="largo-native-body"
                  onFollowup={(q) => void runQuery(q, { deskScope: activeDeskScope })}
                  followups={msg.followups}
                  deskScope={msg.deskScope}
                  deskScopeArgs={msg.deskScopeArgs}
                  miniPanel={msg.miniPanel}
                  ticker={activeTicker}
                  nativeFollowups
                />
              )
            ) : (
              <p className="largo-native-body whitespace-pre-wrap">{msg.content}</p>
            )}
            {msg.role === "assistant" && msg.tools && msg.tools.length > 0 && (
              <div className="largo-native-tools">
                {msg.tools.map((t) => (
                  <span key={t} className="largo-native-tool-chip">
                    {largoToolLabel(t)}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {isFresh && !loading && hydrated && (
          <div className="largo-native-suggestions">
            <p className="largo-native-suggestions-label">Desk modules</p>
            {largoModuleComposerChips().map((p) => (
              <button
                key={p.id}
                type="button"
                className="largo-native-suggestion largo-native-suggestion-module"
                onClick={() =>
                  void runQuery(p.question, {
                    deskScope: p.desk,
                    deskScopeArgs: { submodule: p.submodule },
                  })
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {loading && (awaitingFirstToken || !streaming) && (
          <div className="largo-native-bubble largo-native-bubble-assistant">
            <LargoThinkingState tools={activeTools} statusMessage={statusMessage} />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <LargoProactiveComposer
        disabled={loading || !hydrated}
        onAsk={(q) => void runQuery(q)}
        className="largo-proactive-chips-native"
      />
      <LargoDeskScopeBanner
        deskScope={activeDeskScope}
        submodule={activeDeskScopeArgs?.submodule}
        ticker={activeTicker}
        onClear={() => {
          setActiveDeskScope(null);
          setActiveDeskScopeArgs(null);
        }}
        className="largo-desk-scope-banner-native"
      />

      <form
        className="largo-native-composer"
        onSubmit={(e) => {
          e.preventDefault();
          submitSlashOrQuery(input);
        }}
      >
        <div className="largo-native-input-wrap">
          <LargoSlashPromptsMenu
            open={Boolean(slash.activeDesk && !loading && hydrated)}
            payload={slash.promptPayload}
            loading={slash.promptsLoading}
            tab={slash.panelTab}
            onTabChange={slash.setPanelTab}
            modules={slash.moduleMatches}
            prompts={slash.promptMatches}
            activeIndex={slash.promptIndex}
            onPickModule={askFromModule}
            onPick={(p) => askFromSlash(p.question)}
            onHover={slash.setPromptIndex}
            onClose={() => {
              slash.clearDesk();
              setInput("");
            }}
            onOpenDesk={(href) => router.push(href)}
            native
          />
          <LargoSlashMenu
            open={slash.commandMenuOpen && !loading && hydrated}
            matches={slash.commandMatches}
            activeIndex={slash.commandIndex}
            onPick={(cmd) => {
              slash.applyCommand(cmd);
              inputRef.current?.focus();
            }}
            onHover={slash.setCommandIndex}
            native
          />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => slash.onInputChange(e.target.value)}
            onKeyDown={(e) => {
              const result = slash.handleKeyDown(e);
              if (result === "prompt-pick") {
                if (slash.panelTab === "modules" && slash.highlightedModule) {
                  askFromModule(slash.highlightedModule);
                  return;
                }
                if (slash.highlightedPrompt) {
                  askFromSlash(slash.highlightedPrompt.question);
                  return;
                }
              }
              if (result === "handled") return;
            }}
          onFocus={() => bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" })}
          onBlur={() => window.setTimeout(() => resetIosViewport(), 160)}
          placeholder={loading ? PLACEHOLDER_BUSY : PLACEHOLDER}
          aria-label="Ask Largo"
          className="largo-native-input"
          disabled={loading || !hydrated}
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="off"
            spellCheck={false}
          />
        </div>
        {loading ? (
          <button
            type="button"
            className="largo-native-send largo-native-stop"
            onClick={cancel}
            aria-label="Stop generating"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className="largo-native-send"
            disabled={!hydrated || !input.trim()}
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}
