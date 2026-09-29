import { notifyOpsDiscord } from "@/features/spx/lib/spx-play-notify";

/**
 * Fire-and-forget ops alert for a nighthawk_candidate_snapshot write failure (Night Hawk Legacy
 * Signal Intelligence capture). PURELY OBSERVATIONAL: every call site invokes this from INSIDE a
 * `.catch()` block that has already swallowed the original error — this function only decides
 * whether a human gets notified about a failure that has already happened and already been
 * absorbed. It cannot run before, during, or in place of any discovery/scoring/ranking/gating/
 * publishing step, and it never throws (notifyOpsDiscord's own promise is caught and discarded).
 *
 * WHY THIS EXISTS (2026-09-20 audit): every existing write call site already fails soft by
 * design (`void insertNighthawkCandidateSnapshots(...).catch(err => console.warn(...))`) — correct,
 * since a snapshot hiccup must never block a real edition build. But a real future failure (DB
 * timeout, pool exhaustion, a malformed row) would previously be visible ONLY in ECS logs nobody
 * is watching. This adds the same ops-Discord visibility the edition build's own hard-failure path
 * already has (see buildEveningEdition's `notifyOpsDiscord({severity:"critical", title:"Night Hawk
 * edition build FAILED..."})`), scoped one severity level down since a snapshot-only failure never
 * affects what members see.
 */
export function alertCandidateSnapshotWriteFailure(stage: string, editionFor: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  void notifyOpsDiscord({
    severity: "warning",
    title: `Night Hawk candidate-snapshot write failed — ${stage} (${editionFor})`,
    body: `stage=${stage}\nedition_for=${editionFor}\nerror: ${message}`,
  }).catch(() => undefined);
}
