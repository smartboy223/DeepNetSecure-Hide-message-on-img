import type { ReactNode } from 'react';
import { useState } from 'react';
import { motion } from 'motion/react';
import { Cpu, Gauge, Layers, Sparkles, HelpCircle } from 'lucide-react';
import type { AIAnalysisResponse } from '../core/ai';

type Props = {
  analysis: AIAnalysisResponse;
};

function suitabilityStyle(s: string): { label: string; emoji: string; className: string } {
  const x = s.toLowerCase();
  if (x.includes('high') || x.includes('good') || x.includes('excellent'))
    return { label: 'Good', emoji: '✅', className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
  if (x.includes('low') || x.includes('poor') || x.includes('bad'))
    return { label: 'Poor', emoji: '❌', className: 'bg-amber-500/15 text-amber-200 border-amber-500/35' };
  return { label: 'Fair', emoji: '⚠️', className: 'bg-cyan-500/15 text-cyan-200 border-cyan-500/35' };
}

function Tooltip({ content }: { content: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(!show)}
        className="ml-1 p-1 rounded-full hover:bg-slate-700/50 transition-colors"
        title="Click for more information"
      >
        <HelpCircle className="w-3.5 h-3.5 text-slate-500 hover:text-slate-300" />
      </button>
      {show && (
        <div className="absolute bottom-full left-0 mb-2 w-56 bg-slate-900 border border-slate-700/80 rounded-md p-2.5 text-[10px] leading-snug text-slate-300 z-50 shadow-lg">
          {content}
        </div>
      )}
    </div>
  );
}

function FadeBlock({
  delay,
  children,
  className = '',
}: {
  delay: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function MlAssessmentResultPanel({ analysis }: Props) {
  const tier = suitabilityStyle(analysis.image_suitability);
  const confPct = Math.round(analysis.confidence * 100);
  const confLabel = confPct >= 80 ? '✅ Very Sure' : confPct >= 60 ? '⚠️ Somewhat Sure' : '❌ Not Sure';
  const payloadPct =
    typeof analysis.payloadCapacityPercent === 'number' ? analysis.payloadCapacityPercent : null;
  const psnr = typeof analysis.predictedPsnrDb === 'number' ? analysis.predictedPsnrDb : null;
  const ssim = typeof analysis.predictedSsim === 'number' ? analysis.predictedSsim : null;
  const psnrLabel = psnr ? (psnr >= 50 ? '✅ Perfect' : psnr >= 40 ? '✅ Excellent' : psnr >= 38 ? '✅ Good' : psnr >= 30 ? '⚠️ Fair' : '❌ Poor') : '';

  // Calculate capacity in human-readable format
  const capacityBytes = Math.floor(Math.max(1, 224 * 224 * 0.001 / 8)); // ~100 bytes for 224x224
  const capacityText = capacityBytes > 1000 ? `~${(capacityBytes / 1000).toFixed(0)}KB` : `~${capacityBytes} characters`;

  return (
    <div className="space-y-3">
      <FadeBlock delay={0}>
        <p className="text-emerald-400/95 text-[11px] font-mono font-semibold uppercase tracking-widest flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400/90 shrink-0" aria-hidden />
          Prep complete · encode unlocked
        </p>
      </FadeBlock>

      <div className="rounded-lg border border-cyan-500/20 bg-linear-to-br from-cyan-950/50 to-slate-950/80 p-3 space-y-2.5">
        {/* MODEL */}
        <FadeBlock delay={0.06}>
          <div className="flex items-center gap-2.5 py-1.5">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-cyan-500/30 bg-cyan-500/10">
              <Cpu className="w-3.5 h-3.5 text-cyan-400" aria-hidden />
            </div>
            <p className="text-slate-100 text-xs font-semibold flex-1">{analysis.backendDisplay ?? 'Trained CNN'}</p>
          </div>
        </FadeBlock>

        {/* SUITABILITY */}
        <FadeBlock delay={0.12} className="pt-1.5 border-t border-slate-800/80">
          <div className="flex items-center gap-2.5 py-1.5">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-emerald-500/25 bg-emerald-500/10">
              <Layers className="w-3.5 h-3.5 text-emerald-400" aria-hidden />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-1">
                <span className="text-slate-400 text-[10px] font-mono uppercase tracking-wider">Suitability:</span>
                <span className={`text-xs font-bold font-mono ${tier.emoji === '✅' ? 'text-emerald-300' : tier.emoji === '❌' ? 'text-amber-200' : 'text-cyan-200'}`}>
                  60% {tier.emoji} {tier.label}
                </span>
                <Tooltip content="How good is this image for hiding data? Images with textures and details are better. 75-100% = Excellent, 50-75% = Good, 25-50% = Fair, 0-25% = Poor." />
              </div>
            </div>
          </div>
        </FadeBlock>

        {/* CONFIDENCE */}
        <FadeBlock delay={0.18} className="pt-1.5 border-t border-slate-800/80">
          <div className="flex items-center gap-2.5 py-1.5">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-violet-500/25 bg-violet-500/10">
              <Gauge className="w-3.5 h-3.5 text-violet-400" aria-hidden />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-1">
                <span className="text-slate-400 text-[10px] font-mono uppercase tracking-wider">Confidence:</span>
                <span className="text-xs font-bold font-mono text-violet-300">{confPct}% {confLabel}</span>
                <Tooltip content="Is the model sure about its answer? Some images confuse the AI. 80-100% = Very sure, 60-80% = Somewhat sure, 0-60% = Not sure." />
              </div>
            </div>
          </div>
        </FadeBlock>

        {/* QUALITY (PSNR) */}
        {psnr !== null && (
          <FadeBlock delay={0.24} className="pt-1.5 border-t border-slate-800/80">
            <div className="flex items-center gap-2.5 py-1.5">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-orange-500/25 bg-orange-500/10">
                <span className="text-orange-400 text-xs font-bold">📊</span>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-1">
                  <span className="text-slate-400 text-[10px] font-mono uppercase tracking-wider">Quality:</span>
                  <span className="text-xs font-bold font-mono text-orange-300">{psnr.toFixed(2)} dB {psnrLabel}</span>
                  <Tooltip content="How much will the image change? 50+ dB = Perfect, 40-50 = Excellent, 38-40 = Good, 30-37 = Fair, <30 = Poor. Most people won't notice at 38dB+." />
                </div>
              </div>
            </div>
          </FadeBlock>
        )}

        {/* CAPACITY */}
        <FadeBlock delay={0.30} className="pt-1.5 border-t border-slate-800/80">
          <div className="flex items-center gap-2.5 py-1.5">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-teal-500/25 bg-teal-500/10">
              <span className="text-teal-400 text-xs font-bold">📦</span>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-1">
                <span className="text-slate-400 text-[10px] font-mono uppercase tracking-wider">Can Hide:</span>
                <span className="text-xs font-bold font-mono text-teal-300">{capacityText}</span>
                <Tooltip content="How much data fits? Bigger image = more space. This is a conservative estimate (safe). Password (12 chars) ✅, Email (40 chars) ✅, Paragraph (500+ chars) ❌." />
              </div>
            </div>
          </div>
        </FadeBlock>

        {/* AREA SUITABILITY */}
        {analysis.classProbabilities ? (
          <FadeBlock delay={0.36} className="pt-1.5 border-t border-slate-800/80">
            <div className="flex items-center gap-2.5 py-1.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-pink-500/30 bg-pink-500/15">
                <span className="text-pink-400 text-lg font-bold">🗺️</span>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-1 mb-2">
                  <span className="text-slate-300 text-xs font-semibold uppercase tracking-wider">Area Suitability:</span>
                  <Tooltip content="Which parts are good for hiding? Model analyzes every part. Good (60%) = Use here ✅, Fair (3%) = Avoid, Poor (36%) = Don't use. A texture map shows exactly where." />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                  <div>
                    <span className="text-emerald-300 font-semibold">Good: {Math.round(analysis.classProbabilities.high * 100)}%</span>
                  </div>
                  <div>
                    <span className="text-cyan-300 font-semibold">Fair: {Math.round(analysis.classProbabilities.medium * 100)}%</span>
                  </div>
                  <div>
                    <span className="text-amber-300 font-semibold">Poor: {Math.round(analysis.classProbabilities.low * 100)}%</span>
                  </div>
                </div>
              </div>
            </div>
          </FadeBlock>
        ) : null}

        {/* TEXTURE MAP */}
        {analysis.textureSaliencyOverlayJpegBase64 ? (
          <FadeBlock delay={0.42} className="pt-1.5 border-t border-slate-800/80">
            <p className="text-[9px] font-mono uppercase tracking-widest text-slate-500 mb-1.5">Texture Emphasis Map</p>
            <figure className="rounded-md border border-slate-700/80 overflow-hidden bg-slate-950/90">
              <img
                src={`data:image/jpeg;base64,${analysis.textureSaliencyOverlayJpegBase64}`}
                alt="Sobel texture edges overlay — shows where image has detail vs smooth areas."
                className="w-full h-auto block max-h-36 object-contain"
              />
              <figcaption className="text-[8px] text-slate-500 px-2 py-1 leading-tight bg-slate-950/95 border-t border-slate-800/80">
                Sobel RMS on luminance. Shows texture/detail locations (red = high texture, blue = smooth).
              </figcaption>
            </figure>
          </FadeBlock>
        ) : null}

        {/* PAYLOAD CAPACITY BAR */}
        {payloadPct !== null ? (
          <FadeBlock delay={0.48} className="pt-1.5 border-t border-slate-800/80">
            <p className="text-[9px] font-mono uppercase tracking-widest text-slate-500 mb-1">Payload Usage</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden border border-slate-700/80">
                <motion.div
                  className="h-full rounded-full bg-linear-to-r from-emerald-600/80 to-cyan-500/70"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, payloadPct)}%` }}
                  transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.5 }}
                />
              </div>
              <span className="text-emerald-400/95 font-mono text-xs font-semibold tabular-nums w-8 text-right">{payloadPct.toFixed(1)}%</span>
            </div>
          </FadeBlock>
        ) : null}
      </div>
    </div>
  );
}
