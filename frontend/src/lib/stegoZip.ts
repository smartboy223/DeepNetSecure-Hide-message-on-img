import JSZip from 'jszip';

const README = `DeepNetSecure — stego image (lossless)
==============================================

1. Extract this ZIP on the computer that will decode the message.
2. Open the PNG file unchanged (do not re-save or convert the image).
3. In DeepNetSecure, use Decode and load that PNG.
4. Enter your stego passphrase (AES key) to recover the secret message.

Why use a ZIP?
- Sharing the raw PNG through some chat or social apps can recompress the
  image and destroy the hidden LSB data. Sending this ZIP as a file attachment
  (where supported) keeps the PNG bytes identical after unzip.

This archive is standard ZIP (compressed). It is not password-protected by the
app; if you need a password on the archive, encrypt the ZIP with your OS or
7-Zip and share that password through a separate channel from the stego key.
`;

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const i = dataUrl.indexOf(',');
  if (i < 0) throw new Error('Invalid data URL');
  const meta = dataUrl.slice(0, i);
  const b64 = dataUrl.slice(i + 1);
  if (meta.includes(';base64')) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) out[j] = bin.charCodeAt(j);
    return out;
  }
  const decoded = decodeURIComponent(b64);
  const out = new Uint8Array(decoded.length);
  for (let j = 0; j < decoded.length; j++) out[j] = decoded.charCodeAt(j);
  return out;
}

export async function buildStegoTransferZip(pngDataUrl: string, pngFileName: string): Promise<Blob> {
  const zip = new JSZip();
  const safeName = pngFileName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'stego.png';
  const pngName = safeName.toLowerCase().endsWith('.png') ? safeName : `${safeName}.png`;
  zip.file(pngName, dataUrlToUint8Array(pngDataUrl));
  zip.file('README.txt', README);
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
}

export function triggerDownloadBlob(blob: Blob, downloadName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
