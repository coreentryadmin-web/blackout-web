# Helix desktop table expired DTE — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **What prompted this** | Follow-up to mobile print-card fix (#3558 area): `HelixFlowTable.tsx` shared the same root cause — negative UW `dte` rendered as a bare number in the muted DTE column. |
| **Root cause** | `case "dte"` rendered `{dte}` raw for non-0DTE rows; negative feed values showed as `-1` with no expired treatment. |
| **Fix** | Reuse exported `dtePrintLabel()` from `HelixMobileFlowTape.tsx`; expired rows render `EXPIRED` with ember/bold styling. |
| **Status** | FIXED |
