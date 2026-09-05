# Largo contextual rail API missing roundFloats boundary

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P2-0107 |
| **Status** | FIXED |
| **Severity** | P2 |
| **Area** | Largo contextual rail (`GET /api/market/largo/context`) |

## Symptom

Member-facing Largo contextual rail returned live market numbers (`spot`, walls, `gamma_flip`, `max_pain`, `net_premium`, `flow_top_print_share`) without `roundFloats` at the API boundary. Flow fields are computed inline from `validateFlowTape()` with raw premium sums — susceptible to IEEE-754 artifacts like `7499.360000000001`.

## Fix

Wrap `NextResponse.json` payload with `roundFloats()` — same pattern as sibling market routes.

## Tests

- `src/app/api/market/largo/context/route.test.ts` — source scan for roundFloats boundary.
