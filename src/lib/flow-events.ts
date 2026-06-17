import type { FlowRow } from "@/lib/db";

type Listener = (flow: FlowRow) => void;

const listeners = new Set<Listener>();

export function subscribeFlowEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishFlowEvent(flow: FlowRow): void {
  listeners.forEach((listener) => {
    try {
      listener(flow);
    } catch {
      /* ignore */
    }
  });
}
