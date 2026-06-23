export interface AIAnalysisRequest {
  imageSrc: string; // base64 data URL
  capacityBytes: number;
  payloadBytes: number;
}

export interface TierProbabilities {
  low: number;
  medium: number;
  high: number;
}

export interface AIAnalysisResponse {
  image_suitability: string;
  recovery_risk: string;
  recommended_profile: string;
  confidence: number;
  notes: string;
  /** sklearn_mlp | keras_mobilenet | pseudo_heuristic */
  modelBackend?: string;
  /** Short label for UI, e.g. "Trained MLP" */
  backendDisplay?: string;
  /** Payload size as % of LSB capacity */
  payloadCapacityPercent?: number;
  /** Predicted PSNR (dB) at training-time embed density (~ labels.json density). */
  predictedPsnrDb?: number;
  /** Predicted SSIM before embed (same simulator as training labels). */
  predictedSsim?: number;
  /** Full softmax masses over low/medium/high when backend provides them. */
  classProbabilities?: TierProbabilities;
  /** Sobel luminance texture overlay (JPEG base64, no data-URL prefix). */
  textureSaliencyOverlayJpegBase64?: string;
  suggested_metadata: {
    make: string;
    model: string;
    latitude: string;
    longitude: string;
    datetime: string;
  };
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/**
 * Local CNN (trained via backend/train_embed_cnn.py) — no cloud API.
 */
export async function analyzeAsset(request: AIAnalysisRequest): Promise<AIAnalysisResponse> {
  const blob = await dataUrlToBlob(request.imageSrc);
  const form = new FormData();
  form.append('image', blob, 'cover.png');
  form.append('capacityBytes', String(request.capacityBytes));
  form.append('payloadBytes', String(request.payloadBytes));

  const response = await fetch('/api/analyze', {
    method: 'POST',
    body: form,
  });

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const errCode = typeof data?.error === 'string' ? data.error : '';
    const detail = typeof data?.detail === 'string' ? data.detail : '';
    const hint = typeof data?.message === 'string' ? data.message : '';
    const msg =
      detail || hint
        ? [errCode, detail || hint].filter(Boolean).join(': ')
        : errCode || `Analysis failed (${response.status})`;
    throw new Error(msg);
  }

  if (data && data.ok === false) {
    const m = typeof data.message === 'string' ? data.message : 'Model not available. Train the CNN first.';
    throw new Error(m);
  }

  const suitability = data?.image_suitability;
  if (typeof suitability !== 'string') {
    throw new Error('Invalid response from analysis service.');
  }

  const payloadPct = data?.payload_capacity_percent;
  const pPsnr = data?.predicted_psnr_db;
  const pSsim = data?.predicted_ssim;

  let classProbabilities: TierProbabilities | undefined;
  const cp = data?.class_probabilities as Record<string, unknown> | undefined;
  if (
    cp &&
    typeof cp.low === 'number' &&
    typeof cp.medium === 'number' &&
    typeof cp.high === 'number'
  ) {
    classProbabilities = {
      low: cp.low as number,
      medium: cp.medium as number,
      high: cp.high as number,
    };
  }

  let textureB64 =
    typeof data?.texture_saliency_overlay_jpeg_base64 === 'string'
      ? data.texture_saliency_overlay_jpeg_base64
      : typeof (data as Record<string, unknown>)?.cnn_activation_overlay_jpeg_base64 === 'string'
        ? ((data as Record<string, unknown>).cnn_activation_overlay_jpeg_base64 as string)
        : undefined;

  return {
    image_suitability: suitability,
    recovery_risk: String(data?.recovery_risk ?? 'medium'),
    recommended_profile: String(data?.recommended_profile ?? ''),
    confidence: typeof data?.confidence === 'number' ? data.confidence : 0,
    notes: String(data?.notes ?? ''),
    modelBackend: typeof data?.model_backend === 'string' ? data.model_backend : undefined,
    backendDisplay: typeof data?.backend_display === 'string' ? data.backend_display : undefined,
    payloadCapacityPercent: typeof payloadPct === 'number' ? payloadPct : undefined,
    predictedPsnrDb: typeof pPsnr === 'number' ? pPsnr : undefined,
    predictedSsim: typeof pSsim === 'number' ? pSsim : undefined,
    classProbabilities,
    textureSaliencyOverlayJpegBase64: textureB64,
    suggested_metadata: {
      make: String((data?.suggested_metadata as AIAnalysisResponse['suggested_metadata'])?.make ?? ''),
      model: String((data?.suggested_metadata as AIAnalysisResponse['suggested_metadata'])?.model ?? ''),
      latitude: String((data?.suggested_metadata as AIAnalysisResponse['suggested_metadata'])?.latitude ?? ''),
      longitude: String((data?.suggested_metadata as AIAnalysisResponse['suggested_metadata'])?.longitude ?? ''),
      datetime: String((data?.suggested_metadata as AIAnalysisResponse['suggested_metadata'])?.datetime ?? ''),
    },
  };
}
