"use client";

import { useEffect, useState } from "react";
import { createPositionEventSource } from "@/lib/api";

/** SSE-backed live position stream. Returns null until the first payload arrives. */
export function usePositionStream<T = Record<string, unknown>>(): {
  positions: T[] | null;
  sseConnected: boolean;
} {
  const [positions, setPositions] = useState<T[] | null>(null);
  const [sseConnected, setSseConnected] = useState(false);

  useEffect(() => {
    const conn = createPositionEventSource(
      (payload) => {
        setPositions(payload.positions as T[]);
      },
      {
        onOpen: () => setSseConnected(true),
        onClose: () => setSseConnected(false),
      }
    );

    return () => {
      conn?.close();
    };
  }, []);

  return { positions, sseConnected };
}
