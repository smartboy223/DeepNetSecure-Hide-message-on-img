// LSB steganography with spatial priority: embed in texture-rich blocks first (demo: “best spots”).
// Ordering uses only upper bits of pixels so sender (cover) and receiver (stego) compute the same map.
// Frame: triplicated header (magic + version + RS length) then RS payload — length is not raw LSB alone.

/** Macroblock size in pixels (non-overlapping grid). */
export const SPATIAL_BLOCK_PX = 16;

/** ASCII “DNS1” — identifies DeepNetSecure stego v1. */
export const STEGO_MAGIC = new TextEncoder().encode('DNS1');

/** Frame version byte (must match backend / training tools). */
export const STEGO_FRAME_VERSION = 1;

/** Logical header: magic(4) + version(1) + rs_len(4 BE). */
export const STEGO_HEADER_LOGICAL_BYTES = 9;

/** Each logical byte is written 3× (8 bits per copy) for majority-vote recovery. */
export const STEGO_HEADER_TRIPLICATE = 3;

/** Total LSB bits consumed by the triplicated header (9 × 3 × 8). */
export const STEGO_HEADER_BITS = STEGO_HEADER_LOGICAL_BYTES * STEGO_HEADER_TRIPLICATE * 8;

export const StegoErrorCode = {
  NOT_A_STEGO_FILE: 'NOT_A_STEGO_FILE',
  WRONG_VERSION: 'WRONG_VERSION',
  TRUNCATED: 'STEGO_TRUNCATED',
} as const;

export type StegoErrorCodeType = (typeof StegoErrorCode)[keyof typeof StegoErrorCode];

export class StegoFrameError extends Error {
  readonly code: StegoErrorCodeType;

  constructor(code: StegoErrorCodeType, message: string) {
    super(message);
    this.name = 'StegoFrameError';
    this.code = code;
  }
}

function luminanceMsb(r: number, g: number, b: number): number {
  const rp = r & 0xfe;
  const gp = g & 0xfe;
  const bp = b & 0xfe;
  return 0.299 * rp + 0.587 * gp + 0.114 * bp;
}

/** Local variance of luminance (MSB-only) — higher → more texture → prioritized for hiding in the demo. */
function blockTextureScore(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  w: number,
  h: number
): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const x = x0 + dx;
      const y = y0 + dy;
      const o = (y * width + x) * 4;
      const lum = luminanceMsb(data[o], data[o + 1], data[o + 2]);
      sum += lum;
      sumSq += lum * lum;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/**
 * Flat channel indices (R,G,B only) in texture-priority order: blocks sorted by variance desc,
 * tie-break by block row then column; within a block, normal raster RGB order.
 */
export function buildEmbeddableIndexOrder(imageData: ImageData): number[] {
  const { width, height, data } = imageData;
  const bs = SPATIAL_BLOCK_PX;
  const nbx = Math.ceil(width / bs);
  const nby = Math.ceil(height / bs);

  const blocks: { br: number; bc: number; score: number; indices: number[] }[] = [];

  for (let br = 0; br < nby; br++) {
    for (let bc = 0; bc < nbx; bc++) {
      const x0 = bc * bs;
      const y0 = br * bs;
      const x1 = Math.min(x0 + bs, width);
      const y1 = Math.min(y0 + bs, height);
      const bw = x1 - x0;
      const bh = y1 - y0;
      const indices: number[] = [];
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * width + x) * 4;
          indices.push(o, o + 1, o + 2);
        }
      }
      const score = blockTextureScore(data, width, x0, y0, bw, bh);
      blocks.push({ br, bc, score, indices });
    }
  }

  blocks.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.br !== b.br) return a.br - b.br;
    return a.bc - b.bc;
  });

  const order: number[] = [];
  for (const b of blocks) {
    order.push(...b.indices);
  }
  return order;
}

function majorityBit(a: number, b: number, c: number): number {
  return a + b + c >= 2 ? 1 : 0;
}

/** Build STEGO_HEADER_BITS bits: for each logical header byte, emit 3 full copies MSB-first. */
function encodeTriplicatedHeaderBytes(logical: Uint8Array): Uint8Array {
  const out = new Uint8Array(STEGO_HEADER_BITS);
  let o = 0;
  for (let i = 0; i < logical.length; i++) {
    const byte = logical[i]!;
    for (let cp = 0; cp < STEGO_HEADER_TRIPLICATE; cp++) {
      for (let j = 0; j < 8; j++) {
        out[o++] = (byte >> (7 - j)) & 1;
      }
    }
  }
  return out;
}

/** Recover 9 logical bytes from triplicated bits (majority vote per bit across the 3 copies). */
function decodeTriplicatedHeaderBits(bits216: Uint8Array): Uint8Array {
  const logical = new Uint8Array(STEGO_HEADER_LOGICAL_BYTES);
  for (let byteIdx = 0; byteIdx < STEGO_HEADER_LOGICAL_BYTES; byteIdx++) {
    const base = byteIdx * 24;
    let v = 0;
    for (let k = 0; k < 8; k++) {
      const b0 = bits216[base + k]! & 1;
      const b1 = bits216[base + 8 + k]! & 1;
      const b2 = bits216[base + 16 + k]! & 1;
      v = (v << 1) | majorityBit(b0, b1, b2);
    }
    logical[byteIdx] = v;
  }
  return logical;
}

function readBitsFromOrder(
  pixels: Uint8ClampedArray,
  order: number[],
  startBit: number,
  numBits: number,
  out: Uint8Array
): void {
  for (let i = 0; i < numBits; i++) {
    out[i] = pixels[order[startBit + i]!]! & 1;
  }
}

export function embedData(imageData: ImageData, rsPayload: Uint8Array): ImageData {
  const pixels = imageData.data;
  const rsLen = rsPayload.length;

  const headerLogical = new Uint8Array(STEGO_HEADER_LOGICAL_BYTES);
  headerLogical.set(STEGO_MAGIC, 0);
  headerLogical[4] = STEGO_FRAME_VERSION;
  const dv = new DataView(headerLogical.buffer, headerLogical.byteOffset);
  dv.setUint32(5, rsLen, false);

  const headerBits = encodeTriplicatedHeaderBytes(headerLogical);
  const requiredBits = STEGO_HEADER_BITS + rsLen * 8;

  const order = buildEmbeddableIndexOrder(imageData);
  if (requiredBits > order.length) {
    throw new Error('Payload is too large for this image.');
  }

  const bitstream = new Uint8Array(requiredBits);
  bitstream.set(headerBits, 0);
  for (let i = 0; i < rsLen; i++) {
    const byte = rsPayload[i]!;
    for (let j = 0; j < 8; j++) {
      bitstream[STEGO_HEADER_BITS + i * 8 + j] = (byte >> (7 - j)) & 1;
    }
  }

  for (let bitIndex = 0; bitIndex < requiredBits; bitIndex++) {
    const idx = order[bitIndex]!;
    pixels[idx] = (pixels[idx]! & 0xfe) | bitstream[bitIndex]!;
  }

  return imageData;
}

export function extractData(imageData: ImageData): Uint8Array {
  const pixels = imageData.data;
  const order = buildEmbeddableIndexOrder(imageData);

  if (order.length < STEGO_HEADER_BITS) {
    throw new StegoFrameError(StegoErrorCode.TRUNCATED, 'Image too small to contain a frame header.');
  }

  const bits216 = new Uint8Array(STEGO_HEADER_BITS);
  readBitsFromOrder(pixels, order, 0, STEGO_HEADER_BITS, bits216);
  const logical = decodeTriplicatedHeaderBits(bits216);

  const magicStr = new TextDecoder().decode(logical.subarray(0, 4));
  if (magicStr !== 'DNS1') {
    throw new StegoFrameError(StegoErrorCode.NOT_A_STEGO_FILE, 'NOT_A_STEGO_FILE');
  }

  const version = logical[4]!;
  if (version !== STEGO_FRAME_VERSION) {
    throw new StegoFrameError(StegoErrorCode.WRONG_VERSION, 'WRONG_VERSION');
  }

  const rsLen = new DataView(logical.buffer, logical.byteOffset + 5, 4).getUint32(0, false);
  const bitsAfterHeader = order.length - STEGO_HEADER_BITS;
  const maxRsBytes = Math.floor(bitsAfterHeader / 8);

  if (rsLen === 0) {
    return new Uint8Array(0);
  }
  if (rsLen > maxRsBytes) {
    throw new StegoFrameError(StegoErrorCode.TRUNCATED, 'STEGO_TRUNCATED');
  }

  const rsPayload = new Uint8Array(rsLen);
  let currentByte = 0;

  for (let i = 0; i < rsLen * 8; i++) {
    const bit = pixels[order[STEGO_HEADER_BITS + i]!]! & 1;
    currentByte = (currentByte << 1) | bit;
    if ((i + 1) % 8 === 0) {
      rsPayload[Math.floor(i / 8)] = currentByte;
      currentByte = 0;
    }
  }

  return rsPayload;
}

/** Max RS payload bytes for an image of given dimensions (after triplicated header). */
export function calculateCapacity(width: number, height: number): number {
  const totalBits = width * height * 3;
  return Math.floor((totalBits - STEGO_HEADER_BITS) / 8);
}
