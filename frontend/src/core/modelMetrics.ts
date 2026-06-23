/**
 * Training metrics from cnn_model/evaluation_metrics.json (GET /api/metrics).
 * Written by backend/train_embed_mlp.py or train_embed_cnn.py after training.
 */

export type ModelMetricsDoc = Record<string, unknown>;

export async function fetchModelMetrics(): Promise<ModelMetricsDoc | null> {
  try {
    const r = await fetch('/api/metrics');
    if (!r.ok) return null;
    const data = (await r.json()) as ModelMetricsDoc;
    if (data && typeof data.error === 'string') return null;
    return data;
  } catch {
    return null;
  }
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** One or two lines for the Operations panel (honest about pseudo-labels). */
export function formatMetricsSummary(m: ModelMetricsDoc): string {
  const backend = typeof m.backend === 'string' ? m.backend : 'local_ml';
  const acc =
    num(m.final_val_accuracy) ??
    num(m.val_accuracy) ??
    num(m.val_accuracy_sklearn);
  const f1 = num(m.val_macro_f1);
  const parts: string[] = [];
  if (acc !== undefined) parts.push(`validation accuracy ${(acc * 100).toFixed(1)}%`);
  if (f1 !== undefined) parts.push(`macro F1 ${(f1 * 100).toFixed(1)}%`);
  const head = parts.length ? `${parts.join(' · ')}` : 'metrics file present';
  const note =
    typeof m.label_note === 'string'
      ? m.label_note
      : 'Labels are a rule-based proxy (entropy + edges), not hand-annotated ground truth.';
  return `${backend}: ${head}. ${note}`;
}

/** Single short line for compact UI (no label disclaimer). */
export function formatMetricsShort(m: ModelMetricsDoc): string {
  const acc =
    num(m.final_val_accuracy) ?? num(m.val_accuracy) ?? num(m.val_accuracy_sklearn);
  if (acc === undefined) return '';
  const shortBackend =
    typeof m.backend === 'string'
      ? m.backend.replace(/^sklearn_/, '').replace(/^keras_/, '').slice(0, 12)
      : 'model';
  return `${shortBackend} · val ${(acc * 100).toFixed(0)}%`;
}

/** Plain-language line for the Encode panel (no jargon). */
export function formatMetricsPlain(m: ModelMetricsDoc): string {
  const acc =
    num(m.final_val_accuracy) ?? num(m.val_accuracy) ?? num(m.val_accuracy_sklearn);
  if (acc === undefined) return '';
  return `ML cover assessment (step 3): ~${Math.round(acc * 100)}% on sample images (training).`;
}
