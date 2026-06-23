import type { FlowRow } from "@/lib/db";

/**
 * Wire envelope for cross-instance flow fan-out over Redis pub/sub.
 *
 * The publishing instance stamps its own per-process INSTANCE_ID under `__origin`.
 * When the message loops back to the SAME instance's subscriber (Redis PUBLISH
 * delivers to all subscribers, including the publisher), decodeFlowMessage returns
 * null so we do NOT fan out a second time — publishFlowEvent already fanned it out
 * locally. Messages from OTHER instances — and bare flows from older publishers that
 * predate this envelope (rolling deploy) — are fanned out exactly once.
 *
 * `__origin` is stripped before the FlowRow reaches listeners so it never leaks to
 * SSE/JSON consumers.
 */
type OriginEnvelope = Record<string, unknown> & { __origin?: unknown };

export function encodeFlowMessage(originId: string, flow: FlowRow): string {
  return JSON.stringify({ ...flow, __origin: originId });
}

export function decodeFlowMessage(message: string, myId: string): FlowRow | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as OriginEnvelope;

  // Our own loopback — already fanned locally by publishFlowEvent. Skip BEFORE any
  // counting so cross-instance metrics exclude self-delivery.
  if (typeof obj.__origin === "string" && obj.__origin === myId) return null;

  // Strip __origin so it never leaks to SSE clients. Bare flows from an older
  // publisher (no __origin) are treated as foreign and fanned exactly once.
  const rest: Record<string, unknown> = { ...obj };
  delete rest.__origin;

  return typeof rest.ticker === "string" && rest.ticker ? (rest as unknown as FlowRow) : null;
}
