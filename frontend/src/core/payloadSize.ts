import { encryptMessage } from './crypto';
import { encodeECC, estimateEccEncodedLength } from './ecc';
import type { MlCoverPrepEmbedded } from './package';
import { createPackage, stringToBytes } from './package';

/**
 * Conservative stand-in for `mlCoverPrep` when sizing before ML returns — sized so real labels rarely exceed this.
 */
export const ML_COVER_PREP_SIZE_PLACEHOLDER: MlCoverPrepEmbedded = {
  version: 1,
  modelLabel: 'x'.repeat(64),
  suitability: 'medium',
  confidence: 1,
  payloadVsCapacityPercent: 100,
  predictedPsnrDb: 999.99,
  predictedSsim: 0.9999,
  classProbabilities: { low: 0.3333333, medium: 0.3333333, high: 0.3333334 },
};

/**
 * Final byte length after AES + Reed–Solomon for the same package shape used at encode.
 * Pass `mlPrep` after ML assessment for an exact match; omit to use a conservative placeholder (includes ML JSON).
 */
export function embeddedStegoPayloadByteLength(
  message: string,
  passphrase: string,
  mlPrep?: MlCoverPrepEmbedded
): number {
  const prep = mlPrep ?? ML_COVER_PREP_SIZE_PLACEHOLDER;
  const pkg = createPackage(message, { mlCoverPrep: prep });
  const encrypted = encryptMessage(pkg, passphrase);
  return encodeECC(stringToBytes(encrypted)).length;
}

/**
 * Upper bound before passphrase is known (conservative).
 */
export function embeddedStegoPayloadByteLengthEstimate(message: string): number {
  const pkg = createPackage(message, { mlCoverPrep: ML_COVER_PREP_SIZE_PLACEHOLDER });
  const pkgLen = stringToBytes(pkg).length;
  return estimateEccEncodedLength(Math.ceil(pkgLen * 3) + 256);
}
