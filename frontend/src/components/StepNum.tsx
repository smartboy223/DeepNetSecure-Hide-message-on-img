type StepNumProps = {
  /** Main step index (Encode 1–4, Decode 1–3, etc.) */
  n: number | string;
  /** Marks optional steps (e.g. trained CNN before encode) */
  optional?: boolean;
};

export function StepNum({ n, optional }: StepNumProps) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-600 bg-slate-900/90 text-slate-300 text-sm font-bold font-mono">
      {n}
      {optional ? (
        <span className="sr-only"> (optional step)</span>
      ) : null}
    </span>
  );
}

/** Small label beside a step title, e.g. “Optional”. */
export function StepOptionalBadge() {
  return (
    <span className="ml-2 rounded border border-slate-600/80 bg-slate-900/80 px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-500">
      Optional
    </span>
  );
}
