// Availability verdict — pure grading for largo-availability-probe.mjs.
//
// The instrument is a model, so a decline is only a DEFECT when the data was provably present.
// This helper separates the three cases so the probe never reports a decline-on-genuinely-absent
// data as a bug, and never reports a missing independent proof as a pass.

/** The literal shapes the Largo query pipeline emits when it gives up on a turn. */
const DECLINE_PATTERNS = [
  /couldn't pull enough live data/i,
  /couldn.t pull enough live data/i,
  /internal error before I could finish/i,
  /desk tools did not complete cleanly/i,
];

/** True when the answer text is one of the pipeline's give-up messages, not a real answer. */
export function isDecline(answer) {
  const s = String(answer ?? "");
  if (!s.trim()) return true; // an empty answer is a decline in effect
  return DECLINE_PATTERNS.some((re) => re.test(s));
}

/**
 * Grade one probe case.
 *   'DECLINED_WITH_DATA' — Largo declined while the tool that answers it reported the data present.
 *                          This is the defect: answerable question, refused.
 *   'ANSWERED_OK'        — Largo answered and the data was present.
 *   'INDETERMINATE'      — the data was NOT independently confirmed present, so a decline here may
 *                          be honest absence; not graded as a pass or a defect.
 */
export function gradeAvailability({ id, question, dataPresent, proofValue, answer, tools } = {}) {
  const declined = isDecline(answer);
  let verdict;
  if (!dataPresent) verdict = "INDETERMINATE";
  else if (declined) verdict = "DECLINED_WITH_DATA";
  else verdict = "ANSWERED_OK";
  return {
    id,
    question,
    dataPresent: !!dataPresent,
    proofValue: proofValue ?? null,
    declined,
    tools: Array.isArray(tools) ? tools : [],
    answer: String(answer ?? ""),
    verdict,
  };
}
