import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { viewBoxPointToContainer } from "@/components/landing/bie-viewbox-map";

describe("viewBoxPointToContainer", () => {
  it("maps center with slice scaling", () => {
    const p = viewBoxPointToContainer(640, 370, 1280, 720, 1280, 740, "slice");
    assert.equal(p.x, 640);
    assert.equal(p.y, 360);
    assert.ok(p.scale >= 1);
  });

  it("uses meet scaling without upscaling beyond container", () => {
    const p = viewBoxPointToContainer(640, 370, 1280, 720, 1280, 740, "meet");
    assert.equal(p.x, 640);
    assert.ok(p.y > 0);
    assert.ok(p.scale <= 1);
  });
});
