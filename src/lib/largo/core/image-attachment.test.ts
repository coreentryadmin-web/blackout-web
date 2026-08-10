import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateAttachments,
  sniffImageType,
  base64ByteLength,
  formatImageBlock,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_TURN,
} from "./image-attachment";

// REAL headers, not invented ones. Each is the actual leading byte sequence of its format, so a
// change to the sniffer that breaks on genuine files breaks these too.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]).toString("base64");
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]).toString("base64");
const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(64, 7)]).toString("base64");
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8 "),
  Buffer.alloc(64, 7),
]).toString("base64");

test("sniffs each supported format from its real magic bytes", () => {
  assert.equal(sniffImageType(PNG), "image/png");
  assert.equal(sniffImageType(JPEG), "image/jpeg");
  assert.equal(sniffImageType(GIF), "image/gif");
  assert.equal(sniffImageType(WEBP), "image/webp");
});

test("refuses anything whose bytes are not a known image", () => {
  assert.equal(sniffImageType(Buffer.from("%PDF-1.7 not an image").toString("base64")), null);
  assert.equal(sniffImageType(Buffer.from("<svg xmlns=...>").toString("base64")), null);
  assert.equal(sniffImageType(Buffer.from("MZ\x90\x00").toString("base64")), null);
  assert.equal(sniffImageType(""), null);
  // "RIFF" alone is a WAV/AVI container too — without the WEBP tag it must not pass.
  const riffWav = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WAVEfmt ")]);
  assert.equal(sniffImageType(riffWav.toString("base64")), null);
});

test("THE BYTES DECIDE — a mislabelled payload is corrected, not forwarded", () => {
  // A JPEG announced as PNG. Forwarding the label 400s at Anthropic and the member sees only
  // "Largo query failed"; the sniffed type is used instead.
  const r = validateAttachments([{ data: JPEG, media_type: "image/png" }]);
  assert.equal(r.ok, true);
  assert.ok(r.ok && r.blocks[0].source.media_type === "image/jpeg");
});

test("a truthful label is still resolved from the bytes", () => {
  const r = validateAttachments([{ data: PNG, media_type: "image/png" }]);
  assert.ok(r.ok && r.blocks[0].source.media_type === "image/png");
});

test("accepts a data: URL wrapper and strips it", () => {
  const r = validateAttachments([{ data: `data:image/png;base64,${PNG}` }]);
  assert.ok(r.ok && r.blocks[0].source.data === PNG);
});

test("SVG is refused by name, with a reason the member can act on", () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString("base64");
  const r = validateAttachments([{ data: svg, media_type: "image/svg+xml" }]);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /SVG is not supported/);
});

test("a payload that is not base64 at all is rejected", () => {
  assert.equal(validateAttachments([{ data: "!!!! not base64 !!!!" }]).ok, false);
  assert.equal(validateAttachments([{ data: "" }]).ok, false);
  assert.equal(validateAttachments([{ data: 12345 }]).ok, false);
  assert.equal(validateAttachments([null]).ok, false);
});

test("byte length is computed from the encoding, not by decoding", () => {
  for (const n of [1, 2, 3, 4, 100, 1023, 4096]) {
    const b64 = Buffer.alloc(n, 1).toString("base64");
    assert.equal(base64ByteLength(b64), n, `length mismatch at ${n} bytes`);
  }
  assert.equal(base64ByteLength(""), 0);
});

test("an oversized image is rejected before it can be decoded", () => {
  // Constructed by LENGTH only — never materialising 5MB of real bytes, which is the same
  // reason the implementation measures instead of decoding.
  const oversizedB64 = "A".repeat(Math.ceil(((MAX_IMAGE_BYTES + 1024) * 4) / 3));
  const r = validateAttachments([{ data: oversizedB64, media_type: "image/png" }]);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /too large/);
});

test("caps the number of attachments per turn", () => {
  const many = Array.from({ length: MAX_IMAGES_PER_TURN + 1 }, () => ({ data: PNG }));
  const r = validateAttachments(many);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /too many images/);
});

test("one bad attachment fails the whole turn — never a silent partial", () => {
  // The member attached two charts. Answering about one and saying nothing about the other
  // produces a confident answer about an image it never saw.
  const r = validateAttachments([{ data: PNG }, { data: Buffer.from("%PDF").toString("base64") }]);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.error, /image 2/);
});

test("no attachments is a success, not an error", () => {
  for (const empty of [undefined, null, []]) {
    const r = validateAttachments(empty);
    assert.ok(r.ok && r.blocks.length === 0 && r.totalBytes === 0);
  }
  assert.equal(validateAttachments("nope").ok, false);
  assert.equal(validateAttachments({ data: PNG }).ok, false);
});

test("reports the real total byte count", () => {
  const r = validateAttachments([{ data: PNG }, { data: JPEG }]);
  assert.ok(r.ok);
  assert.equal(r.ok && r.totalBytes, base64ByteLength(PNG) + base64ByteLength(JPEG));
});

test("the guidance block demands attribution and appears only when there are images", () => {
  assert.equal(formatImageBlock(0), "");
  const one = formatImageBlock(1);
  assert.match(one, /Attached image/);
  assert.match(one, /Attribute it/);
  assert.match(one, /no reliable timestamp/);
  assert.match(one, /Cross-check against live data/);
  assert.match(formatImageBlock(3), /Attached 3 images/);
});
