"use client";

import { clsx } from "clsx";
import type { LargoDepth } from "@/lib/largo/largo-depth";

export function LargoAnswerModeToggle({
  mode,
  onChange,
  disabled = false,
  variant = "toolbar",
  className,
}: {
  mode: LargoDepth;
  onChange: (mode: LargoDepth) => void;
  disabled?: boolean;
  variant?: "toolbar" | "composer";
  className?: string;
}) {
  return (
    <div
      className={clsx("largo-answer-mode", `largo-answer-mode-${variant}`, className)}
      role="group"
      aria-label="Answer mode"
    >
      <button
        type="button"
        className={clsx("largo-answer-mode-btn", mode === "concrete" && "is-active")}
        aria-pressed={mode === "concrete"}
        disabled={disabled}
        title="Concrete — one-line verdict, exact levels, no tour"
        onClick={() => onChange("concrete")}
      >
        Concrete
      </button>
      <button
        type="button"
        className={clsx("largo-answer-mode-btn", mode === "deep" && "is-active")}
        aria-pressed={mode === "deep"}
        disabled={disabled}
        title="Deep dive — full breakdown with sections and invalidation"
        onClick={() => onChange("deep")}
      >
        Deep dive
      </button>
    </div>
  );
}
