import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Upload, Database, Terminal, Scan, AlertTriangle, Activity, CheckCircle, Brain } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { extractAllMetadata } from '../core/metadata';
import { encryptMessage } from '../core/crypto';
import { encodeECC } from '../core/ecc';
import { embeddedStegoPayloadByteLength, embeddedStegoPayloadByteLengthEstimate } from '../core/payloadSize';
import { embedData, calculateCapacity, SPATIAL_BLOCK_PX } from '../core/stego';
import { createPackage, stringToBytes, type MlCoverPrepEmbedded } from '../core/package';
import { analyzeAsset, type AIAnalysisResponse } from '../core/ai';
import { calculatePSNR, calculateSSIM } from '../core/metrics';
import { StepNum } from './StepNum';
import { MlCoverPrepAnimation, ML_PREP_PHASE_COUNT } from './MlCoverPrepAnimation';
import { MlAssessmentResultPanel } from './MlAssessmentResultPanel';
import { yieldToPaint } from '../lib/uiTiming';
import { buildStegoTransferZip, triggerDownloadBlob } from '../lib/stegoZip';

const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);

function mlCoverPrepFromAnalysis(a: AIAnalysisResponse): MlCoverPrepEmbedded {
  const prep: MlCoverPrepEmbedded = {
    version: 1,
    modelLabel: a.backendDisplay ?? 'Trained classifier',
    suitability: a.image_suitability,
    confidence: a.confidence,
    payloadVsCapacityPercent: a.payloadCapacityPercent,
  };
  if (typeof a.predictedPsnrDb === 'number') {
    prep.predictedPsnrDb = a.predictedPsnrDb;
  }
  if (typeof a.predictedSsim === 'number') {
    prep.predictedSsim = a.predictedSsim;
  }
  if (a.classProbabilities) {
    prep.classProbabilities = { ...a.classProbabilities };
  }
  return prep;
}

export default function SenderView() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageName, setImageName] = useState('');
  const [message, setMessage] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysisResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<{
    psnr: number;
    ssim: number;
    payloadSize: number;
    capacity: number;
    encodeMs: number;
    predictedPsnrDb?: number;
    predictedSsim?: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isZipping, setIsZipping] = useState(false);
  const [exifData, setExifData] = useState<any>(null);
  const [livePayloadSize, setLivePayloadSize] = useState(0);
  const [mlPrepPhaseIdx, setMlPrepPhaseIdx] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const payloadMeterFillRef = useRef<HTMLDivElement>(null);

  const clearAsset = () => {
    setImage(null);
    setImageSrc(null);
    setExifData(null);
    setResultImage(null);
    setMetrics(null);
    setAiAnalysis(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  useEffect(() => {
    if (!message) {
      setLivePayloadSize(0);
      return;
    }
    try {
      if (passphrase) {
        const ml = aiAnalysis ? mlCoverPrepFromAnalysis(aiAnalysis) : undefined;
        setLivePayloadSize(embeddedStegoPayloadByteLength(message, passphrase, ml));
      } else {
        setLivePayloadSize(embeddedStegoPayloadByteLengthEstimate(message));
      }
    } catch {
      setLivePayloadSize(embeddedStegoPayloadByteLengthEstimate(message));
    }
  }, [message, passphrase, aiAnalysis]);

  useEffect(() => {
    setAiAnalysis(null);
  }, [message, passphrase]);

  useEffect(() => {
    if (!isAnalyzing) return;
    setMlPrepPhaseIdx(0);
    const id = window.setInterval(() => {
      setMlPrepPhaseIdx((n) => (n + 1) % ML_PREP_PHASE_COUNT);
    }, 650);
    return () => window.clearInterval(id);
  }, [isAnalyzing]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // Extract deep EXIF/XMP/IPTC data
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
        setAiAnalysis(null);
        setResultImage(null);
        setMetrics(null);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const handleAnalyze = async () => {
    if (!image || !message || !imageSrc || !passphrase) {
      setError('MISSING PARAMETERS: Cover, message, and passphrase are required for ML cover prep.');
      return;
    }

    const capacityBytes = calculateCapacity(image.width, image.height);
    const payloadBytes = embeddedStegoPayloadByteLength(message, passphrase);
    if (payloadBytes > capacityBytes) {
      setError(
        `Payload too large for this image (${payloadBytes} B needed, ${capacityBytes} B available). Shorten the message or use a larger cover.`
      );
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setAiAnalysis(null);

    try {
      const t0 = performance.now();
      const analysis = await analyzeAsset({
        imageSrc,
        capacityBytes,
        payloadBytes,
      });

      const minMs = 3000;
      const elapsed = performance.now() - t0;
      if (elapsed < minMs) {
        await new Promise((r) => setTimeout(r, minMs - elapsed));
      }

      setAiAnalysis(analysis);
    } catch (err: any) {
      setError(err.message || 'ML cover prep failed');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const suitabilityLower = (aiAnalysis?.image_suitability ?? '').toLowerCase();
  const mlBlocksEncode = suitabilityLower === 'low';
  const mlWarnMedium = suitabilityLower === 'medium';

  const handleHide = async () => {
    if (!image || !message || !passphrase) {
      setError('MISSING PARAMETERS: Target asset, payload, and encryption key required.');
      return;
    }
    if (!aiAnalysis) {
      setError('Run ML cover assessment (step 3) first — encode stays locked until prep completes.');
      return;
    }
    if (mlBlocksEncode) {
      setError(
        'ENCODE BLOCKED: ML suitability is LOW. Use a bigger or richer-texture cover, then Run ML assessment again.'
      );
      return;
    }

    const capacityPre = calculateCapacity(image.width, image.height);
    const mlPrep = mlCoverPrepFromAnalysis(aiAnalysis);
    const payloadLen = embeddedStegoPayloadByteLength(message, passphrase, mlPrep);
    if (payloadLen > capacityPre) {
      setError(
        `Payload too large for this image (${payloadLen} B needed, ${capacityPre} B available). Shorten the message or use a larger cover.`
      );
      return;
    }

    setIsProcessing(true);
    setError(null);
    setResultImage(null);
    setMetrics(null);

    try {
      await yieldToPaint();

      const tEncode0 = performance.now();
      const pkg = createPackage(message, {
        mlCoverPrep: mlPrep,
      });
      const encrypted = encryptMessage(pkg, passphrase);
      const encryptedBytes = stringToBytes(encrypted);
      const eccEncoded = encodeECC(encryptedBytes);
      
      const canvas = canvasRef.current!;
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      const originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      const originalCopy = new ImageData(
        new Uint8ClampedArray(originalImageData.data),
        originalImageData.width,
        originalImageData.height
      );

      const capacity = calculateCapacity(image.width, image.height);
      if (eccEncoded.length > capacity) {
        throw new Error(`CAPACITY EXCEEDED: Payload requires ${eccEncoded.length}B. Asset capacity is ${capacity}B.`);
      }
      
      const stegoImageData = embedData(originalImageData, eccEncoded);
      
      ctx.putImageData(stegoImageData, 0, 0);
      const stegoUrl = canvas.toDataURL('image/png');
      const psnr = calculatePSNR(originalCopy, stegoImageData);
      const ssim = calculateSSIM(originalCopy, stegoImageData);
      const encodeMs = Math.round(performance.now() - tEncode0);

      setResultImage(stegoUrl);
      setMetrics({
        psnr,
        ssim,
        payloadSize: eccEncoded.length,
        capacity,
        encodeMs,
        predictedPsnrDb: aiAnalysis.predictedPsnrDb,
        predictedSsim: aiAnalysis.predictedSsim,
      });

    } catch (err: any) {
      setError(err.message || 'Encoding sequence failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownloadZip = async () => {
    if (!resultImage) return;
    setIsZipping(true);
    setError(null);
    try {
      const safe = imageName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'image';
      const base = safe.replace(/\.[^.]+$/, '') || 'image';
      const pngInnerName = `stego_${base}.png`;
      const blob = await buildStegoTransferZip(resultImage, pngInnerName);
      triggerDownloadBlob(blob, `stego_${base}_transfer.zip`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not build ZIP archive.';
      setError(msg);
    } finally {
      setIsZipping(false);
    }
  };

  const aspectRatio = image ? `${image.width / gcd(image.width, image.height)}:${image.height / gcd(image.width, image.height)}` : '';
  const totalPixels = image ? (image.width * image.height).toLocaleString() : '';
  const capacityBytes = image ? calculateCapacity(image.width, image.height) : 0;
  const capacityExceeded = Boolean(
    image && capacityBytes > 0 && message && livePayloadSize > capacityBytes
  );

  useLayoutEffect(() => {
    const el = payloadMeterFillRef.current;
    if (!el) return;
    if (!image || capacityBytes <= 0) {
      el.style.width = '0%';
      return;
    }
    el.style.width = `${Math.min((livePayloadSize / capacityBytes) * 100, 100)}%`;
  }, [image, livePayloadSize, capacityBytes]);

  return (
    <div className="w-full grid grid-cols-1 xl:grid-cols-12 gap-8 xl:gap-10">
      <p className="col-span-full text-center text-[11px] sm:text-xs font-mono text-slate-500 uppercase tracking-[0.2em] px-2 leading-relaxed">
        Encode workflow:{' '}
        <span className="text-cyan-500/90">1 Cover</span> ·{' '}
        <span className="text-indigo-400/90">2 Payload</span> ·{' '}
        <span className="text-violet-400/95">3 ML intelligence</span> ·{' '}
        <span className="text-emerald-500/90">4 Stego output</span>
      </p>

      {/* Left Column: Inputs */}
      <div className="space-y-8 xl:col-span-7 min-w-0">
        
        {/* Target Asset Panel */}
        <div className="bg-slate-900/80 border border-cyan-900/50 rounded-xl p-6 sm:p-8 shadow-[0_0_15px_rgba(8,145,178,0.1)] relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-cyan-500/0 via-cyan-500/50 to-cyan-500/0" />
          <h2 className="text-base sm:text-lg font-mono font-semibold text-cyan-400 flex flex-wrap items-center gap-3 mb-4 uppercase tracking-widest">
            <StepNum n={1} />
            <Scan className="w-5 h-5 shrink-0" /> Target asset
            <span className="w-full sm:w-auto text-[10px] font-mono font-normal normal-case tracking-normal text-slate-600 sm:ml-auto">
              Step 1 of 4
            </span>
          </h2>
          
          {!image ? (
            <div className="relative border-2 border-dashed border-cyan-900/50 rounded-lg p-8 text-center hover:bg-cyan-950/30 transition-colors group">
              <input 
                ref={fileInputRef}
                type="file" 
                accept="image/*" 
                onChange={handleImageUpload}
                aria-label="Choose cover image file"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="space-y-3">
                <div className="w-12 h-12 rounded-full bg-cyan-950 border border-cyan-800 flex items-center justify-center mx-auto group-hover:scale-110 transition-transform">
                  <Upload className="w-5 h-5 text-cyan-500" />
                </div>
                <p className="text-sm font-mono text-cyan-300 tracking-widest uppercase">Select cover image</p>
                <p className="text-slate-500 text-sm font-sans normal-case tracking-normal max-w-sm mx-auto leading-relaxed">
                  Step 1 of 4: choose a PNG or JPG cover. Complete steps 2 → 3 (ML prep) → 4 encode.
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
                  ASSET ACQUIRED
                </div>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm font-mono">
                <div className="bg-slate-950/50 border border-slate-800 p-3 rounded-lg">
                  <span className="text-slate-500 block mb-1 text-xs uppercase tracking-wide">Resolution</span>
                  <span className="text-cyan-100">{image.width} × {image.height}</span>
                </div>
                <div className="bg-slate-950/50 border border-slate-800 p-3 rounded-lg">
                  <span className="text-slate-500 block mb-1 text-xs uppercase tracking-wide">Aspect</span>
                  <span className="text-cyan-100">{aspectRatio}</span>
                </div>
                <div className="bg-slate-950/50 border border-slate-800 p-3 rounded-lg">
                  <span className="text-slate-500 block mb-1 text-xs uppercase tracking-wide">Pixels</span>
                  <span className="text-cyan-100">{totalPixels}</span>
                </div>
                <div className="bg-slate-950/50 border border-slate-800 p-3 rounded-lg">
                  <span className="text-slate-500 block mb-1 text-xs uppercase tracking-wide">LSB capacity</span>
                  <span className="text-emerald-400">{(capacityBytes / 1024).toFixed(2)} KB</span>
                </div>
              </div>

              {exifData && Object.keys(exifData).length > 0 && (
                <div className="bg-slate-950/80 border border-cyan-900/40 p-4 rounded-lg text-sm font-mono mt-4">
                  <div className="flex items-center gap-2 text-cyan-400 mb-2 border-b border-cyan-900/50 pb-2">
                    <Activity className="w-4 h-4 shrink-0" />
                    <span className="font-semibold uppercase tracking-wide text-xs sm:text-sm">Source file tags (read-only)</span>
                  </div>
                  <div className="max-h-44 overflow-y-auto space-y-2 pr-1 text-xs sm:text-sm">
                    {Object.entries(exifData).map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-4 border-b border-slate-800/50 pb-2">
                        <span className="text-slate-500 shrink-0">{k}</span>
                        <span className="text-cyan-200/90 text-right break-all">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button type="button" onClick={clearAsset} className="text-sm font-mono text-red-400 hover:text-red-300 flex items-center gap-1 uppercase tracking-widest mt-4 w-full justify-center border border-red-900/50 bg-red-950/30 py-3 rounded-lg transition-colors">
                Remove image
              </button>
            </div>
          )}
        </div>

        {/* Payload Panel */}
        <div className="bg-slate-900/80 border border-indigo-900/50 rounded-xl p-6 sm:p-8 shadow-[0_0_15px_rgba(99,102,241,0.1)] relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-indigo-500/0 via-indigo-500/50 to-indigo-500/0" />
          <h2 className="text-base sm:text-lg font-mono font-semibold text-indigo-400 flex flex-wrap items-center gap-3 mb-4 uppercase tracking-widest">
            <StepNum n={2} />
            <Database className="w-5 h-5 shrink-0" /> Secret payload
            <span className="w-full sm:w-auto text-[10px] font-mono font-normal normal-case tracking-normal text-slate-600 sm:ml-auto">
              Step 2 of 4
            </span>
          </h2>
          
          <div className="space-y-5 font-mono text-sm">
            <div>
              <label className="block text-slate-400 mb-2 text-sm uppercase tracking-wide">Message to hide</label>
              <textarea 
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className={`w-full min-h-[120px] bg-slate-950 border rounded-lg p-4 text-indigo-100 text-base placeholder:text-slate-600 focus:outline-none resize-y ${
                  capacityExceeded
                    ? 'border-red-500/60 focus:border-red-500/70'
                    : 'border-indigo-900/50 focus:border-indigo-500/50'
                }`}
                placeholder="Type the text you want encrypted and hidden in the image…"
              />
              {capacityExceeded ? (
                <p className="mt-2 text-sm text-red-400/95 leading-snug">
                  Message is too large for this cover ({livePayloadSize.toLocaleString()} B after AES + ECC; max{' '}
                  {capacityBytes.toLocaleString()} B). Shorten the text or choose a larger image.
                </p>
              ) : null}
              <div className="text-slate-500 mt-2 flex flex-wrap justify-between items-center gap-2 text-sm">
                <span>
                  Est. embedded size: <strong className="text-slate-300">{livePayloadSize} B</strong>
                  {image && capacityBytes > 0 && (
                    <span className={`ml-2 ${livePayloadSize > capacityBytes ? 'text-red-400' : 'text-emerald-400'}`}>
                      ({((livePayloadSize / capacityBytes) * 100).toFixed(1)}% of image capacity)
                    </span>
                  )}
                </span>
                <span className="text-slate-500">{message.length} characters</span>
              </div>
              {image && capacityBytes > 0 && (
                <div className="w-full h-1 bg-slate-800 mt-2 rounded-full overflow-hidden">
                  <div
                    ref={payloadMeterFillRef}
                    className={`h-full ${livePayloadSize > capacityBytes ? 'bg-red-500' : 'bg-emerald-500'}`}
                  />
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-slate-400 mb-2 text-sm uppercase tracking-wide">AES passphrase</label>
                <input 
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  className="w-full bg-slate-950 border border-indigo-900/50 rounded-lg px-3 py-3 text-indigo-100 text-base focus:outline-none focus:border-indigo-500/50"
                  placeholder="Required to encode and decode"
                  autoComplete="off"
                />
              </div>
              <div className="rounded-lg border border-indigo-900/40 bg-slate-950/60 px-3 py-2.5 text-xs text-slate-400 flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono uppercase tracking-wide text-indigo-400/90">FEC layer</span>
                <span className="text-slate-300">ECC — Reed–Solomon (GF256, 223+32 per block)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Column: step 3 (required ML) + step 4 (encode) */}
      <div className="space-y-6 xl:col-span-5 min-w-0">
        {error ? (
          <div className="rounded-lg border border-red-900/50 bg-red-950/35 px-4 py-3 text-sm text-red-200 flex gap-3 items-start">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden />
            <div>
              <p className="font-semibold text-red-300">Error</p>
              <p className="text-slate-300 mt-1 leading-relaxed">{error}</p>
            </div>
          </div>
        ) : null}

        {/* Step 3 — ML cover assessment (required before encode) */}
        <div className="bg-slate-900/80 border border-cyan-900/50 rounded-xl p-6 sm:p-8 shadow-[0_0_15px_rgba(8,145,178,0.12)] relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-cyan-500/0 via-cyan-500/50 to-cyan-500/0" aria-hidden />
          <h2 className="text-base sm:text-lg font-mono font-semibold text-cyan-400 flex flex-wrap items-center gap-x-3 gap-y-2 mb-3 uppercase tracking-widest">
            <StepNum n={3} />
            <Brain className="w-5 h-5 shrink-0" aria-hidden />
            <span className="normal-case tracking-tight text-cyan-300">ML cover intelligence</span>
            <span className="w-full text-[10px] font-mono font-normal normal-case tracking-normal text-amber-500/90 sm:ml-auto sm:w-auto">
              Required before encode · step 3 of 4
            </span>
          </h2>
          <p className="text-slate-400 text-sm leading-snug mb-3">Prep required before step 4 encode.</p>
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={isAnalyzing || !image || !message || !passphrase || capacityExceeded}
            title="Requires cover, message, and passphrase — runs /api/analyze with animated prep"
            className="w-full bg-cyan-950/50 border border-cyan-500/35 hover:bg-cyan-900/80 text-cyan-200 py-4 px-3 rounded-xl text-sm sm:text-base font-semibold uppercase tracking-wide transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed min-h-13 font-mono"
          >
            {isAnalyzing ? 'ML assessment in progress…' : 'Run ML cover assessment & prep'}
          </button>
          <div className="mt-4 min-h-[72px] bg-black/50 border border-slate-800/80 rounded-xl p-3 font-mono text-sm relative">
            <AnimatePresence mode="wait">
              {isAnalyzing && image ? (
                <motion.div
                  key="analyzing"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-cyan-400"
                >
                  <MlCoverPrepAnimation active phaseIndex={mlPrepPhaseIdx} />
                </motion.div>
              ) : null}
              {aiAnalysis && !isAnalyzing && (
                <motion.div key="analysis-result" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-slate-300">
                  <MlAssessmentResultPanel analysis={aiAnalysis} />
                </motion.div>
              )}
            </AnimatePresence>
            {!isAnalyzing && !aiAnalysis ? (
              <p className="font-sans text-slate-400 text-sm sm:text-base text-center py-3 leading-relaxed">
                ML scores appear here after prep.
              </p>
            ) : null}
          </div>
        </div>

        {/* Step 4 — encode & output */}
        <div className="bg-slate-900/80 border border-emerald-900/50 rounded-xl p-6 sm:p-8 shadow-[0_0_15px_rgba(16,185,129,0.1)] relative overflow-hidden min-h-[280px] flex flex-col">
          <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-emerald-500/0 via-emerald-500/50 to-emerald-500/0" aria-hidden />
          <h2 className="text-base sm:text-lg font-mono font-semibold text-emerald-400 flex flex-wrap items-center gap-3 mb-4 uppercase tracking-widest">
            <StepNum n={4} />
            <Terminal className="w-5 h-5 shrink-0" /> Encode &amp; output
            <span className="w-full sm:w-auto text-[10px] font-mono font-normal normal-case tracking-normal text-slate-600 sm:ml-auto">
              Step 4 of 4
            </span>
          </h2>

          <button
            type="button"
            onClick={handleHide}
            disabled={isProcessing || !image || !message || !passphrase || !aiAnalysis || capacityExceeded || mlBlocksEncode}
            title={
              !aiAnalysis
                ? 'Complete ML cover assessment (step 3) first'
                : mlBlocksEncode
                  ? 'Suitability is LOW — choose a better cover and re-run ML assessment'
                  : 'Encrypt, apply Reed–Solomon ECC, embed in image — produces downloadable PNG'
            }
            className="w-full mb-5 bg-emerald-950/50 border border-emerald-500/35 hover:bg-emerald-900/80 text-emerald-200 py-4 px-3 rounded-xl text-sm sm:text-base font-semibold uppercase tracking-wide transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed min-h-13 font-mono"
          >
            Encode stego image
          </button>
          {!aiAnalysis && image && message && passphrase ? (
            <p className="mb-4 text-center text-sm font-mono text-amber-500/90 uppercase tracking-wide">
              Locked — finish ML cover assessment in step 3
            </p>
          ) : null}
          {aiAnalysis && mlBlocksEncode ? (
            <p className="mb-4 text-center text-sm font-mono text-red-400/95 leading-relaxed px-1">
              Encode disabled: ML suitability is <strong className="text-red-300">LOW</strong>. Use a larger or richer-texture photo, run step 3 again.
            </p>
          ) : null}
          {aiAnalysis && mlWarnMedium && !mlBlocksEncode ? (
            <p className="mb-4 text-center text-sm font-mono text-amber-500/95 leading-relaxed px-1">
              Medium suitability — watch PSNR vs predicted values below after Encode.
            </p>
          ) : null}

          <div className="flex-1 bg-black/80 border border-slate-800 rounded-xl p-5 font-mono text-sm sm:text-base overflow-y-auto relative min-h-[220px]">
            <AnimatePresence mode="wait">
              {isProcessing && (
                <motion.div key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-emerald-400 space-y-3 text-sm">
                  <div className="h-1 w-full rounded-full bg-slate-800 overflow-hidden mb-3">
                    <div className="h-full w-2/5 rounded-full bg-emerald-500/50 animate-pulse" />
                  </div>
                  <p className="animate-pulse">Encrypting payload…</p>
                  <p className="animate-pulse text-slate-500 [animation-delay:120ms]">Applying Reed–Solomon ECC and embedding in image…</p>
                </motion.div>
              )}

              {resultImage && metrics && !isProcessing && (
                <motion.div
                  key="result"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="space-y-4 rounded-xl border border-emerald-500/35 bg-emerald-950/20 p-5 shadow-[0_0_24px_rgba(16,185,129,0.08)]"
                >
                  {/* SUCCESS HEADER */}
                  <div className="flex items-start gap-3 pb-3 border-b border-emerald-500/20">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-emerald-400/35 bg-emerald-500/15">
                      <CheckCircle className="h-5 w-5 text-emerald-400" aria-hidden />
                    </div>
                    <div>
                      <p className="text-emerald-300 font-semibold text-base tracking-tight">✅ Encode complete</p>
                      <p className="text-slate-500 text-xs mt-1 leading-relaxed">
                        Your data is hidden. Ready to download.
                      </p>
                    </div>
                  </div>

                  {/* METRICS GRID - SIMPLIFIED */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
                    <div className="bg-slate-950 border border-slate-800 p-2.5 rounded">
                      <span className="block text-slate-500 mb-0.5 text-[10px] uppercase tracking-wide">Time</span>
                      <span className="text-emerald-400 font-semibold text-sm">{metrics.encodeMs} ms</span>
                    </div>
                    <div className="bg-slate-950 border border-slate-800 p-2.5 rounded">
                      <span className="block text-slate-500 mb-0.5 text-[10px] uppercase tracking-wide">PSNR</span>
                      <span className="text-emerald-400 font-semibold text-sm">
                        {Number.isFinite(metrics.psnr) ? `${metrics.psnr.toFixed(2)}` : '—'} dB
                      </span>
                    </div>
                    <div className="bg-slate-950 border border-slate-800 p-2.5 rounded">
                      <span className="block text-slate-500 mb-0.5 text-[10px] uppercase tracking-wide">SSIM</span>
                      <span className="text-emerald-400 font-semibold text-sm">{metrics.ssim.toFixed(4)}</span>
                    </div>
                    <div className="bg-slate-950 border border-slate-800 p-2.5 rounded">
                      <span className="block text-slate-500 mb-0.5 text-[10px] uppercase tracking-wide">Payload</span>
                      <span className="text-emerald-400 font-semibold text-sm">{metrics.payloadSize} B</span>
                    </div>
                    <div className="bg-slate-950 border border-slate-800 p-2.5 rounded">
                      <span className="block text-slate-500 mb-0.5 text-[10px] uppercase tracking-wide">Density</span>
                      <span className="text-emerald-400 font-semibold text-sm">{((metrics.payloadSize / metrics.capacity) * 100).toFixed(1)}%</span>
                    </div>
                  </div>

                  {/* PREDICTED VS ACTUAL - SIMPLIFIED */}
                  {(typeof metrics.predictedPsnrDb === 'number' || typeof metrics.predictedSsim === 'number') && (
                    <div className="rounded-lg border border-violet-500/30 bg-violet-950/25 px-3 py-2 text-xs">
                      <p className="font-mono text-[9px] uppercase tracking-widest text-violet-400/95 mb-1">Predicted vs Actual</p>
                      <div className="space-y-1 text-violet-200/90 text-[11px] leading-tight">
                        <p>
                          Pred: {typeof metrics.predictedPsnrDb === 'number' ? `${metrics.predictedPsnrDb.toFixed(2)} dB` : '—'} · {typeof metrics.predictedSsim === 'number' ? `${metrics.predictedSsim.toFixed(4)}` : '—'}
                        </p>
                        <p className="text-slate-400">
                          Actual: <strong className="text-emerald-300">{Number.isFinite(metrics.psnr) ? `${metrics.psnr.toFixed(2)} dB` : '—'} · {metrics.ssim.toFixed(4)}</strong>
                        </p>
                      </div>
                    </div>
                  )}

                  {/* DOWNLOAD BUTTONS */}
                  <div className="flex flex-col gap-2.5 pt-2">
                    <a
                      href={resultImage}
                      download={`stego_${imageName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'image.png'}`}
                      className="block w-full bg-emerald-500/20 border border-emerald-500/40 hover:bg-emerald-500/30 text-emerald-200 text-center py-3 rounded-lg transition-colors duration-200 font-semibold text-sm"
                    >
                      ↓ Download PNG
                    </a>
                    <button
                      type="button"
                      onClick={handleDownloadZip}
                      disabled={isZipping}
                      className="w-full bg-slate-800/60 border border-slate-600/40 hover:bg-slate-700/70 text-slate-200 text-center py-3 rounded-lg transition-colors duration-200 font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isZipping ? '...Building ZIP' : '↓ Download ZIP (PNG + README)'}
                    </button>
                    <p className="text-slate-500 text-[10px] leading-snug text-center">
                      Use your passphrase on Decode. ZIP is not password-protected.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {!isProcessing && !resultImage ? (
              <p className="font-sans text-slate-400 text-sm sm:text-base text-center py-10 px-2 leading-relaxed max-w-md mx-auto">
                Stego output and download appear here after encode.
              </p>
            ) : null}
          </div>
        </div>
      </div>
      
      {/* Hidden canvas for processing */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
