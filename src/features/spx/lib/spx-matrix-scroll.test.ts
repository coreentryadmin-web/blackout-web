import test from "node:test";
import assert from "node:assert/strict";
import { scrollRowIntoViewCenter } from "./spx-matrix-scroll";

test("scrollRowIntoViewCenter: adjusts scrollTop toward vertical center", () => {
  const scrollEl = {
    scrollTop: 0,
    scrollHeight: 800,
    clientHeight: 200,
    getBoundingClientRect: () => ({ top: 100, height: 200 }),
  } as unknown as HTMLElement;

  const rowEl = {
    getBoundingClientRect: () => ({ top: 300, height: 20 }),
  } as unknown as HTMLElement;

  scrollRowIntoViewCenter(scrollEl, rowEl);
  // row center (310) vs viewport center (200) => delta 110
  assert.equal(scrollEl.scrollTop, 110);
});

test("scrollRowIntoViewCenter places a deep spot row in the middle of the viewport", () => {
  const scrollEl = {
    scrollTop: 0,
    scrollHeight: 2000,
    clientHeight: 400,
    getBoundingClientRect: () => ({ top: 100, height: 400 }),
  } as unknown as HTMLElement;
  // Row sits 800px below the scroll box top → needs scroll to center.
  const rowEl = {
    getBoundingClientRect: () => ({ top: 100 + 800, height: 28 }),
  } as unknown as HTMLElement;
  scrollRowIntoViewCenter(scrollEl, rowEl);
  // target = 0 + (800 - (400 - 28) / 2) = 614
  assert.equal(scrollEl.scrollTop, 614);
});

test("scrollRowIntoViewCenter clamps to max scroll", () => {
  const scrollEl = {
    scrollTop: 0,
    scrollHeight: 500,
    clientHeight: 400,
    getBoundingClientRect: () => ({ top: 0, height: 400 }),
  } as unknown as HTMLElement;
  const rowEl = {
    getBoundingClientRect: () => ({ top: 2000, height: 20 }),
  } as unknown as HTMLElement;
  scrollRowIntoViewCenter(scrollEl, rowEl);
  assert.equal(scrollEl.scrollTop, 100); // max = 500 - 400
});
