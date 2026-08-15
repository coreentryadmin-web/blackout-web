/**
 * Per-ticker localStorage persistence for member chart drawings.
 * Mirrors vector-alerts-store — SSR-safe, silent quota failures, schema filter on read.
 */

import {
  sanitizeDrawing,
  type VectorDrawing,
  type VectorDrawColorId,
} from "./vector-drawings";

const KEY_PREFIX = "vector:drawings:v1:";
const COLOR_KEY = "vector:drawings:color:v1";
const MAX_UNDO = 32;

function keyFor(ticker: string): string {
  return `${KEY_PREFIX}${ticker.toUpperCase()}`;
}

export function loadDrawings(ticker: string): VectorDrawing[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(keyFor(ticker));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeDrawing).filter((d): d is VectorDrawing => d !== null);
  } catch {
    return [];
  }
}

export function saveDrawings(ticker: string, drawings: readonly VectorDrawing[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(ticker), JSON.stringify(drawings));
  } catch {
    /* quota / private mode */
  }
}

export function loadDrawColor(): VectorDrawColorId {
  if (typeof window === "undefined") return "cyan";
  try {
    const v = window.localStorage.getItem(COLOR_KEY);
    return v === "green" || v === "red" || v === "amber" || v === "white" || v === "cyan" ? v : "cyan";
  } catch {
    return "cyan";
  }
}

export function saveDrawColor(color: VectorDrawColorId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLOR_KEY, color);
  } catch {
    /* best effort */
  }
}

/** Undo stack — stores snapshots before each mutating action. */
export class DrawingUndoStack {
  private stack: VectorDrawing[][] = [];

  push(snapshot: readonly VectorDrawing[]): void {
    this.stack.push(snapshot.map((d) => ({ ...d })));
    if (this.stack.length > MAX_UNDO) this.stack.shift();
  }

  pop(): VectorDrawing[] | null {
    const last = this.stack.pop();
    return last ?? null;
  }

  clear(): void {
    this.stack = [];
  }
}
