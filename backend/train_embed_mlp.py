#!/usr/bin/env python3
"""
Train sklearn MLP classifier (low/medium/high) + MLP regression (PSNR & SSIM at fixed embed density)
using labels from backend/label_stego_quality.py (cnn_model/labels.json).

Output: cnn_model/embed_mlp.joblib — dict with classifier, regressor, metadata.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

import sys

ROOT = Path(__file__).resolve().parent.parent
BACKEND = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND))

DEFAULT_DATASET = ROOT / "dataset" / "covers"
LABELS_JSON = ROOT / "cnn_model" / "labels.json"
OUT_JOB = ROOT / "cnn_model" / "embed_mlp.joblib"
METRICS = ROOT / "cnn_model" / "evaluation_metrics.json"

from ml_common import CLASS_NAMES, collect_images, feature_vector, load_rgb


def _path_key(dataset: Path, p: Path) -> str:
    try:
        return str(p.resolve().relative_to(dataset.resolve())).replace("\\", "/")
    except ValueError:
        return p.name.replace("\\", "/")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    ap.add_argument("--labels", type=Path, default=LABELS_JSON)
    ap.add_argument("--size", type=int, default=224)
    args = ap.parse_args()

    try:
        from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, mean_absolute_error
        from sklearn.model_selection import train_test_split
        from sklearn.neural_network import MLPClassifier, MLPRegressor
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import StandardScaler
        import joblib
    except ImportError as e:
        raise SystemExit(f"Need scikit-learn and joblib: pip install scikit-learn joblib\n{e}") from e

    if not args.labels.is_file():
        raise SystemExit(
            f"Missing {args.labels}. Run first:\n  python backend/label_stego_quality.py --dataset {args.dataset}"
        )

    doc = json.loads(args.labels.read_text(encoding="utf-8"))
    entries = doc.get("entries")
    if not isinstance(entries, list) or not entries:
        raise SystemExit(f"Invalid labels file: {args.labels}")

    label_by_path: dict[str, dict[str, object]] = {}
    for e in entries:
        if isinstance(e, dict) and "path" in e:
            label_by_path[str(e["path"])] = e

    paths = collect_images(args.dataset)
    if len(paths) < 8:
        print(f"Need at least 8 images in {args.dataset}, found {len(paths)}.")
        raise SystemExit(1)

    X_list: list[np.ndarray] = []
    y_list: list[int] = []
    psnr_t: list[float] = []
    ssim_t: list[float] = []

    for p in paths:
        key = _path_key(args.dataset, p)
        row = label_by_path.get(key)
        if row is None:
            continue
        try:
            rgb = load_rgb(p, args.size)
        except OSError:
            continue
        cls_name = str(row.get("class", "medium"))
        if cls_name not in CLASS_NAMES:
            continue
        y_list.append(CLASS_NAMES.index(cls_name))
        X_list.append(feature_vector(rgb))
        psnr_t.append(float(row.get("target_psnr_db", row.get("psnr_db", 0.0))))
        ssim_t.append(float(row.get("target_ssim", row.get("ssim", 0.0))))

    if len(X_list) < 8:
        raise SystemExit(
            "Too few labeled images. Ensure label_stego_quality paths match files under --dataset."
        )

    X = np.stack(X_list, axis=0)
    y = np.array(y_list, dtype=np.int64)
    Yreg = np.column_stack([np.asarray(psnr_t, dtype=np.float64), np.asarray(ssim_t, dtype=np.float64)])

    _, counts = np.unique(y, return_counts=True)
    can_stratify = bool(len(counts) == 3 and np.min(counts) >= 2)

    X_train, X_temp, y_train, y_temp, Yr_train, Yr_temp = train_test_split(
        X,
        y,
        Yreg,
        test_size=0.2,
        random_state=42,
        stratify=y if can_stratify else None,
    )
    _, counts2 = np.unique(y_temp, return_counts=True)
    can2 = bool(len(counts2) == 3 and np.min(counts2) >= 2)
    X_val, X_test, y_val, y_test, Yr_val, Yr_test = train_test_split(
        X_temp,
        y_temp,
        Yr_temp,
        test_size=0.5,
        random_state=43,
        stratify=y_temp if can2 else None,
    )

    mlp = MLPClassifier(
        hidden_layer_sizes=(128, 64),
        max_iter=800,
        random_state=42,
        early_stopping=True,
        validation_fraction=0.15,
        n_iter_no_change=25,
    )
    pipe_cls = Pipeline([("scaler", StandardScaler()), ("mlp", mlp)])
    pipe_cls.fit(X_train, y_train)

    reg = MLPRegressor(
        hidden_layer_sizes=(96, 48),
        max_iter=800,
        random_state=42,
        early_stopping=True,
        validation_fraction=0.15,
        n_iter_no_change=25,
    )
    pipe_reg = Pipeline([("scaler", StandardScaler()), ("mlp", reg)])
    pipe_reg.fit(X_train, Yr_train)

    y_pred_test = pipe_cls.predict(X_test)
    acc_test = float(accuracy_score(y_test, y_pred_test))
    report = classification_report(
        y_test, y_pred_test, target_names=list(CLASS_NAMES), output_dict=True, zero_division=0
    )
    cm = confusion_matrix(y_test, y_pred_test).tolist()

    y_reg_pred = pipe_reg.predict(X_test)
    mae_psnr = float(mean_absolute_error(Yr_test[:, 0], y_reg_pred[:, 0]))
    mae_ssim = float(mean_absolute_error(Yr_test[:, 1], y_reg_pred[:, 1]))

    bundle = {
        "classifier": pipe_cls,
        "regressor": pipe_reg,
        "class_names": list(CLASS_NAMES),
        "label_source": str(args.labels.resolve()),
        "target_density": doc.get("density"),
    }
    OUT_JOB.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, OUT_JOB)

    out_doc = {
        "model": OUT_JOB.name,
        "backend": "sklearn_mlp_multi",
        "classes": list(CLASS_NAMES),
        "train_samples": int(len(X_train)),
        "val_samples": int(len(X_val)),
        "test_samples": int(len(X_test)),
        "test_accuracy": round(acc_test, 4),
        "test_macro_f1": round(float(report.get("macro avg", {}).get("f1-score", 0.0)), 4),
        "confusion_matrix_test": cm,
        "classification_report_test": report,
        "test_mae_psnr_db": round(mae_psnr, 4),
        "test_mae_ssim": round(mae_ssim, 4),
        "label_type": "simulated_lsb_psnr_ssim",
        "label_note": doc.get("label_definition", ""),
        "thresholds": doc.get("thresholds", {}),
    }
    METRICS.write_text(json.dumps(out_doc, indent=2), encoding="utf-8")
    (ROOT / "cnn_model" / "class_names.json").write_text(json.dumps(list(CLASS_NAMES)), encoding="utf-8")

    print(json.dumps(out_doc, indent=2))
    print(f"Saved {OUT_JOB}")


if __name__ == "__main__":
    main()
