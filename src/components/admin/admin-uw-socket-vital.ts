// REGRESSION (DISCOVERY sweep round 178): `AdminOperationsDashboard`'s "System Vitals" panel used
// to compute its UW Socket row's label from `initialized` alone
// (`initialized ? "Live" : "Offline"`) while computing the row's `ok` dot from the stricter
// `initialized && !auth_failed`. Once a channel entered the `auth_failed` state (socket
// connected, but UW rejected the subscription — e.g. a bad/rotated API key), the row rendered the
// word "Live" right next to a red, pulsing "not ok" dot — an operator glancing at the tile sees a
// contradiction instead of the actual problem. The sibling `DataPipelineHealthTile`'s own "UW
// Socket" row (same file, "UW Multiplex" panel) already gets this right:
// `initialized ? (auth_failed ? "Auth Failed" : "Live") : "Offline"`.
//
// `uwSocketVitalDisplay` is the extracted, pure derivation both the label and the dot now read
// from, mirroring that same precedence for the System Vitals row. It lives in its own
// non-component module (like `admin-time-ago.ts`/`admin-store-age.ts`) so it can be unit tested
// without pulling the whole dashboard's component tree (charts, marks, etc.) into the test.
export function uwSocketVitalDisplay(
  uw: { initialized: boolean; auth_failed: boolean } | null | undefined
): { value: string; ok: boolean | null } {
  if (uw == null) return { value: "—", ok: null };
  if (!uw.initialized) return { value: "Offline", ok: false };
  if (uw.auth_failed) return { value: "Auth Failed", ok: false };
  return { value: "Live", ok: true };
}
