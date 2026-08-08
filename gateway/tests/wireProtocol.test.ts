import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameDecoder, encodeFrame } from "../src/wireProtocol.js";

test("decodes a single frame delivered whole", () => {
  const decoder = new FrameDecoder(1024);
  const { frames } = decoder.push(encodeFrame("hello"));
  assert.equal(frames.length, 1);
  assert.equal(frames[0]!.toString("utf8"), "hello");
});

test("decodes a frame delivered one byte at a time (fragmentation)", () => {
  const decoder = new FrameDecoder(1024);
  const encoded = encodeFrame("fragmented message");
  let seen: Buffer[] = [];
  for (const byte of encoded) {
    const { frames } = decoder.push(Buffer.from([byte]));
    seen = seen.concat(frames);
  }
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.toString("utf8"), "fragmented message");
});

test("decodes two frames coalesced into a single chunk", () => {
  const decoder = new FrameDecoder(1024);
  const combined = Buffer.concat([encodeFrame("first"), encodeFrame("second")]);
  const { frames } = decoder.push(combined);
  assert.equal(frames.length, 2);
  assert.equal(frames[0]!.toString("utf8"), "first");
  assert.equal(frames[1]!.toString("utf8"), "second");
});

test("handles an empty-payload frame", () => {
  const decoder = new FrameDecoder(1024);
  const { frames } = decoder.push(encodeFrame(""));
  assert.equal(frames.length, 1);
  assert.equal(frames[0]!.length, 0);
});

test("rejects a frame whose declared length exceeds the max", () => {
  const decoder = new FrameDecoder(8);
  const { frames, error } = decoder.push(encodeFrame("this is definitely too long"));
  assert.equal(frames.length, 0);
  assert.equal(error, "too_large");
});

test("buffers a partial header until more bytes arrive", () => {
  const decoder = new FrameDecoder(1024);
  const encoded = encodeFrame("x");
  const { frames: none } = decoder.push(encoded.subarray(0, 2)); // only 2 of 4 header bytes
  assert.equal(none.length, 0);
  const { frames } = decoder.push(encoded.subarray(2));
  assert.equal(frames.length, 1);
  assert.equal(frames[0]!.toString("utf8"), "x");
});
