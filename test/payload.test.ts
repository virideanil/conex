import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as payload from "../server/payload.ts";

test("block 0 is SHAKE256 of the message", () => {
  const expected = createHash("shake256", { outputLength: payload.BLOCK_SIZE }).update(payload.MESSAGE).update("\n").update("0").digest();
  assert.ok(expected.equals(payload.block(0)));
  assert.equal(payload.MESSAGE, "love is above all, love thy neighbour as one love god above all and love thyself as thy love god.");
});

test("stream yields exactly the requested number of bytes", () => {
  for (const n of [1, 1000, payload.BLOCK_SIZE, payload.BLOCK_SIZE * 3 + 17]) {
    const total = [...payload.stream(n)].reduce((s, b) => s + b.length, 0);
    assert.equal(total, n);
  }
});

test("bytesAt agrees with the stream at any offset", () => {
  const whole = Buffer.concat([...payload.stream(payload.BLOCK_SIZE * 3)]);
  for (const [off, n] of [[0, 10], [payload.BLOCK_SIZE - 5, 20], [100000, 83333]] as const) {
    assert.ok(payload.bytesAt(off, n).equals(whole.subarray(off, off + n)));
  }
});

test("upload verification recognises the canonical first block", () => {
  assert.equal(payload.verifyFirstBlock(Buffer.concat([payload.block(0), Buffer.alloc(10)])), true);
  assert.equal(payload.verifyFirstBlock(Buffer.alloc(payload.BLOCK_SIZE + 10, 7)), false);
  assert.equal(payload.verifyFirstBlock(Buffer.alloc(10)), false);
});
