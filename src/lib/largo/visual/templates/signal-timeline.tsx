/**
 * SIGNAL TIMELINE — the sequence, as the whole card.
 *
 * NOT A SUBSET OF TRADE_RECAP. TRADE_RECAP uses a timeline as ONE block among entry, exit and P&L,
 * so it is compressed to three or four steps and subordinate to the return. Here the sequence IS
 * the argument — "the flip broke at 10:02, the wall thinned at 10:14, the sweep landed at 10:31" —
 * and it gets the full canvas, more steps, and detail lines that a recap has no room for.
 *
 * The distinction matters because the two answer different questions. "How did this trade do" ends
 * in a number. "What happened, in what order" ends in a shape, and the honest answer to the second
 * is sometimes "these three things happened and no trade came out of it" — which TRADE_RECAP
 * cannot render at all, because its sufficiency gate requires a committed entry.
 *
 * EVERY STEP CARRIES A REAL TIMESTAMP. That is enforced upstream in `timelineFromLedgerRow`, which
 * drops any step whose stamp does not parse, so there is no placeholder branch here. A timeline
 * with an invented time is the single most citable-looking fabrication this renderer could emit.
 *
 * FOUR STEPS MINIMUM (see the router). Three events is a lifecycle and TRADE_RECAP already draws
 * it better; devoting a whole card to three rows is padding.
 */

import type { ReactElement } from "react";
import { C, FONT } from "../tokens";
import type { SizeSpec } from "../sizes";
import { s } from "../sizes";
import type { ManifestRecorder } from "../manifest";
import type { VisualBundle } from "../types";
import { CardFooter, CardHeader, CardShell, Headline, Kicker, Timeline } from "../primitives";

export function SignalTimelineCard({
  bundle,
  spec,
  recorder,
  asOfLabel,
}: {
  bundle: VisualBundle;
  spec: SizeSpec;
  recorder: ManifestRecorder;
  asOfLabel: string | null;
}): ReactElement {
  const steps = bundle.timeline ?? [];
  // The whole canvas means more steps than a recap's three — but still bounded, because a card
  // that scrolls off its own footer loses the disclaimer (see CardShell).
  const shown = steps.slice(0, spec.dense ? 6 : spec.stack ? 9 : 7);

  const first = shown[0];
  const last = shown[shown.length - 1];
  const span = first && last && first.time !== last.time ? `${first.time} → ${last.time}` : (first?.time ?? null);
  if (span) recorder.value("Window", span, "NIGHT HAWK");

  const children: (ReactElement | null)[] = [
    <CardHeader
      key="h"
      systems={bundle.systemsQueried}
      asOfLabel={asOfLabel}
      freshness={bundle.freshness}
      spec={spec}
    />,

    <div
      key="t"
      style={{
        display: "flex",
        flexDirection: "column",
        marginTop: s(20, spec),
      }}
    >
      <Kicker
        text={span ? `Sequence · ${span}${bundle.ticker ? ` · ${bundle.ticker}` : ""}` : "Sequence"}
        spec={spec}
        color={C.info}
      />
      <div style={{ display: "flex", marginTop: s(10, spec) }}>
        <Headline text={bundle.headline ?? "How it developed"} spec={spec} />
      </div>
      {bundle.summary && (
        <div
          style={{
            display: "flex",
            fontFamily: FONT.mono,
            fontSize: s(18, spec),
            color: C.muted,
            marginTop: s(8, spec),
          }}
        >
          {bundle.summary}
        </div>
      )}
    </div>,

    <div key="tl" style={{ display: "flex", width: "100%", marginTop: s(24, spec) }}>
      <Timeline steps={shown} spec={spec} recorder={recorder} />
    </div>,

    // Truncation is stated, never silent — the same "no silent caps" rule the discovery probes
    // follow. A reader must be able to tell "this is what happened" from "this is the first seven".
    steps.length > shown.length ? (
      <div key="more" style={{ display: "flex", marginTop: s(6, spec) }}>
        <Kicker text={`First ${shown.length} of ${steps.length} recorded events`} spec={spec} />
      </div>
    ) : null,
  ];

  return (
    <CardShell spec={spec} footer={<CardFooter attribution="Recorded event sequence" spec={spec} />}>
      {children.filter(Boolean) as ReactElement[]}
    </CardShell>
  );
}
