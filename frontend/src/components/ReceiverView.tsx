import React, { useState, useRef } from 'react';
import { Upload, Unlock, FileText, AlertTriangle, ShieldCheck, ShieldAlert, Scan, Terminal, Activity, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { extractAllMetadata } from '../core/metadata';
import { decryptMessage } from '../core/crypto';
import { decodeECC } from '../core/ecc';
import {
  extractData,
  calculateCapacity,
  StegoFrameError,
  StegoErrorCode,
} from '../core/stego';
import { parsePackage, bytesToString, type MlCoverPrepEmbedded } from '../core/package';
import { StepNum } from './StepNum';
import { yieldToPaint } from '../lib/uiTiming';

const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);

function formatDecodeError(err: unknown): string {
  if (err instanceof StegoFrameError) {
    switch (err.code) {
      case StegoErrorCode.NOT_A_STEGO_FILE:
        return 'No DeepNetSecure v1 header in the LS bits (pixels do not contain our framed payload). Renaming foo.png→bar.png is safe and does not remove data—wrong file, or the image was altered: opening and re-saving the PNG in an editor, export to JPEG/WebP, cropping, chats/social/email that recompress, or screenshots. Use byte-identical Encode output: download PNG again from Encode, or ZIP from Encode.';
      case StegoErrorCode.WRONG_VERSION:
        return 'Unsupported stego frame version. Re-encode from the original message with the current app.';
      case StegoErrorCode.TRUNCATED:
        return 'Stego frame is truncated—the image dimensions may be wrong or payload length was corrupted. Use the unchanged lossless PNG from Encode.';
      default:
        return err.message;
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('Reed')) {
    return 'Reed–Solomon correction failed—the hidden byte stream does not match what Encode wrote. Typical causes: PNG re-saved/recompressed/cropped, or brightness edits (block order relies on unchanged upper bits). Use the byte-identical Encode PNG.';
  }
  if (msg.includes('ECC payload truncated') || msg.includes('ECC payload too short')) {
    return 'ECC layer truncated or corrupted. Use the exact Encode PNG (no conversions).';
  }
  return msg;
}

export default function ReceiverView() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageName, setImageName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recoveredMessage, setRecoveredMessage] = useState<string | null>(null);
  const [integrityStatus, setIntegrityStatus] = useState<'valid' | 'invalid' | null>(null);
  const [diagnostics, setDiagnostics] = useState<{ errorsCorrected: number } | null>(null);
  const [decodeMs, setDecodeMs] = useState<number | null>(null);
  const [exifData, setExifData] = useState<any>(null);
  const [lossyNameHint, setLossyNameHint] = useState(false);
  const [decodedMlPrep, setDecodedMlPrep] = useState<MlCoverPrepEmbedded | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const clearAsset = () => {
    setImage(null);
    setImageSrc(null);
    setExifData(null);
    setRecoveredMessage(null);
    setIntegrityStatus(null);
    setDiagnostics(null);
    setDecodeMs(null);
    setDecodedMlPrep(null);
    setLossyNameHint(false);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLossyNameHint(/\.(jpe?g|webp|gif)$/i.test(file.name));

    try {
      const metadata = await extractAllMetadata(file);
      setExifData(metadata);
    } catch (err) {
      console.warn("EXIF extraction failed", err);
      setExifData(null);
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const src = event.target?.result as string;
      const img = new Image();
      img.onload = () => {
        setImage(img);
        setImageSrc(src);
        setImageName(file.name);
        setError(null);
        setRecoveredMessage(null);
        setIntegrityStatus(null);
        setDiagnostics(null);
        setDecodeMs(null);
        setDecodedMlPrep(null);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const handleExtract = async () => {
    if (!image || !passphrase) {
      setError('MISSING PARAMETERS: Stego asset and decryption key required.');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setRecoveredMessage(null);
    setIntegrityStatus(null);
    setDiagnostics(null);
    setDecodeMs(null);
    setDecodedMlPrep(null);

    let tDecode0 = 0;
    try {
      await yieldToPaint();

      tDecode0 = performance.now();

      const canvas = canvasRef.current!;
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('DECODE: Canvas 2D context unavailable in this browser.');
      }
      ctx.drawImage(image, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const raw = extractData(imageData);
      const { decoded, errorsCorrected } = decodeECC(raw);
      setDiagnostics({ errorsCorrected });

      const encryptedString = bytesToString(decoded);
      const decryptedJson = decryptMessage(encryptedString, passphrase);

      if (!decryptedJson) {
        throw new Error('DECRYPTION FAILED: Incorrect key or catastrophic data corruption.');
      }

      const { pkg, isValid } = parsePackage(decryptedJson);

      const m = pkg.mlCoverPrep;
      setDecodedMlPrep(m && m.version === 1 ? m : null);
      setRecoveredMessage(pkg.message);
      setIntegrityStatus(isValid ? 'valid' : 'invalid');
      setDecodeMs(Math.round(performance.now() - tDecode0));

    } catch (err: any) {
      if (tDecode0 > 0) {
        setDecodeMs(Math.round(performance.now() - tDecode0));
      }
      setError(formatDecodeError(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const aspectRatio = image ? `${image.width / gcd(image.width, image.height)}:${image.height / gcd(image.width, image.height)}` : '';
  const totalPixels = image ? (image.width * image.height).toLocaleString() : '';
  const capacityBytes = image ? calculateCapacity(image.width, image.height) : 0;

  return (
    <div className="w-full grid grid-cols-1 xl:grid-cols-12 gap-8 xl:gap-10">
      <p className="col-span-full text-center text-[11px] sm:text-xs font-mono text-slate-500 uppercase tracking-[0.2em] px-2 leading-relaxed">
        Decode workflow:{' '}
        <span className="text-cyan-500/90">1 Stego file</span> ·{' '}
        <span className="text-indigo-400/90">2 Passphrase</span> ·{' '}
        <span className="text-emerald-500/90">3 Extract message</span>
      </p>

      {/* Left Column: Inputs */}
      <div className="space-y-8 xl:col-span-7 min-w-0">

        {/* Target Asset Panel */}
        <div className="bg-slate-900/80 border border-cyan-900/50 rounded-xl p-6 sm:p-8 shadow-[0_0_15px_rgba(8,145,178,0.1)] relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-cyan-500/0 via-cyan-500/50 to-cyan-500/0" />
          <h2 className="text-base sm:text-lg font-mono font-semibold text-cyan-400 flex flex-wrap items-center gap-3 mb-4 uppercase tracking-widest">
            <StepNum n={1} />
            <Scan className="w-5 h-5 shrink-0" /> Stego image
            <span className="w-full sm:w-auto text-[10px] font-mono font-normal normal-case tracking-normal text-slate-600 sm:ml-auto">
              Step 1 of 3
            </span>
          </h2>

          {!image ? (
            <div className="relative border-2 border-dashed border-cyan-900/50 rounded-lg p-8 text-center hover:bg-cyan-950/30 transition-colors group">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                aria-label="Choose stego image file to decode"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="space-y-3">
                <div className="w-12 h-12 rounded-full bg-cyan-950 border border-cyan-800 flex items-center justify-center mx-auto group-hover:scale-110 transition-transform">
                  <Upload className="w-5 h-5 text-cyan-500" />
                </div>
                <p className="text-sm font-mono text-cyan-300 tracking-widest uppercase">Open stego PNG</p>
                <p className="text-slate-500 text-sm font-sans normal-case tracking-normal max-w-sm mx-auto leading-relaxed">
                  Upload the <strong className="text-slate-400 font-medium">lossless Encode PNG</strong> (renaming{' '}
                  <strong className="text-slate-400 font-normal">only</strong> is OK). Avoid re-saving, cropping, JPEG/WebP, or chat recompression—they destroy LSB payload bits.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="relative rounded-lg overflow-hidden border border-cyan-800/50 bg-black/50 group">
                <img src={imageSrc!} alt="Target" className="w-full h-48 object-contain opacity-80 group-hover:opacity-100 transition-opacity" />
                <motion.div
                  animate={{ top: ['0%', '100%', '0%'] }}
                  transition={{ duration: 4, ease: "linear", repeat: Infinity }}
                  className="absolute left-0 right-0 h-0.5 bg-cyan-400/50 shadow-[0_0_10px_rgba(34,211,238,0.8)] z-10 pointer-events-none"
                />
                <div className="absolute top-2 right-2 bg-black/80 border border-cyan-500/30 px-2 py-1 rounded text-[10px] font-mono text-cyan-400 backdrop-blur-sm">
                  ASSET LOADED
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                <div className="bg-slate-950/50 border border-slate-800 p-2 rounded">
                  <span className="text-slate-500 block mb-1">RESOLUTION</span>
                  <span className="text-cyan-100">{image.width} × {image.height}</span>
                </div>
                <div className="bg-slate-950/50 border border-slate-800 p-2 rounded">
                  <span className="text-slate-500 block mb-1">ASPECT RATIO</span>
                  <span className="text-cyan-100">{aspectRatio}</span>
                </div>
                <div className="bg-slate-950/50 border border-slate-800 p-2 rounded">
                  <span className="text-slate-500 block mb-1">TOTAL PIXELS</span>
                  <span className="text-cyan-100">{totalPixels}</span>
                </div>
                <div className="bg-slate-950/50 border border-slate-800 p-2 rounded">
                  <span className="text-slate-500 block mb-1">MAX CAPACITY</span>
                  <span className="text-emerald-400">{(capacityBytes / 1024).toFixed(2)} KB</span>
                </div>
              </div>


              {exifData && Object.keys(exifData).length > 0 && (
                <div className="bg-slate-950/80 border border-cyan-900/30 rounded-lg">
                  <div className="flex items-center gap-2 text-cyan-400 p-4 border-b border-cyan-900/50 bg-cyan-950/20">
                    <Activity className="w-5 h-5 shrink-0" aria-hidden />
                    <span className="font-mono font-semibold tracking-wider text-sm uppercase">Deep Metadata Scan</span>
                    <span className="text-[11px] text-cyan-500/70 ml-auto">({Object.keys(exifData).length} fields)</span>
                  </div>

                  <div className="max-h-96 overflow-y-auto">
                    {/* GPS Data - Highlighted Section */}
                    {(exifData.latitude || exifData.GPSLatitude || exifData.gps?.latitude) && (
                      <div className="bg-emerald-950/40 border-b border-emerald-900/30 p-4">
                        <div className="text-emerald-400 font-bold text-sm mb-3 flex items-center gap-2">
                          <span>📍 GPS Location Data</span>
                          <span className="text-emerald-600 text-xs ml-auto font-semibold uppercase">HIGH PRIVACY</span>
                        </div>
                        <div className="space-y-2 text-sm">
                          {(exifData.latitude || exifData.GPSLatitude || exifData.gps?.latitude) && (
                            <div className="flex justify-between gap-2 text-emerald-200">
                              <span className="text-emerald-400 font-mono">Latitude:</span>
                              <span className="font-mono">{String(exifData.latitude || exifData.GPSLatitude || exifData.gps?.latitude)}</span>
                            </div>
                          )}
                          {(exifData.longitude || exifData.GPSLongitude || exifData.gps?.longitude) && (
                            <div className="flex justify-between gap-2 text-emerald-200">
                              <span className="text-emerald-400 font-mono">Longitude:</span>
                              <span className="font-mono">{String(exifData.longitude || exifData.GPSLongitude || exifData.gps?.longitude)}</span>
                            </div>
                          )}
                          {(exifData.altitude || exifData.GPSAltitude || exifData.gps?.altitude) && (
                            <div className="flex justify-between gap-2 text-emerald-200">
                              <span className="text-emerald-400 font-mono">Altitude:</span>
                              <span className="font-mono">{String(exifData.altitude || exifData.GPSAltitude || exifData.gps?.altitude)} m</span>
                            </div>
                          )}
                          <div className="mt-3 p-2.5 bg-emerald-950/60 rounded border border-emerald-900/40 text-[11px] text-emerald-300 leading-snug">
                            ⚠️ GPS data reveals location where photo was taken. Strip EXIF before sharing.
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Camera & Image Info */}
                    {(exifData.Model || exifData.Make || exifData.DateTimeOriginal || exifData.ExposureTime) && (
                      <div className="border-b border-slate-800/50 p-4">
                        <div className="text-cyan-400 font-bold text-sm mb-2">📷 Camera & Image Info</div>
                        <div className="space-y-1.5 text-sm">
                          {exifData.Make && (
                            <div className="flex justify-between gap-3">
                              <span className="text-slate-400 min-w-fit">Make:</span>
                              <span className="text-cyan-200">{String(exifData.Make)}</span>
                            </div>
                          )}
                          {exifData.Model && (
                            <div className="flex justify-between gap-3">
                              <span className="text-slate-400 min-w-fit">Model:</span>
                              <span className="text-cyan-200">{String(exifData.Model)}</span>
                            </div>
                          )}
                          {exifData.DateTimeOriginal && (
                            <div className="flex justify-between gap-3">
                              <span className="text-slate-400 min-w-fit">Taken:</span>
                              <span className="text-cyan-200">{String(exifData.DateTimeOriginal)}</span>
                            </div>
                          )}
                          {exifData.ExposureTime && (
                            <div className="flex justify-between gap-3">
                              <span className="text-slate-400 min-w-fit">Shutter:</span>
                              <span className="text-cyan-200 font-mono">{String(exifData.ExposureTime)}</span>
                            </div>
                          )}
                          {exifData.FNumber && (
                            <div className="flex justify-between gap-3">
                              <span className="text-slate-400 min-w-fit">F-Number:</span>
                              <span className="text-cyan-200 font-mono">{String(exifData.FNumber)}</span>
                            </div>
                          )}
                          {exifData.ISO && (
                            <div className="flex justify-between gap-3">
                              <span className="text-slate-400 min-w-fit">ISO:</span>
                              <span className="text-cyan-200 font-mono">{String(exifData.ISO)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* All Other Metadata */}
                    {Object.entries(exifData).filter(([k]) =>
                      !['latitude', 'longitude', 'altitude', 'GPSLatitude', 'GPSLongitude', 'GPSAltitude', 'gps', 'Make', 'Model', 'DateTimeOriginal', 'ExposureTime', 'FNumber', 'ISO'].includes(k)
                    ).length > 0 && (
                      <div className="p-4">
                        <div className="text-slate-400 font-bold text-sm mb-2">📊 Additional Metadata</div>
                        <div className="space-y-1.5 text-xs">
                          {Object.entries(exifData)
                            .filter(([k]) => !['latitude', 'longitude', 'altitude', 'GPSLatitude', 'GPSLongitude', 'GPSAltitude', 'gps', 'Make', 'Model', 'DateTimeOriginal', 'ExposureTime', 'FNumber', 'ISO'].includes(k))
                            .map(([k, v]) => (
                              <div key={k} className="flex justify-between gap-2 py-1 border-b border-slate-900/30">
                                <span className="text-slate-500 font-mono truncate">{k}:</span>
                                <span className="text-slate-400 text-right break-all">{String(v).substring(0, 60)}{String(v).length > 60 ? '...' : ''}</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <button onClick={clearAsset} className="text-[10px] font-mono text-red-400 hover:text-red-300 flex items-center gap-1 uppercase tracking-widest w-full justify-center border border-red-900/50 bg-red-950/30 py-2 rounded transition-colors">
                [ DELETE ASSET ]
              </button>
            </div>
          )}
        </div>

        {/* Decryption Panel */}
        <div className="bg-slate-900/80 border border-indigo-900/50 rounded-xl p-6 sm:p-8 shadow-[0_0_15px_rgba(99,102,241,0.1)] relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-indigo-500/0 via-indigo-500/50 to-indigo-500/0" />
          <h2 className="text-base sm:text-lg font-mono font-semibold text-indigo-400 flex flex-wrap items-center gap-3 mb-4 uppercase tracking-widest">
            <StepNum n={2} />
            <Unlock className="w-5 h-5 shrink-0" /> Passphrase
            <span className="w-full sm:w-auto text-[10px] font-mono font-normal normal-case tracking-normal text-slate-600 sm:ml-auto">
              Step 2 of 3
            </span>
          </h2>

          <div className="space-y-4 font-mono text-sm">
            <div>
              <label className="block text-slate-400 mb-2 text-sm uppercase tracking-wide">Same AES passphrase as encode</label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                className="w-full bg-slate-950 border border-indigo-900/50 rounded-lg px-3 py-3 text-indigo-100 text-base focus:outline-none focus:border-indigo-500/50"
                placeholder="Required"
                autoComplete="off"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Right Column: Terminal & Results */}
      <div className="space-y-6 xl:col-span-5 min-w-0">
        <div className="bg-slate-900/80 border border-emerald-900/50 rounded-xl p-6 sm:p-8 shadow-[0_0_15px_rgba(16,185,129,0.1)] relative overflow-hidden min-h-[520px] flex flex-col">
          <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-emerald-500/0 via-emerald-500/50 to-emerald-500/0" />
          <h2 className="text-base sm:text-lg font-mono font-semibold text-emerald-400 flex flex-wrap items-center gap-3 mb-4 uppercase tracking-widest">
            <StepNum n={3} />
            <Terminal className="w-5 h-5 shrink-0" /> Decode &amp; output
            <span className="w-full sm:w-auto text-[10px] font-mono font-normal normal-case tracking-normal text-slate-600 sm:ml-auto">
              Step 3 of 3
            </span>
          </h2>

          <div className="mb-4 rounded-lg border border-slate-700/80 bg-slate-950/60 px-3 py-2.5 text-sm space-y-2">
            <p className="text-slate-300 leading-snug">
              Same passphrase as Encode. Pipeline: extract LSB → Reed–Solomon → AES (no ML on this step).
            </p>
          </div>

          <button
            type="button"
            onClick={handleExtract}
            disabled={isProcessing || !image || !passphrase}
            title="Extract hidden data using your passphrase"
            className="w-full mb-5 bg-emerald-950/50 border border-emerald-500/35 hover:bg-emerald-900/80 text-emerald-200 py-4 rounded-xl font-semibold text-base uppercase tracking-wide transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Extract message
          </button>

          <div className="flex-1 bg-black/80 border border-slate-800 rounded-xl p-5 font-mono text-sm sm:text-base overflow-y-auto relative min-h-[220px]">
            <AnimatePresence mode="wait">
              {error && (
                <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="text-red-400 space-y-2 mb-4">
                  <div className="flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> SYSTEM ERROR</div>
                  <p className="pl-1 text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">{error}</p>
                </motion.div>
              )}

              {isProcessing && (
                <motion.div key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-emerald-400 space-y-3">
                  <div className="h-1 w-full rounded-full bg-slate-800 overflow-hidden mb-1">
                    <div className="h-full w-2/5 rounded-full bg-emerald-500/50 animate-pulse" />
                  </div>
                  <p className="animate-pulse">{'>'} SCANNING LSB CHANNELS...</p>
                  <p className="animate-pulse [animation-delay:150ms]">{'>'} EXTRACTING BITSTREAM...</p>
                  <p className="animate-pulse [animation-delay:300ms]">{'>'} APPLYING RS ECC DECODING...</p>
                  <p className="animate-pulse [animation-delay:450ms]">{'>'} ATTEMPTING AES DECRYPTION...</p>
                  <p className="animate-pulse [animation-delay:600ms] text-cyan-500/90">{'>'} OPTIONAL ML METADATA...</p>
                </motion.div>
              )}

              {recoveredMessage && !isProcessing && (
                <motion.div
                  key="result"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="space-y-3 flex flex-col h-full"
                >
                  {/* SUCCESS HEADER */}
                  <div className="flex items-start gap-3 rounded-lg border border-emerald-500/35 bg-emerald-950/25 px-3 py-2.5 pb-3 border-b">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-400/35 bg-emerald-500/15">
                      <CheckCircle className="h-5 w-5 text-emerald-400" aria-hidden />
                    </div>
                    <div>
                      <p className="text-emerald-300 font-semibold text-sm tracking-tight">✅ Decode complete</p>
                      <p className="text-slate-500 text-xs mt-0.5">Your message recovered and verified.</p>
                    </div>
                  </div>

                  {/* ML PREP RECORD - SIMPLIFIED */}
                  {decodedMlPrep ? (
                    <div className="rounded-lg border border-cyan-500/25 bg-cyan-950/20 px-2.5 py-1.5 text-[11px] text-slate-300 space-y-0.5">
                      <p className="font-mono text-[9px] uppercase tracking-widest text-cyan-500/90 mb-1">Embedded ML Prep Record</p>
                      <p className="leading-snug">
                        <strong>{decodedMlPrep.modelLabel}</strong> · Suitability: <strong className="text-emerald-400">{decodedMlPrep.suitability}</strong> · Confidence: <strong>{(decodedMlPrep.confidence * 100).toFixed(0)}%</strong>
                        {typeof decodedMlPrep.payloadVsCapacityPercent === 'number' ? (
                          <> · Payload: <strong>{decodedMlPrep.payloadVsCapacityPercent.toFixed(1)}%</strong></>
                        ) : null}
                        {typeof decodedMlPrep.predictedPsnrDb === 'number' ? (
                          <> · PSNR: <strong>{decodedMlPrep.predictedPsnrDb.toFixed(1)} dB</strong></>
                        ) : null}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-slate-600/50 bg-slate-950/50 px-2.5 py-1.5 text-xs text-slate-500">
                      No ML record embedded.
                    </div>
                  )}

                  {/* INTEGRITY CHECK - COMPACT */}
                  {integrityStatus === 'valid' ? (
                    <div className="p-2.5 bg-emerald-950/50 border border-emerald-500/30 rounded flex items-center gap-2 text-emerald-400 text-sm">
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                      <div>
                        <p className="font-bold text-[11px]">✅ INTEGRITY VERIFIED</p>
                        <p className="text-[10px] opacity-80">SHA-256 matches original.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-2.5 bg-red-950/50 border border-red-500/30 rounded flex items-center gap-2 text-red-400 text-sm">
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      <div>
                        <p className="font-bold text-[11px]">❌ INTEGRITY FAILED</p>
                        <p className="text-[10px] opacity-80">SHA-256 mismatch.</p>
                      </div>
                    </div>
                  )}

                  {/* DIAGNOSTICS - COMPACT GRID */}
                  {diagnostics && (
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="bg-slate-950 border border-slate-800 p-2 rounded">
                        <span className="block text-slate-500 mb-0.5 text-[10px] uppercase">Time</span>
                        <span className="text-indigo-400 font-semibold">{decodeMs != null ? `${decodeMs} ms` : '—'}</span>
                      </div>
                      <div className="bg-slate-950 border border-slate-800 p-2 rounded">
                        <span className="block text-slate-500 mb-0.5 text-[10px] uppercase">ECC Fixed</span>
                        <span className="text-indigo-400 font-semibold">{diagnostics.errorsCorrected}</span>
                      </div>
                      <div className="bg-slate-950 border border-slate-800 p-2 rounded">
                        <span className="block text-slate-500 mb-0.5 text-[10px] uppercase">Length</span>
                        <span className="text-indigo-400 font-semibold">{recoveredMessage.length} chars</span>
                      </div>
                    </div>
                  )}

                  {/* DECRYPTED MESSAGE - PROMINENT */}
                  <div className="flex-1 bg-gradient-to-b from-emerald-950/40 to-cyan-950/30 border-2 border-emerald-500/50 rounded-lg p-4 overflow-auto shadow-lg shadow-emerald-900/20">
                    <div className="text-emerald-300 mb-3 border-b border-emerald-600/40 pb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
                      <FileText className="w-5 h-5 text-emerald-400" /> DECRYPTED MESSAGE
                    </div>
                    <p className="text-emerald-100 whitespace-pre-wrap break-all text-base leading-relaxed font-sans">
                      {recoveredMessage}
                    </p>
                  </div>

                </motion.div>
              )}

              {!error && !isProcessing && !recoveredMessage && (
                <motion.div
                  key="idle-hint"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="rounded-lg border border-dashed border-slate-700/90 bg-slate-950/40 px-4 py-10 text-center h-full flex items-center justify-center"
                >
                  <p className="text-slate-500 text-sm leading-relaxed max-w-sm font-sans">
                    Output appears here after <strong className="text-emerald-500/90">Extract message</strong> succeeds—plaintext, timing, and integrity check.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Hidden canvas for processing */}
      <canvas ref={canvasRef} className="hidden" aria-hidden />
    </div>
  );
}
