// The bytes we send across the wire are not random filler. They are the
// SHAKE256 extendable output of a single sentence, so every speed test moves
// a stream that literally "says" the message, block by block.
import { createHash, timingSafeEqual } from "node:crypto";

export const MESSAGE = "love is above all, love thy neighbour as one love god above all and love thyself as thy love god.";

export const BLOCK_SIZE = 64 * 1024; // 64 KiB per SHAKE256 squeeze
const CACHED_BLOCKS = 64; // 4 MiB of distinct output, cycled for larger transfers

/** Block i = SHAKE256(MESSAGE ‖ "\n" ‖ i), squeezed to BLOCK_SIZE bytes. */
export function block(index: number): Buffer {
  return createHash("shake256", { outputLength: BLOCK_SIZE }).update(MESSAGE).update("\n").update(String(index)).digest();
}

const cache = Array.from({ length: CACHED_BLOCKS }, (_, i) => block(i));

/** A short fingerprint of the message itself. */
export const DIGEST_HEX = createHash("shake256", { outputLength: 32 }).update(MESSAGE).digest("hex");

/** Yields buffers until `totalBytes` have been produced. */
export function* stream(totalBytes: number): Generator<Buffer> {
  let sent = 0, i = 0;
  while (sent < totalBytes) {
    const b = cache[i % CACHED_BLOCKS], remaining = totalBytes - sent;
    yield remaining >= b.length ? b : b.subarray(0, remaining);
    sent += Math.min(remaining, b.length);
    i += 1;
  }
}

/** Whether the first block of an uploaded body is block 0: the message came back intact. */
export function verifyFirstBlock(buf: Buffer): boolean {
  if (buf.length < BLOCK_SIZE) return false;
  return timingSafeEqual(buf.subarray(0, BLOCK_SIZE), cache[0]);
}
