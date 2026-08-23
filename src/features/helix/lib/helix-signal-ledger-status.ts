/**
 * Is the signal-outcome ledger EMPTY, or is nothing WRITING it?
 *
 * ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────────────────────────
 *
 * `SignalOutcomeTracker` rendered one branch for zero rows:
 *
 *     title="Collecting data"
 *     description="No velocity-spike or split-flow firings recorded yet this session."
 *
 * Both halves are assertions of fact, and on production both are false. `helix-signal-outcomes` —
 * the cron that runs BOTH `recordHelixSignalFirings()` and `gradeHelixSignalOutcomes()`, so it is
 * the ledger's only writer — is fully registered in `cron-registry.ts` and **absent from the
 * deployed manifest**. Nothing has ever written a row. Meanwhile signals ARE firing: VelocityRadar
 * and SplitFlowRadar render them live, on the same page, in the same rail. So the panel tells a
 * member "nothing has fired yet" directly beside a panel showing things firing, and "Collecting
 * data" claims a collector that is not deployed.
 *
 * An empty ledger and an unwritten ledger look identical from a row count. They are opposite facts:
 * one says the session is quiet, the other says the instrument is off. This module separates them.
 *
 * ── HOW IT KNOWS ────────────────────────────────────────────────────────────────────────────────
 *
 * `cron_job_runs` records every cron tick. A market-hours job on a ~15-minute cadence that exists
 * at all leaves hundreds of rows a week. So over the table's retention window, ZERO rows for the
 * key is not a quiet period — it is the absence of the job.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────────────────────────
 *
 * It does not compute STALENESS. `cron-registry.ts` already owns that (`stale_after_min: 45`,
 * `market_hours_only`, `weekdays_only`), and a second implementation here would be a second
 * statement of one fact — the exact duplication this lane spent today removing. Worse, doing it
 * naively would be wrong: a flat 45-minute bound against a market-hours-only job reports a
 * perfectly healthy writer as stale on every weekend and overnight read. So this answers the one
 * question a row count cannot, and leaves the rest to the surface that already owns it.
 *
 * It also never says "never". The retention window bounds what can be observed, so the verdict is
 * `no_writer_observed` and it carries its own window — a claim about the evidence, not about all
 * of history. Saying "never written" from a table that deletes its own old rows would be the same
 * absence-as-fact mistake one level up.
 */

/** `cron_job_runs` keeps 30 days (`db.ts` prunes on insert). The bound on what absence can mean. */
export const CRON_RUN_OBSERVATION_DAYS = 30;

/** The ledger's only writer — it both records firings and grades them. */
export const SIGNAL_LEDGER_WRITER_JOB_KEY = "helix-signal-outcomes";

export type HelixSignalLedgerStatus =
  /** Rows exist. Nothing to explain; the panel shows them. */
  | { state: "recording" }
  /** The writer has run inside the observation window and the ledger is genuinely empty. This is
   *  the ONLY state in which "no firings recorded yet" is a true sentence. */
  | { state: "awaiting_firings"; lastWriterRunAt: string }
  /** No run of the writer observed in the window. The ledger is not empty — it is unwritten. */
  | { state: "no_writer_observed"; observationWindowDays: number };

export function signalLedgerStatus(input: {
  rowCount: number;
  /** Most recent `cron_job_runs.started_at` for the writer key, or null if there is none. */
  lastWriterRunAt: string | null | undefined;
  observationWindowDays?: number;
}): HelixSignalLedgerStatus {
  // Rows win over everything: if the ledger has content, how it got there is not the panel's
  // question. This also keeps a retention-pruned run history from ever contradicting real data.
  if (Number.isFinite(input.rowCount) && input.rowCount > 0) return { state: "recording" };

  const last = input.lastWriterRunAt;
  if (typeof last === "string" && last.length > 0 && Number.isFinite(Date.parse(last))) {
    return { state: "awaiting_firings", lastWriterRunAt: last };
  }

  return {
    state: "no_writer_observed",
    observationWindowDays: input.observationWindowDays ?? CRON_RUN_OBSERVATION_DAYS,
  };
}

/**
 * What the panel says for each state. Kept here beside the verdict so the wording cannot drift
 * away from the fact it is reporting — the original defect was a description that had outlived
 * the condition it was written for.
 */
export function signalLedgerCopy(status: HelixSignalLedgerStatus): {
  title: string;
  description: string;
} | null {
  switch (status.state) {
    case "recording":
      return null;
    case "awaiting_firings":
      return {
        title: "No firings yet",
        description:
          "The outcome recorder is running and has not seen a velocity-spike or split-flow firing to grade.",
      };
    case "no_writer_observed":
      // Says what is true (no writer run observed), states the bound on that claim, and denies the
      // reading the old copy invited — that the absence of rows meant an absence of signals.
      return {
        title: "Not recording",
        description: `No outcome-recorder run in the last ${status.observationWindowDays} days, so firings are not being persisted or graded. Signals still fire — the Velocity and Split Flow panels show them live — they are simply not being kept.`,
      };
  }
}
