"use client";

import { clsx } from "clsx";
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { LargoMessageBody } from "@/features/largo/components/LargoMessageBody";
import { LargoAnswerMessage } from "@/features/largo/components/LargoAnswerMessage";
import { LargoThinkingState } from "@/features/largo/components/LargoThinkingState";
import { resetIosViewport } from "@/hooks/useIosKeyboardInset";
import { LARGO_DESK_PROMPTS, largoToolLabel, useLargoChat } from "@/hooks/useLargoChat";
import { useLargoSlashCommands } from "@/hooks/useLargoSlashCommands";
import { resolveLargoSlashSubmit } from "@/lib/largo/slash-commands";
import { LargoStatusStrip } from "@/features/largo/components/LargoStatusStrip";
import { LargoSlashMenu } from "@/features/largo/components/LargoSlashMenu";

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
    followups,
    activeTools,
    statusMessage,
    awaitingFirstToken,
    bottomRef,
    runQuery,
    cancel,
    newConversation,
    isFresh,
    activeSessionId,
  } = useLargoChat();

  const router = useRouter();
  const slash = useLargoSlashCommands(input, setInput);
  const inputRef = useRef<HTMLInputElement>(null);

  function submitSlashOrQuery(text: string) {
    const resolved = resolveLargoSlashSubmit(text);
    if (resolved.type === "navigate") {
      router.push(resolved.href);
      setInput("");
      return;
    }
    if (resolved.type === "query") {
      void runQuery(resolved.question);
      setInput("");
      return;
    }
    void runQuery(resolved.text);
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
                  onFollowup={(q) => void runQuery(q)}
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
            <p className="largo-native-suggestions-label">Try asking</p>
            {LARGO_DESK_PROMPTS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="largo-native-suggestion"
                onClick={() => void runQuery(p.question)}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {!isFresh && !loading && followups.length > 0 && (
          <div className="largo-native-suggestions">
            <p className="largo-native-suggestions-label">Ask next</p>
            {followups.map((s) => (
              <button
                key={s}
                type="button"
                className="largo-native-suggestion"
                onClick={() => void runQuery(s)}
              >
                {s}
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

      <form
        className="largo-native-composer"
        onSubmit={(e) => {
          e.preventDefault();
          submitSlashOrQuery(input);
        }}
      >
        <div className="largo-native-input-wrap">
          <LargoSlashMenu
            open={slash.open && !loading && hydrated}
            matches={slash.matches}
            activeIndex={slash.activeIndex}
            onPick={(cmd) => {
              slash.applyCommand(cmd, true);
              inputRef.current?.focus();
            }}
            onHover={slash.setActiveIndex}
            native
          />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => slash.onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (slash.handleKeyDown(e)) return;
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
