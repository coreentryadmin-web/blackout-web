import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { legacyPublishFieldsFrom } from "./legacy-publish-fields";

describe("legacy-publish-fields", () => {
  test("reads flat PR-N4 publish_context pins", () => {
    const fields = legacyPublishFieldsFrom({
      publish_context: {
        entry_premium: 12.85,
        options_play: "DELL $490 CALL @ $12.85 — Sep 4",
        exit_style: "scale_out",
      },
    });
    assert.equal(fields.entry_premium, 12.85);
    assert.match(fields.options_play ?? "", /DELL \$490 CALL/);
    assert.equal(fields.exit_style, "scale_out");
  });

  test("reads audit-trail final_output shape", () => {
    const fields = legacyPublishFieldsFrom({
      publish_context: {
        final_output: {
          options_play: "NVDA $180 CALL @ $4.00 — Sep 19",
          entry_premium: 4,
        },
      },
    });
    assert.equal(fields.entry_premium, 4);
    assert.match(fields.options_play ?? "", /NVDA/);
  });

  test("falls back to edition play when pin omits contract", () => {
    const fields = legacyPublishFieldsFrom({
      publish_context: { entry_premium: 12.85 },
      editionPlay: {
        options_play: "DELL $490 CALL @ $12.85 — Sep 4",
        exit_style: "scale_out",
      },
    });
    assert.equal(fields.entry_premium, 12.85);
    assert.match(fields.options_play ?? "", /DELL/);
    assert.equal(fields.exit_style, "scale_out");
  });
});
