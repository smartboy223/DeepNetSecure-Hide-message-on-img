"""Visual overlays complementary to CNN assessment — Sobel luminance magnitude (explainable spatial cue).

The trained Mobilenet softmax + physic heads run in analyze_image.run_keras().
Keras 3 rejects ad-hoc intermediate subgraph slicing on this saved model graph, so overlays use a
deterministic luminance Sobel RMS map (orthogonal to softmax; highlights edge/texture prominence).
"""

from __future__ import annotations

import base64
import io

import numpy as np


def texture_saliency_overlay_jpeg_base64(
    img_01_batch: np.ndarray,
    *,
    jpeg_quality: int = 82,
    alpha: float = 0.38,
    max_side: int = 224,
) -> str | None:
    """
    RMS of horizontal/vertical Sobel on luminance · jet colormap · blend onto RGB.
    Mirrors what convolutional tiers often respond to — without implying it is Conv feature maps.
    """
    try:
        from PIL import Image

        if img_01_batch.ndim != 4 or img_01_batch.shape[0] != 1:
            return None
        cov = img_01_batch[0].astype(np.float64)
        r, g, b = cov[..., 0], cov[..., 1], cov[..., 2]
        lum = np.clip(0.299 * r + 0.587 * g + 0.114 * b, 0.0, 1.0)

        gx = np.zeros_like(lum)
        gy = np.zeros_like(lum)
        gx[:, 1:-1] = lum[:, 2:] - lum[:, :-2]
        gx[:, 0] = lum[:, 1] - lum[:, 0]
        gx[:, -1] = lum[:, -1] - lum[:, -2]

        gy[1:-1, :] = lum[2:, :] - lum[:-2, :]
        gy[0, :] = lum[1, :] - lum[0, :]
        gy[-1, :] = lum[-1, :] - lum[-2, :]

        sal = np.sqrt(gx * gx + gy * gy)
        mx = float(np.nanmax(sal))
        if mx > 1e-12:
            sal = sal / mx

        def _pillow_resize(rgb: np.ndarray, h: int, w: int) -> np.ndarray:
            pil = Image.fromarray((np.clip(rgb, 0, 1) * 255.0).astype(np.uint8), "RGB")
            return np.asarray(pil.resize((w, h), Image.Resampling.BILINEAR), dtype=np.float64) / 255.0

        h_img = int(img_01_batch.shape[1])
        w_img = int(img_01_batch.shape[2])

        jet = np.zeros((sal.shape[0], sal.shape[1], 3), dtype=np.float64)
        t = sal.astype(np.float64)
        jet[..., 0] = np.clip(1.5 - np.abs(4 * t - 3), 0, 1)
        jet[..., 1] = np.clip(1.5 - np.abs(4 * t - 2), 0, 1)
        jet[..., 2] = np.clip(1.5 - np.abs(4 * t - 1), 0, 1)

        if jet.shape[0] != h_img or jet.shape[1] != w_img:
            jet = _pillow_resize(jet, h_img, w_img)

        alpha_f = float(np.clip(alpha, 0.08, 0.92))
        blend = np.clip(cov * (1.0 - alpha_f) + jet * alpha_f, 0.0, 1.0)

        nh, nw = h_img, w_img
        if max_side is not None and max(nh, nw) > max_side:
            sc = float(max_side) / float(max(h_img, w_img))
            nh = max(16, int(h_img * sc))
            nw = max(16, int(w_img * sc))

        pil_rgb = Image.fromarray((blend * 255.0).astype(np.uint8), "RGB").resize((nw, nh), Image.Resampling.BILINEAR)

        buf = io.BytesIO()
        pil_rgb.save(buf, format="JPEG", quality=int(jpeg_quality))
        buf.seek(0)
        encoded = base64.b64encode(buf.read()).decode("ascii")
        return encoded if encoded else None
    except Exception:
        return None
