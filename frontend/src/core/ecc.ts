/**
 * Reed–Solomon error correction (GF(256)) before steganography — matches a classic ECC layer.
 * Uses ZXing’s RS over DATA_MATRIX_FIELD_256: 223 data bytes + 32 parity bytes per block (255 total),
 * corrects up to 16 wrong byte-symbols per block. Framed with a 4-byte big-endian payload length prefix.
 */
import { GenericGF, ReedSolomonDecoder, ReedSolomonEncoder } from '../vendor/zxingReedSolomon.js';

const FIELD = GenericGF.DATA_MATRIX_FIELD_256();
const DATA_PER_BLOCK = 223;
const EC_BYTES = 32;
const BLOCK_LEN = DATA_PER_BLOCK + EC_BYTES;

const encoder = new ReedSolomonEncoder(FIELD);
const decoder = new ReedSolomonDecoder(FIELD);

/** Approximate expansion vs ciphertext length (for UI estimates). */
export function rsExpansionFactor(): number {
  return (4 + BLOCK_LEN) / DATA_PER_BLOCK;
}

export function estimateEccEncodedLength(dataLen: number): number {
  if (dataLen <= 0) return 4;
  const blocks = Math.ceil(dataLen / DATA_PER_BLOCK);
  return 4 + blocks * BLOCK_LEN;
}

function int32BlockFromBytes(blockBuf: Uint8Array): Int32Array {
  const received = new Int32Array(BLOCK_LEN);
  for (let i = 0; i < BLOCK_LEN; i++) {
    received[i] = blockBuf[i] ?? 0;
  }
  return received;
}

function bytesFromInt32Block(received: Int32Array): Uint8Array {
  const out = new Uint8Array(BLOCK_LEN);
  for (let i = 0; i < BLOCK_LEN; i++) {
    out[i] = received[i] & 255;
  }
  return out;
}

export function encodeECC(data: Uint8Array): Uint8Array {
  if (data.length === 0) {
    const h = new Uint8Array(4);
    new DataView(h.buffer).setUint32(0, 0, false);
    return h;
  }

  const origLen = data.length;
  const numBlocks = Math.ceil(origLen / DATA_PER_BLOCK);
  const out = new Uint8Array(4 + numBlocks * BLOCK_LEN);
  new DataView(out.buffer).setUint32(0, origLen, false);

  for (let b = 0; b < numBlocks; b++) {
    const start = b * DATA_PER_BLOCK;
    const sliceLen = Math.min(DATA_PER_BLOCK, origLen - start);
    const block = new Int32Array(BLOCK_LEN);
    for (let i = 0; i < sliceLen; i++) {
      block[i] = data[start + i]!;
    }
    encoder.encode(block, EC_BYTES);
    out.set(bytesFromInt32Block(block), 4 + b * BLOCK_LEN);
  }

  return out;
}

export function decodeECC(data: Uint8Array): { decoded: Uint8Array; errorsCorrected: number } {
  if (data.length < 4) {
    throw new Error('DECODE: ECC payload too short.');
  }
  const origLen = new DataView(data.buffer, data.byteOffset, 4).getUint32(0, false);
  if (origLen === 0) {
    return { decoded: new Uint8Array(0), errorsCorrected: 0 };
  }

  const numBlocks = Math.ceil(origLen / DATA_PER_BLOCK);
  const expected = 4 + numBlocks * BLOCK_LEN;
  if (data.length < expected) {
    throw new Error('DECODE: ECC payload truncated.');
  }

  const decoded = new Uint8Array(origLen);
  let errorsCorrected = 0;
  let outPos = 0;

  for (let b = 0; b < numBlocks; b++) {
    const off = 4 + b * BLOCK_LEN;
    const blockBuf = data.subarray(off, off + BLOCK_LEN);
    const before = new Uint8Array(blockBuf);
    const received = int32BlockFromBytes(blockBuf);

    try {
      decoder.decode(received, EC_BYTES);
    } catch {
      throw new Error(
        'DECODE: Reed–Solomon failed (too many errors — keep PNG lossless, same file as Encode).',
      );
    }

    const after = bytesFromInt32Block(received);
    for (let i = 0; i < BLOCK_LEN; i++) {
      if (before[i] !== after[i]) errorsCorrected++;
    }

    const take = Math.min(DATA_PER_BLOCK, origLen - b * DATA_PER_BLOCK);
    decoded.set(after.subarray(0, take), outPos);
    outPos += take;
  }

  return { decoded, errorsCorrected };
}
