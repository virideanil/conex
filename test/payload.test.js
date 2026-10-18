'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const payload = require('../server/payload');

test('block 0 is SHAKE256 of the message', () => {
  const expected = crypto.createHash('shake256', { outputLength: payload.BLOCK_SIZE })
    .update(payload.MESSAGE).update('\n').update('0').digest();
  assert.ok(expected.equals(payload.block(0)));
  assert.equal(payload.MESSAGE, 'love is above all, love thy neighbour as one love god above all and love thyself as thy love god.');
});

test('stream yields exactly the requested number of bytes', () => {
  for (const n of [1, 1000, payload.BLOCK_SIZE, payload.BLOCK_SIZE * 3 + 17]) {
    const total = [...payload.stream(n)].reduce((s, b) => s + b.length, 0);
    assert.equal(total, n);
  }
});

test('upload verification recognises the canonical first block', () => {
  const good = Buffer.concat([payload.block(0), Buffer.alloc(10)]);
  const bad = Buffer.alloc(payload.BLOCK_SIZE + 10, 7);
  assert.equal(payload.verifyFirstBlock(good), true);
  assert.equal(payload.verifyFirstBlock(bad), false);
  assert.equal(payload.verifyFirstBlock(Buffer.alloc(10)), false);
});
