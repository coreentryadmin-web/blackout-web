"use client";

import { clsx } from "clsx";
import { useDictation } from "@/hooks/useDictation";
import { motion, AnimatePresence } from "framer-motion";
import { ImagePlus, Mic, Square, X } from "lucide-react";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useIosKeyboardInset } from "@/hooks/useIosKeyboardInset";
import { useLargoSlashCommands } from "@/hooks/useLargoSlashCommands";
import { resolveLargoSlashSubmit } from "@/lib/largo/slash-commands";
import {
  LARGO_SUGGESTIONS,
  largoToolLabel,
  useLargoChat,
} from "@/hooks/useLargoChat";
import { Panel, PanelHeader, FreshnessChip, Button } from "@/components/ui";
import { LargoThinkingState } from "./LargoThinkingState";
import { LargoMessageBody } from "./LargoMessageBody";
import { LargoAnswerMessage } from "./LargoAnswerMessage";
import { LargoTerminalToolbar } from "./LargoTerminalToolbar";
import { LargoEmptyState } from "./LargoEmptyState";
import { LargoDeskModulePicker } from "./LargoDeskModulePicker";
import { largoModuleComposerDesks } from "@/lib/largo/largo-module-starter-cards";
import { LargoStatusStrip } from "./LargoStatusStrip";
import { LargoContextRail } from "./LargoContextRail";
import { LargoSlashMenu } from "./LargoSlashMenu";
import { LargoSlashPromptsMenu } from "./LargoSlashPromptsMenu";
import { LargoDeskScopeBanner } from "./LargoDeskScopeBanner";
import { LargoProactiveComposer } from "./LargoProactiveComposer";
import { LargoAnswerModeToggle } from "./LargoAnswerModeToggle";
import { parseDeskSlashArgs } from "@/lib/largo/desk-scope";
import { formatLargoScopePrefill } from "@/lib/largo/largo-module-starter-cards";
import { slashArgsFromInput } from "@/lib/largo/slash-prompt-utils";
import type { LargoScopePick, LargoStarterPick } from "@/lib/largo/largo-module-starter-cards";
import type { DeskSlashArgs } from "@/lib/largo/desk-scope";
import type { LargoSlashCommand } from "@/lib/largo/slash-commands";
import type { SlashSubmoduleItem } from "@/lib/largo/slash-submodules";

const INPUT_PLACEHOLDER = "Type / for desk commands — SPX, flow, thermal, vector…";
const INPUT_PLACEHOLDER_BUSY = "Pulling live data…";

export function LargoTerminal({
  fullPage = false,
  nativeShell = false,
  onToggleFullscreen,
  isFullscreen = false,
  fullscreenSupported = false,
}: {
  fullPage?: boolean;
  /** Passed from LargoPageShell when iOS native chrome is active. */
  nativeShell?: boolean;
  /** Full-screen controls, owned by LargoPageShell (which holds the shell ref). */
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
  fullscreenSupported?: boolean;
}) {
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
    conversations,
    activeSessionId,
    canRegenerate,
    bottomRef,
    runQuery,
    cancel,
    regenerate,
    newConversation,
    switchConversation,
    isFresh,
    activeTicker,
    attachments,
    attachError,
    addAttachments,
    removeAttachment,
    depth,
    setAnswerMode,
    toggleDepth,
    historicalMode,
    toggleHistoricalMode,
    chartGuide,
    setChartGuide,
    activeDeskScope,
    setActiveDeskScope,
    activeDeskScopeArgs,
    setActiveDeskScopeArgs,
  } = useLargoChat();

  const router = useRouter();
  const slash = useLargoSlashCommands(input, setInput, (q, scope) =>
    void runQuery(q, { deskScope: scope?.deskScope, deskScopeArgs: scope?.deskScopeArgs })
  );
  const inputRef = useRef<HTMLInputElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // Whatever was already typed when the mic opened. SpeechRecognition re-sends the WHOLE
  // transcript on every interim result, so without this the dictated words would overwrite a
  // half-typed question instead of continuing it.
  const dictationBaseRef = useRef("");
  const dictation = useDictation((text) => {
    const base = dictationBaseRef.current.trim();
    setInput(base ? `${base} ${text}` : text);
  });

  useIosKeyboardInset(nativeShell);

  function applyScope(pick: LargoScopePick) {
    setActiveDeskScope(pick.deskScope);
    setActiveDeskScopeArgs(pick.deskScopeArgs ?? null);
    const prefill =
      pick.prefill ??
      formatLargoScopePrefill(pick.deskScope, pick.deskScopeArgs?.submodule ?? null);
    setInput(prefill);
    inputRef.current?.focus();
  }

  function askScoped(pick: LargoStarterPick) {
    void runQuery(pick.question, {
      deskScope: pick.deskScope,
      deskScopeArgs: pick.deskScopeArgs,
    });
    setInput("");
  }

  function askFromSlash(
    question: string,
    cmd?: LargoSlashCommand | null,
    submodule?: string | null
  ) {
    const desk = cmd ?? slash.activeDesk;
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
    askFromSlash(mod.exampleQuestion, slash.activeDesk, mod.id);
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
    void runQuery(resolved.text, {
      deskScope: activeDeskScope,
      deskScopeArgs: activeDeskScopeArgs,
    });
    setInput("");
    slash.clearDesk();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    submitSlashOrQuery(input);
  }

  /**
   * Paste is the primary path, not the file picker. Screenshot → Cmd/Ctrl+V into the box is what
   * people already do everywhere else, so the composer honours it directly rather than making them
   * find a button. Text pastes fall through untouched.
   */
  function handlePaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    void addAttachments(files);
  }

  return (
    <Panel
      accent="accent"
      strip={!fullPage}
      header={
        fullPage ? undefined : (
          <PanelHeader
            kicker="Desk AI"
            title="Largo Terminal"
            actions={
              loading ? undefined : hydrated ? <FreshnessChip status="live" /> : undefined
            }
          >
            <p className="mt-1 text-sm text-secondary">Grounded in live platform data</p>
          </PanelHeader>
        )
      }
      className={clsx(
        "flex flex-col largo-chat-shell",
        fullPage ? "largo-terminal-fullpage" : "min-h-[560px]",
        nativeShell && fullPage && "largo-terminal-native",
        loading && "largo-chat-shell-processing"
      )}
      bodyClassName="flex flex-1 flex-col min-h-0 !p-0 desk-panel-body-bare"
    >
      <div className="flex-1 flex flex-col min-h-0 largo-chat-container">
        {/* Thin intelligence strip, full-page only: on the compact panel it would take a third of
            the visible height to say something the member did not ask for. */}
        {fullPage && <LargoStatusStrip />}
        {fullPage && (
          <LargoTerminalToolbar
            conversations={conversations}
            activeSessionId={activeSessionId}
            onSwitch={(id) => void switchConversation(id)}
            onNew={newConversation}
            onRegenerate={regenerate}
            canRegenerate={canRegenerate}
            loading={loading}
            depth={depth}
            onSetDepth={setAnswerMode}
            historicalMode={historicalMode}
            onToggleHistorical={toggleHistoricalMode}
            onToggleFullscreen={onToggleFullscreen ?? (() => {})}
            isFullscreen={isFullscreen}
            fullscreenSupported={fullscreenSupported}
          />
        )}
        {/* Rail + transcript. The rail is a SIBLING, not an overlay: it must not cover the answer
            it is context for, and it appears only once the server has resolved an instrument, so
            screen width is never permanently spent on an empty column. */}
        <div className={clsx("largo-main", activeTicker && "largo-main-railed")}>
        <div
          role="log"
          aria-live="polite"
          aria-atomic="false"
          className={clsx(
            "flex-1 overflow-y-auto flex flex-col gap-4 mb-4 pr-2 largo-messages-scroll",
            fullPage ? "largo-messages-fullpage" : "max-h-[420px]",
            isFresh && !loading && "justify-center"
          )}
        >
          <AnimatePresence initial={false}>
            {messages.map((msg, idx) => (
              <motion.div
                key={msg.id}
                initial={
                  msg.role === "user"
                    ? { opacity: 0, x: 18, scale: 0.98 }
                    : { opacity: 0, y: 14, scale: 0.98 }
                }
                animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className={clsx(
                  "largo-msg-bubble",
                  msg.role === "user" ? "desk-largo-user largo-msg-user" : "desk-largo-assistant largo-msg-assistant",
                  msg.id === "welcome" && "largo-msg-welcome"
                )}
              >
                <p className="largo-msg-label">
                  {msg.role === "user" ? "You" : "Largo"}
                </p>
                {msg.role === "assistant" ? (
                  msg.id === "welcome" ? (
                    // Welcome intro stays plain — nothing to structure.
                    <LargoMessageBody
                      content={msg.content}
                      className={fullPage ? "text-sm md:text-[15px] lg:text-base" : "text-sm"}
                    />
                  ) : (
                    // Rich structured rendering; streams as markdown then swaps to the
                    // structured card once the full answer is in (idx === last & loading).
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
                      className={fullPage ? "text-sm md:text-[15px] lg:text-base" : "text-sm"}
                      onFollowup={(q) =>
                        void runQuery(q, {
                          deskScope: activeDeskScope,
                          deskScopeArgs: activeDeskScopeArgs,
                        })
                      }
                      followups={msg.followups}
                      deskScope={msg.deskScope}
                      deskScopeArgs={msg.deskScopeArgs}
                      miniPanel={msg.miniPanel}
                      ticker={activeTicker}
                      answerMode={msg.depth === "deep" ? "deep" : "concrete"}
                    />
                  )
                ) : (
                  <>
                    {/* What was actually sent, shown in the member's own turn. Without this the
                        transcript reads as a bare question and there is no way to tell which chart
                        an answer was about once a few turns have gone by. */}
                    {msg.images && msg.images.length > 0 && (
                      <div className="largo-msg-images">
                        {msg.images.map((src, i) => (
                          // eslint-disable-next-line @next/next/no-img-element -- client-side blob/data URL
                          <img key={i} src={src} alt={`Attached image ${i + 1}`} />
                        ))}
                      </div>
                    )}
                    {msg.content && (
                      <p
                        className={clsx(
                          "largo-msg-text leading-relaxed whitespace-pre-wrap",
                          fullPage ? "text-sm md:text-[15px] lg:text-base" : "text-sm"
                        )}
                      >
                        {msg.content}
                      </p>
                    )}
                  </>
                )}
                {msg.role === "assistant" && msg.tools && msg.tools.length > 0 && (
                  <div className="largo-tools-used">
                    {msg.tools.map((t) => (
                      <span key={t} className="largo-tool-chip">
                        {largoToolLabel(t)}
                      </span>
                    ))}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {isFresh && !loading && hydrated && fullPage && (
            <LargoEmptyState onScope={applyScope} onAsk={askScoped} />
          )}

          {isFresh && !loading && hydrated && !fullPage && (
            <motion.div
              className="largo-suggestions"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
            >
              <LargoDeskModulePicker
                variant="compact"
                desks={largoModuleComposerDesks()}
                onScope={applyScope}
                onAsk={askScoped}
              />
            </motion.div>
          )}

          <AnimatePresence mode="wait">
            {loading && (awaitingFirstToken || !streaming) && (
              <div className="largo-msg-bubble largo-thinking-wrap">
                <LargoThinkingState
                  key="largo-thinking"
                  tools={activeTools}
                  statusMessage={statusMessage}
                />
              </div>
            )}
          </AnimatePresence>
          <div ref={bottomRef} />
        </div>
        {fullPage && <LargoContextRail ticker={activeTicker} />}
        </div>

        {/* Staged attachments sit ABOVE the input, not inside it: the member must be able to see
            exactly what is about to be sent, and remove one, before committing the question. */}
        {(chartGuide || attachments.length > 0) && (
          <p className="largo-chart-guide px-2">
            Chart attached — ask: &quot;Where is invalidation on this setup?&quot; or &quot;What levels matter?&quot;
            <button type="button" className="ml-2 text-cyan-400 underline" onClick={() => setChartGuide(false)}>
              Dismiss
            </button>
          </p>
        )}

        <LargoProactiveComposer
          disabled={loading || !hydrated}
          onAsk={(q) => void runQuery(q)}
        />

        {!fullPage && (
          <LargoAnswerModeToggle
            mode={depth}
            onChange={setAnswerMode}
            disabled={loading || !hydrated}
            variant="composer"
          />
        )}

        <LargoDeskScopeBanner
          deskScope={activeDeskScope}
          submodule={activeDeskScopeArgs?.submodule}
          ticker={activeTicker}
          onClear={() => {
            setActiveDeskScope(null);
            setActiveDeskScopeArgs(null);
          }}
        />

        {(attachments.length > 0 || attachError) && (
          <div className="largo-attach-tray">
            {attachments.map((a, i) => (
              <div key={`${a.name}-${i}`} className="largo-attach-chip">
                {/* eslint-disable-next-line @next/next/no-img-element -- a client-side blob/data URL
                    from the member's own clipboard; next/image is for server-known remote assets. */}
                <img src={a.previewUrl} alt={`Attachment ${i + 1}: ${a.name}`} />
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  aria-label={`Remove ${a.name}`}
                  className="largo-attach-remove"
                >
                  <X size={11} aria-hidden />
                </button>
                <span className="largo-attach-size">{Math.max(1, Math.round(a.bytes / 1024))}KB</span>
              </div>
            ))}
            {attachError && (
              <span role="alert" className="largo-attach-error">
                {attachError}
              </span>
            )}
          </div>
        )}

        {/* Dictation status — ABOVE the composer, in normal flow.
            Reported symptom: "I click the mic and nothing happens." Three causes, all fixed here
            and in useDictation:
              1. The two MOST LIKELY error codes — `no-speech` and `aborted` — were swallowed
                 entirely, so the commonest outcome of a click produced no message at all.
              2. What did render was 10px text, absolutely positioned at `top: 100%` of the input
                 wrapper, overlapping the page footer. (I first assumed it was painted off-screen;
                 the browser test disproved that — it is in the viewport, just easy to miss.)
              3. The only "listening" cue was the button's own colour, so an error arriving within
                 milliseconds produced an imperceptible flash — indistinguishable from a dead
                 control.
            A status row in normal flow, with an explicit Listening line, fixes all three. */}
        {(dictation.listening || dictation.error) && (
          <div
            role="status"
            aria-live="assertive"
            className={clsx("largo-mic-status", dictation.error && "largo-mic-status-error")}
          >
            {dictation.listening ? (
              <>
                <span className="largo-mic-status-dot" aria-hidden />
                Listening — speak now, then tap the mic to stop.
              </>
            ) : (
              dictation.error
            )}
          </div>
        )}

        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions --
            drag-and-drop is inherently pointer-only; the keyboard-accessible equivalent is the
            attach button below, so no path is lost by the drop handlers living on the form. */}
        <form
          onSubmit={submit}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (!e.dataTransfer.files?.length) return;
            e.preventDefault();
            setDragging(false);
            void addAttachments(e.dataTransfer.files);
          }}
          className={clsx(
            "desk-largo-input-row largo-input-form !border-cyan-400/15",
            fullPage && "largo-input-form-fullpage",
            dragging && "largo-input-form-dragging"
          )}
        >
          <div className="relative flex-1 largo-input-wrap">
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
              onPick={(p) => askFromSlash(p.question, slash.activeDesk)}
              onHover={slash.setPromptIndex}
              onClose={() => {
                slash.clearDesk();
                setInput("");
              }}
              onOpenDesk={(href) => router.push(href)}
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
              onPaste={handlePaste}
              placeholder={loading ? INPUT_PLACEHOLDER_BUSY : INPUT_PLACEHOLDER}
              aria-label="Ask Largo"
              aria-autocomplete={slash.commandMenuOpen || slash.activeDesk ? "list" : undefined}
              aria-controls={slash.activeDesk ? "largo-slash-prompts" : slash.commandMenuOpen ? "largo-slash-menu" : undefined}
              className={clsx(
                "desk-largo-input w-full !border-cyan-400/25",
                loading && "largo-input-busy",
                !input && !loading && hydrated && "largo-input-idle",
                fullPage && "largo-input-fullpage"
              )}
              disabled={loading || !hydrated}
            />
            {!input && !loading && hydrated && !nativeShell && (
              <span className="largo-input-placeholder" aria-hidden>
                <span className="largo-input-placeholder-marquee">{INPUT_PLACEHOLDER}</span>
              </span>
            )}
            {loading && (
              <span className="largo-input-placeholder" aria-hidden>
                <span className="largo-input-placeholder-marquee">{INPUT_PLACEHOLDER_BUSY}</span>
              </span>
            )}
          </div>
          {/* Explicit attach control. Paste and drag both work, but neither is discoverable, and a
              feature nobody finds is a feature that does not exist. */}
          {!loading && hydrated && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                multiple
                className="sr-only"
                onChange={(e) => {
                  if (e.target.files?.length) void addAttachments(e.target.files);
                  // Reset so re-selecting the SAME file fires change again.
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach a chart or screenshot"
                title="Attach a chart or screenshot"
                className="largo-attach-btn"
              >
                <ImagePlus size={14} aria-hidden />
              </button>
            </>
          )}
          {/*
            Push-to-talk. Rendered in EVERY browser, including those without SpeechRecognition
            (Firefox; Brave disables it) — hiding it made the feature look unbuilt rather than
            unavailable, so an unsupported browser gets the button plus a sentence naming the
            remedy. Hidden only while a query is in flight: the input is disabled then, so there
            is nowhere for the transcript to land.
          */}
          {!loading && hydrated && (
            <button
              type="button"
              onClick={() => {
                if (dictation.listening) {
                  dictation.stop();
                  return;
                }
                dictationBaseRef.current = input;
                void dictation.start();
              }}
              aria-label={dictation.listening ? "Stop dictation" : "Ask by voice"}
              aria-pressed={dictation.listening}
              title={dictation.unsupportedReason ?? (dictation.listening ? "Listening — tap to stop" : "Ask by voice")}
              className={clsx(
                "largo-mic-btn",
                dictation.listening && "largo-mic-btn-live",
                !dictation.supported && "largo-mic-btn-unsupported"
              )}
            >
              <Mic size={14} aria-hidden />
            </button>
          )}
          {loading && (
            <button
              type="button"
              onClick={cancel}
              aria-label="Stop generating"
              className="largo-stop-btn"
            >
              <Square size={13} aria-hidden fill="currentColor" />
              <span className="largo-stop-btn-label">Stop</span>
            </button>
          )}
          <Button
            type="submit"
            variant="ghost"
            size="md"
            disabled={loading || !hydrated || (!input.trim() && attachments.length === 0)}
            className={clsx(
              "rounded-none font-syne text-xs uppercase tracking-[0.2em]",
              "!bg-cyan-400/12 !border-cyan-400/40 !text-cyan-300",
              "hover:!bg-cyan-400/20 hover:!border-cyan-400/60",
              "shadow-[0_0_20px_-6px_rgba(34,211,238,0.5)]",
              nativeShell && "!rounded-xl !min-h-[2.75rem] !px-4 largo-send-btn-native"
            )}
          >
            {loading ? (
              <span className="largo-send-pulse">
                <span className="largo-send-dot" />
                WORKING
              </span>
            ) : (
              "Send"
            )}
          </Button>
        </form>
      </div>
    </Panel>
  );
}
