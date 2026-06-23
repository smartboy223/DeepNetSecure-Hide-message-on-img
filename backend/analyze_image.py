#!/usr/bin/env python3
"""
Local ML analysis for the sender UI (Keras CNN preferred, sklearn MLP fallback, heuristic last).
Outputs JSON including full softmax tiers, physic-head PSNR/SSIM, optional Grad-CAM overlay.

Priority (default CNN-first — set DEEPNET_PREFER_SKLEARN_MLP=1 to restore sklearn-first):

1. embed_suitability.keras (MobileNet backbone, multi-task) when present and runnable
2. embed_mlp.joblib (handcrafted vectors + sklearn MLP)
3. Pseudo heuristic when no usable model

Usage:
  python backend/analyze_image.py <image_path> <capacity_bytes> <payload_bytes>
"""
from __future__ import annotations

import os

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND))

ROOT = BACKEND.parent
CNN = ROOT / "cnn_model"
MODEL_KERAS = CNN / "embed_suitability.keras"
MODEL_MLP = CNN / "embed_mlp.joblib"

from ml_common import CLASS_NAMES, feature_vector, load_rgb, pseudo_label_from_rgb  # noqa: E402

CAMERAS = [
    ("Canon", "EOS 90D"),
    ("Nikon", "D5600"),
    ("Sony", "ILCE-6400"),
    ("Fujifilm", "X-T30 II"),
    ("Samsung", "SM-G998B"),
]

ML_TASKS_CNN = [
    "multiclass_cover_suitability_softmax_low_medium_high",
    "regression_predicted_embed_psnr_ssim_heads",
    "spatial_texture_saliency_overlay_sobel",
]


def stable_metadata(seed: bytes) -> dict:
    h = hashlib.sha256(seed).digest()
    make, model = CAMERAS[h[0] % len(CAMERAS)]
    lat = 23.0 + (h[1] / 255.0) * 4.0
    lon = 58.0 + (h[2] / 255.0) * 4.0
    dt = datetime.now(timezone.utc).strftime("%Y:%m:%d %H:%M:%S")
    return {
        "make": make,
        "model": model,
        "latitude": f"{lat:.4f}",
        "longitude": f"{lon:.4f}",
        "datetime": dt,
    }


def suitability_to_risk(suit: str, ratio: float) -> str:
    if ratio > 0.92:
        return "critical"
    if ratio > 0.75 or suit == "low":
        return "high"
    if ratio > 0.5 or suit == "medium":
        return "medium"
    return "low"


def _truthy(env: str) -> bool:
    return os.environ.get(env, "").strip().lower() in ("1", "true", "yes", "on")


def probs_vec_to_dict(pred: object) -> dict[str, float]:
    """Map numpy softmax row to {low,medium,high}; keys always present."""
    import numpy as np

    v = np.asarray(pred, dtype=np.float64).ravel()
    n = len(CLASS_NAMES)
    if v.size < n:
        v = np.ones(n, dtype=np.float64) / float(n)
    out: dict[str, float] = {}
    for i, name in enumerate(CLASS_NAMES):
        out[name] = round(float(np.clip(v[i], 1e-9, 1.0)), 6)
    s = sum(out.values())
    if s <= 0:
        return dict.fromkeys(CLASS_NAMES, round(1.0 / len(CLASS_NAMES), 6))
    return {k: round(v / s, 6) for k, v in out.items()}


def heuristic_smooth_probs(idx: int) -> dict[str, float]:
    remainder = (1.0 - 0.62) / 2.0
    dist = dict.fromkeys(CLASS_NAMES, round(remainder, 6))
    dist[CLASS_NAMES[max(0, min(idx, 2))]] = round(0.62, 6)
    s = sum(dist.values())
    return {k: round(v / s, 6) for k, v in dist.items()}


def run_keras(
    img_path: Path,
) -> tuple[str, dict[str, float], float, float] | tuple[None, None, None, None]:
    """Return (backend_label, class_probs, predicted_psnr, predicted_ssim) or four Nones."""
    import numpy as np

    try:
        import tensorflow as tf

        model = tf.keras.models.load_model(str(MODEL_KERAS))
        ish = model.input_shape
        if isinstance(ish, list):
            ish = ish[0]
        if isinstance(ish, (tuple, list)) and len(ish) >= 4:
            size = int(ish[1] or ish[2] or 224)
        else:
            size = 224
        arr = load_rgb(img_path, size)
        batch = np.expand_dims(arr, 0)
        raw = model.predict(batch, verbose=0)
        if isinstance(raw, list) and len(raw) >= 2:
            pred_prob = np.asarray(raw[0][0]).ravel()
            pred_phys = raw[1][0]
            predicted_psnr = float(pred_phys[0])
            predicted_ssim = float(pred_phys[1])
        elif isinstance(raw, list):
            pred_prob = np.asarray(raw[0][0]).ravel()
            predicted_psnr = 46.0
            predicted_ssim = 0.988
        else:
            rp = raw
            pred_prob = np.asarray(rp[0]).ravel()
            predicted_psnr = 46.0
            predicted_ssim = 0.988

        probs = probs_vec_to_dict(pred_prob)
        return "keras_mobilenet", probs, float(predicted_psnr), float(predicted_ssim)
    except Exception:
        return None, None, None, None


def run_sklearn_bundle(img_path: Path) -> tuple[str, dict[str, float], float, float] | tuple[None, None, None, None]:
    import joblib
    import numpy as np

    try:
        bundle = joblib.load(str(MODEL_MLP))
        if isinstance(bundle, dict) and "classifier" in bundle:
            pipe_cls = bundle["classifier"]
            reg = bundle.get("regressor")
        else:
            pipe_cls = bundle
            reg = None

        arr = load_rgb(img_path, 224)
        feat = feature_vector(arr).reshape(1, -1)
        pred = np.asarray(pipe_cls.predict_proba(feat)[0]).ravel()
        probs = probs_vec_to_dict(pred[: len(CLASS_NAMES)])
        if reg is not None:
            yr = reg.predict(feat)[0]
            predicted_psnr = float(yr[0])
            predicted_ssim = float(yr[1])
        else:
            predicted_psnr = 46.0
            predicted_ssim = 0.988

        return "sklearn_mlp", probs, float(predicted_psnr), float(predicted_ssim)
    except Exception:
        return None, None, None, None


def main() -> None:
    if len(sys.argv) < 4:
        print(json.dumps({"ok": False, "error": "usage: analyze_image.py <path> <capacity> <payload>"}))
        sys.exit(1)

    img_path = Path(sys.argv[1])
    try:
        cap = max(1, int(sys.argv[2]))
        pay = int(sys.argv[3])
    except ValueError:
        print(json.dumps({"ok": False, "error": "invalid_numbers"}))
        sys.exit(1)

    if not img_path.is_file():
        print(json.dumps({"ok": False, "error": "image_not_found"}))
        sys.exit(1)

    ratio = min(1.0, pay / float(cap))

    try:
        import numpy as np
    except ImportError as e:
        print(json.dumps({"ok": False, "error": "missing_python_deps", "detail": str(e)}))
        sys.exit(1)

    prefer_sklearn_first = _truthy("DEEPNET_PREFER_SKLEARN_MLP")
    skip_visual = _truthy("DEEPNET_SKIP_TEXTURE_OVERLAY") or _truthy("DEEPNET_SKIP_GRADCAM")

    keras_disk = MODEL_KERAS.is_file()
    mlp_disk = MODEL_MLP.is_file()

    model_label = "pseudo_heuristic"
    class_probs = heuristic_smooth_probs(1)
    predicted_psnr = 46.0
    predicted_ssim = 0.988

    if keras_disk or mlp_disk:
        keras_res = (None,) * 4 if not keras_disk else (*run_keras(img_path),)
        sk_res = (None,) * 4 if not mlp_disk else (*run_sklearn_bundle(img_path),)

        if prefer_sklearn_first:
            order = (sk_res, keras_res)
        else:
            order = (keras_res, sk_res)

        resolved = False
        for attempt in order:
            if attempt[0] is not None:
                model_label = attempt[0]
                class_probs = attempt[1]
                predicted_psnr = float(attempt[2])
                predicted_ssim = float(attempt[3])
                resolved = True
                break

        if not resolved:
            model_label = "pseudo_heuristic"
            arr_h = load_rgb(img_path, 224)
            idx_l = int(pseudo_label_from_rgb(arr_h))
            class_probs = heuristic_smooth_probs(idx_l)
            predicted_psnr = 46.0
            predicted_ssim = 0.988
    else:
        arr_h = load_rgb(img_path, 224)
        idx_l = int(pseudo_label_from_rgb(arr_h))
        class_probs = heuristic_smooth_probs(idx_l)
        predicted_psnr = 46.0
        predicted_ssim = 0.988

    # Argmax suitability + softmax confidence (= top tier mass)
    import numpy as np

    probs_vec = np.array([class_probs[name] for name in CLASS_NAMES], dtype=np.float64)
    idx = int(np.argmax(probs_vec))
    suit_name = CLASS_NAMES[idx] if idx < len(CLASS_NAMES) else "medium"
    conf = float(probs_vec[idx])

    texture_overlay_jpeg_b64 = None

    if model_label == "keras_mobilenet" and keras_disk and not skip_visual:
        try:
            from cnn_visualization import texture_saliency_overlay_jpeg_base64

            arr = load_rgb(img_path, 224)
            texture_overlay_jpeg_b64 = texture_saliency_overlay_jpeg_base64(np.expand_dims(arr, 0))
        except Exception:
            texture_overlay_jpeg_b64 = None

    arr_for_seed = load_rgb(img_path, 224)
    seed_bytes = arr_for_seed.tobytes()[:4096]
    meta = stable_metadata(seed_bytes)
    risk = suitability_to_risk(suit_name, ratio)

    if model_label == "sklearn_mlp":
        sklearn_has_reg = True
        try:
            import joblib

            bb = joblib.load(str(MODEL_MLP))
            if isinstance(bb, dict) and bb.get("regressor") is None:
                sklearn_has_reg = False
        except Exception:
            sklearn_has_reg = False

        backend_display = "Trained MLP (+ physic PSNR / SSIM)" if sklearn_has_reg else "Trained MLP (hand-crafted features)"

    elif model_label == "keras_mobilenet":
        backend_display = "Trained CNN (MobileNet backbone, multi-task)"
    else:
        backend_display = "Heuristic fallback (entropy + edges — no `.keras` / `.joblib`)"

    if model_label == "keras_mobilenet":
        ml_tasks = ML_TASKS_CNN.copy()
        if texture_overlay_jpeg_b64:
            ml_tasks.append("texture_saliency_overlay=true")
        else:
            ml_tasks.append("texture_saliency_overlay_failed")
        notes_ml = (
            "Multi-head CNN advisory: softmax suitability + physic heads for PSNR/SSIM surrogates at training embed density "
            "(Encode still uses deterministic texture-first LSB). "
        )
        if texture_overlay_jpeg_b64:
            notes_ml += (
                "Visualization: luminance Sobel texture saliency fused with RGB (explains dominant edges/entropy; orthogonal to softmax). "
                "Trained Mobilenet softmax + regressors determine scores."
            )
        else:
            notes_ml += "Texture overlay omitted (generation failed); softmax + physic predictions unchanged."

    elif model_label == "sklearn_mlp":
        ml_tasks = [
            "multiclass_cover_suitability_from_handcrafted_statistics",
            "optional_regression_physic_psnr_ssim",
            "spatial_grad_overlay_not_applicable",
        ]
        notes_ml = (
            "Sklearn MLP on engineered texture/entropy statistics "
            "(not convolutional receptive fields); physic heads predict simulated-embed metrics when trained."
        )
    else:
        ml_tasks = ["rule_entropy_edge_proxy_tiers_only"]
        notes_ml = "Heuristic tiers only — train `embed_mlp.joblib` or `embed_suitability.keras` for learned scores."

    base_notes = (
        " Advisory — suitability and surrogate metrics do not steer bit placement "
        "(texture-first order is fixed). "
    )

    physical_summary = (
        f" physic_head_psnr_est={predicted_psnr:.2f}_db ssim_est={predicted_ssim:.4f} "
        f"(comparison vs measured Encode metrics in UI)."
    )

    out: dict[str, object] = {
        "ok": True,
        "image_suitability": suit_name,
        "recovery_risk": risk,
        "recommended_profile": "",
        "confidence": round(min(1.0, max(0.0, conf)), 4),
        "class_probabilities": class_probs,
        "notes": base_notes.strip() + physical_summary + notes_ml,
        "suggested_metadata": meta,
        "model_backend": model_label,
        "backend_display": backend_display,
        "payload_capacity_percent": round(ratio * 100, 2),
        "predicted_psnr_db": round(float(predicted_psnr), 4),
        "predicted_ssim": round(float(predicted_ssim), 6),
        "ml_tasks": ml_tasks,
    }

    if texture_overlay_jpeg_b64:
        out["texture_saliency_overlay_jpeg_base64"] = texture_overlay_jpeg_b64

    if keras_disk and mlp_disk:
        out["inference_priority_note"] = (
            "cnn_first_then_sklearn_fallback"
            if not prefer_sklearn_first
            else "sklearn_first_then_cnn_fallback (DEEPNET_PREFER_SKLEARN_MLP set)"
        )

    print(json.dumps(out))


if __name__ == "__main__":
    main()
