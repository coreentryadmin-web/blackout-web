/**
 * SPX desk spot verdict for full-site / RTH deep audits — mirrors deploy-smoke discipline:
 * honest `available:false` and off-session missing spot must not P0.
 */

export function spxDeskSpotSeverity({ spot, available, inCashRthSession }) {
  if (available === false) {
    return { severity: "skip", detail: "available:false (route up; honest empty desk)" };
  }
  if (!inCashRthSession && !(Number(spot) > 0)) {
    return { severity: "skip", detail: "off-hours — live SPX spot not required for audit" };
  }
  if (!(Number(spot) > 0)) {
    return { severity: "P0", detail: `spot missing or invalid: ${spot}` };
  }
  return { severity: "ok", detail: String(spot) };
}
