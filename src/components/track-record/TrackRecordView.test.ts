import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const viewSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "TrackRecordView.tsx"),
  "utf8"
);
const formatSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "format.ts"),
  "utf8"
);

describe("TrackRecordView — admin-only embed route is never advertised as externally embeddable", () => {
  it("does not render an 'Embed on your site' / copy-snippet UI", () => {
    // /embed/track-record has been admin-only (requireAdmin(), see its layout.tsx) since
    // before PR #2836 — it is documented as an admin preview, not a public embed surface
    // (TrackRecordEmbed.tsx's own header comment: "the admin-only `/embed/track-record`
    // iframe preview"). A "Copy snippet" button that hands an admin an iframe pointing at
    // that URL is misleading: any non-admin visitor who loads the pasted snippet on an
    // external site is redirected to the paywall instead of seeing the widget.
    assert.doesNotMatch(viewSource, /Embed on your site/i);
    assert.doesNotMatch(viewSource, /Copy snippet/i);
    assert.doesNotMatch(viewSource, /TRACK_RECORD_EMBED_SNIPPET/);
  });

  it("no longer exports the dead embed snippet constant", () => {
    assert.doesNotMatch(formatSource, /TRACK_RECORD_EMBED_SNIPPET/);
  });
});
