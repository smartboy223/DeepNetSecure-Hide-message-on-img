import { motion } from 'motion/react';

const PHASES = [
  'Sweeping the cover raster — sampling RGB channels…',
  'LSB budget: matching encrypted payload to embed capacity…',
  'Spatial map: ranking texture blocks for bit placement…',
  'Neural pass: ML assessment on the cover image…',
  'Prep complete — encode unlocks when the model returns…',
] as const;

type Props = {
  active: boolean;
  phaseIndex: number;
};

export function MlCoverPrepAnimation({ active, phaseIndex }: Props) {
  const phase = PHASES[Math.min(phaseIndex, PHASES.length - 1)]!;

  return (
    <div className="space-y-4">
      {/* Mini “pixel field” with scanning beam */}
      <div className="relative overflow-hidden rounded-lg border border-cyan-900/50 bg-slate-950 aspect-[2/1] max-h-36">
        <div
          className="absolute inset-0 grid grid-rows-8 gap-px p-1 opacity-90"
          style={{ gridTemplateColumns: 'repeat(16, minmax(0, 1fr))' }}
        >
          {Array.from({ length: 128 }).map((_, i) => (
            <motion.div
              key={i}
              className="rounded-[1px] bg-cyan-500/20"
              animate={
                active
                  ? {
                      opacity: [0.15, 0.55, 0.15],
                      backgroundColor: ['rgba(6,182,212,0.12)', 'rgba(34,211,238,0.35)', 'rgba(6,182,212,0.12)'],
                    }
                  : { opacity: 0.12 }
              }
              transition={{
                duration: 2.4,
                repeat: active ? Infinity : 0,
                delay: (i % 17) * 0.04,
                ease: 'easeInOut',
              }}
            />
          ))}
        </div>
        {active ? (
          <motion.div
            className="absolute left-0 right-0 h-8 bg-linear-to-b from-cyan-400/25 via-cyan-300/10 to-transparent pointer-events-none"
            animate={{ top: ['-10%', '110%'] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: 'linear' }}
          />
        ) : null}
        <div className="absolute bottom-2 left-2 right-2 flex justify-between text-[10px] font-mono text-cyan-500/90 uppercase tracking-wider">
          <span>Pixel grid scan</span>
          <span>{active ? 'Searching LSB slots…' : 'Idle'}</span>
        </div>
      </div>

      <p className="text-cyan-200/95 text-xs font-mono leading-relaxed min-h-[2.75rem] border-l-2 border-cyan-500/40 pl-3">
        {phase}
      </p>
    </div>
  );
}

export const ML_PREP_PHASE_COUNT = PHASES.length;
