import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { thermalCaptureFilename } from "./capture-desk-png";

describe("thermalCaptureFilename", () => {
  it("builds a stable lowercase path-safe name", () => {
    assert.equal(
      thermalCaptureFilename({
        ticker: "SPX",
        lens: "GEX",
        view: "matrix",
        at: new Date("2026-08-14T15:00:00.000Z"),
      }),
      "thermal-SPX-gex-matrix-2026-08-14.png",
    );
  });

  it("sanitizes odd ticker input", () => {
    assert.equal(
      thermalCaptureFilename({
        ticker: " BRK.B ",
        lens: "vex",
        view: "profile",
        at: new Date("2026-01-02T00:00:00.000Z"),
      }),
      "thermal-BRK.B-vex-profile-2026-01-02.png",
    );
  });
});
