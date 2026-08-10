"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeSpokenQuestion } from "@/lib/largo/core/spoken-text";

/**
 * PUSH-TO-TALK DICTATION for the Largo composer.
 *
 * Uses the browser's own SpeechRecognition — no backend, no audio upload, no per-minute API cost,
 * and the audio never leaves the device. For "type a question into a box" that is the right trade:
 * a server STT would add latency and a bill to something the platform already has for free.
 *
 * BROWSER SUPPORT IS PARTIAL AND THAT IS FINE. Chrome, Edge and Safari implement it; Firefox does
 * not. `supported` is false there and the button is simply not rendered — a mic that does nothing
 * is worse than no mic. This is an input convenience, never the only way to ask.
 *
 * WHY THE TRANSCRIPT IS POST-PROCESSED. Generic speech models mangle exactly the words this
 * product runs on: "NVDA" comes back as "in video", "SPX" as "S and P X", "0DTE" as "zero D T E".
 * A raw transcript would send `extractTicker` looking for an instrument nobody named — the same
 * class of failure as the `$NOW` hijack. normalizeSpokenQuestion repairs those against the real
 * ticker set before the text reaches the box, where the member can still see and edit it.
 */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type Dictation = {
  supported: boolean;
  listening: boolean;
  /** Set when the mic is blocked or unavailable — surfaced so a dead button is never silent. */
  error: string | null;
  start: () => void;
  stop: () => void;
};

export function useDictation(onTranscript: (text: string) => void): Dictation {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  // Kept in a ref so restarting dictation never captures a stale setInput closure.
  const cbRef = useRef(onTranscript);
  cbRef.current = onTranscript;

  // Detected after mount: `window` does not exist during SSR, and rendering the button on the
  // server then removing it on hydration would flash a control that may not work.
  useEffect(() => setSupported(recognitionCtor() != null), []);

  const stop = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    setError(null);
    try {
      const rec = new Ctor();
      rec.lang = "en-US";
      rec.continuous = false;
      // Interim results let the box fill as the member speaks, so a mis-hear is visible
      // immediately rather than after they stop talking.
      rec.interimResults = true;

      rec.onresult = (e) => {
        let text = "";
        for (let i = 0; i < e.results.length; i++) text += e.results[i]?.[0]?.transcript ?? "";
        cbRef.current(normalizeSpokenQuestion(text));
      };
      rec.onerror = (e) => {
        // "no-speech" is someone tapping the mic and saying nothing — not worth an error message.
        const code = e?.error ?? "unknown";
        if (code !== "no-speech" && code !== "aborted") {
          setError(
            code === "not-allowed" || code === "service-not-allowed"
              ? "Microphone blocked — allow mic access in your browser settings."
              : "Dictation stopped unexpectedly. Type instead, or try again."
          );
        }
        setListening(false);
      };
      rec.onend = () => setListening(false);

      recRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setError("Dictation could not start. Type instead.");
      setListening(false);
    }
  }, []);

  // Never leave the mic open when the composer unmounts.
  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, error, start, stop };
}
