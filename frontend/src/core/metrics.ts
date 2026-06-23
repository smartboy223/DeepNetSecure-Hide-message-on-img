// Metrics Module

export function calculatePSNR(original: ImageData, stego: ImageData): number {
  if (original.data.length !== stego.data.length) {
    throw new Error('Image dimensions must match to calculate PSNR.');
  }

  let mse = 0;
  for (let i = 0; i < original.data.length; i++) {
    const diff = original.data[i] - stego.data[i];
    mse += diff * diff;
  }
  mse /= original.data.length;

  if (mse === 0) return Infinity;

  const maxPixelValue = 255;
  const psnr = 20 * Math.log10(maxPixelValue) - 10 * Math.log10(mse);
  return psnr;
}

/** Luminance (Rec. 601) — used for SSIM on cover vs stego. */
function luminanceY(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Global SSIM on luminance (single-window, full image). Range ~[-1, 1]; identical images → 1.
 */
export function calculateSSIM(original: ImageData, stego: ImageData): number {
  if (original.width !== stego.width || original.height !== stego.height) {
    throw new Error('Image dimensions must match to calculate SSIM.');
  }
  const w = original.width;
  const h = original.height;
  const n = w * h;
  if (n === 0) return 1;

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < original.data.length; i += 4) {
    const x = luminanceY(original.data[i], original.data[i + 1], original.data[i + 2]);
    const y = luminanceY(stego.data[i], stego.data[i + 1], stego.data[i + 2]);
    sumX += x;
    sumY += y;
  }
  const muX = sumX / n;
  const muY = sumY / n;

  let varX = 0;
  let varY = 0;
  let covXY = 0;
  for (let i = 0; i < original.data.length; i += 4) {
    const x = luminanceY(original.data[i], original.data[i + 1], original.data[i + 2]);
    const y = luminanceY(stego.data[i], stego.data[i + 1], stego.data[i + 2]);
    const dx = x - muX;
    const dy = y - muY;
    varX += dx * dx;
    varY += dy * dy;
    covXY += dx * dy;
  }
  varX /= n;
  varY /= n;
  covXY /= n;

  const L = 255;
  const c1 = (0.01 * L) ** 2;
  const c2 = (0.03 * L) ** 2;
  const num = (2 * muX * muY + c1) * (2 * covXY + c2);
  const den = (muX * muX + muY * muY + c1) * (varX + varY + c2);
  if (den === 0) return 1;
  return num / den;
}
