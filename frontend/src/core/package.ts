// Package Module: Handles formatting the payload with metadata and hash

import { computeSHA256 } from './crypto';

import type { TierProbabilities } from './ai';

/** Embedded at encode time after ML cover prep (advisory; decode works without it). */
export interface MlCoverPrepEmbedded {
  version: 1;
  modelLabel: string;
  suitability: string;
  confidence: number;
  payloadVsCapacityPercent?: number;
  /** Model’s predicted PSNR (dB) at assessment-time payload vs capacity (Encode step 3). */
  predictedPsnrDb?: number;
  /** Model’s predicted SSIM at assessment time. */
  predictedSsim?: number;
  classProbabilities?: TierProbabilities;
}

export interface MessagePackage {
  version: number;
  message: string;
  digest: string;
  metadata?: Record<string, string>;
  mlCoverPrep?: MlCoverPrepEmbedded;
}

export function createPackage(
  message: string,
  options?: { metadata?: Record<string, string>; mlCoverPrep?: MlCoverPrepEmbedded }
): string {
  const digest = computeSHA256(message);
  const pkg: MessagePackage = {
    version: 1,
    message,
    digest,
  };
  if (options?.metadata) {
    pkg.metadata = options.metadata;
  }
  if (options?.mlCoverPrep) {
    pkg.mlCoverPrep = options.mlCoverPrep;
  }
  return JSON.stringify(pkg);
}

export function parsePackage(jsonString: string): { pkg: MessagePackage; isValid: boolean } {
  try {
    const pkg: MessagePackage = JSON.parse(jsonString);
    if (!pkg.message || !pkg.digest) {
      throw new Error('Invalid package format');
    }
    const computedDigest = computeSHA256(pkg.message);
    const isValid = computedDigest === pkg.digest;
    return { pkg, isValid };
  } catch (e) {
    throw new Error('Failed to parse message package. Data may be corrupted or wrong key used.');
  }
}

export function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

export function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
