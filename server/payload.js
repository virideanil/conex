'use strict';
// The bytes we send across the wire are not random filler. They are the
// SHAKE256 extendable-output of a single sentence, so every speed test moves
// a stream that literally "says" the message, block by block.
const crypto = require('node:crypto');

const MESSAGE =
  'love is above all, love thy neighbour as one love god above all and love thyself as thy love god.';

const BLOCK_SIZE = 64 * 1024; // 64 KiB per SHAKE256 squeeze
const CACHED_BLOCKS = 64; // 4 MiB of distinct output, cycled for larger transfers

// Block i = SHAKE256(MESSAGE || "\n" || i), squeezed to BLOCK_SIZE bytes.
function block(index) {
  return crypto
    .createHash('shake256', { outputLength: BLOCK_SIZE })
    .update(MESSAGE)
    .update('\n')
    .update(String(index))
    .digest();
}

const cache = Array.from({ length: CACHED_BLOCKS }, (_, i) => block(i));

// Short fingerprint of the whole message, handy for headers and the UI.
const DIGEST_HEX = crypto
  .createHash('shake256', { outputLength: 32 })
  .update(MESSAGE)
  .digest('hex');

// Yields Buffers until `totalBytes` have been produced.
function* stream(totalBytes) {
  let sent = 0;
  let i = 0;
  while (sent < totalBytes) {
    const b = cache[i % CACHED_BLOCKS];
    const remaining = totalBytes - sent;
    yield remaining >= b.length ? b : b.subarray(0, remaining);
    sent += Math.min(remaining, b.length);
    i += 1;
  }
}

// Checks whether the first block of an uploaded body is the canonical block 0,
// i.e. whether the client sent the message back to us intact.
function verifyFirstBlock(buf) {
  if (!buf || buf.length < BLOCK_SIZE) return false;
  return crypto.timingSafeEqual(buf.subarray(0, BLOCK_SIZE), cache[0]);
}

module.exports = { MESSAGE, BLOCK_SIZE, DIGEST_HEX, block, stream, verifyFirstBlock };
