#!/usr/bin/env python3
"""
Train MobileNetV2 + head for stego suitability (low/medium/high) and regression of
PSNR + SSIM (measured at fixed simulated embed density). Requires cnn_model/labels.json.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import numpy as np

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

ROOT = Path(__file__).resolve().parent.parent
BACKEND = Path(__file__).resolve().parent
import sys

sys.path.insert(0, str(BACKEND))

DEFAULT_DATASET = ROOT / "dataset" / "covers"
LABELS_JSON = ROOT / "cnn_model" / "labels.json"
OUT_MODEL = ROOT / "cnn_model" / "embed_suitability.keras"
CLASS_NAMES = ["low", "medium", "high"]

from ml_common import collect_images, load_rgb


def _path_key(dataset: Path, p: Path) -> str:
    try:
        return str(p.resolve().relative_to(dataset.resolve())).replace("\\", "/")
    except ValueError:
        return p.name.replace("\\", "/")


def build_dataset(
    paths: list[Path], dataset: Path, labels_path: Path, size: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    doc = json.loads(labels_path.read_text(encoding="utf-8"))
    entries = doc.get("entries")
    if not isinstance(entries, list):
        raise SystemExit("Invalid labels.json")
    by_path = {str(e["path"]): e for e in entries if isinstance(e, dict) and "path" in e}

    xs: list[np.ndarray] = []
    ys: list[int] = []
    yr: list[tuple[float, float]] = []

    for p in paths:
        key = _path_key(dataset, p)
        row = by_path.get(key)
        if row is None:
            continue
        try:
            rgb = load_rgb(p, size)
        except OSError:
            continue
        cname = str(row.get("class", "medium"))
        if cname not in CLASS_NAMES:
            continue
        ys.append(CLASS_NAMES.index(cname))
        xs.append(rgb)
        yr.append(
            (
                float(row.get("target_psnr_db", row.get("psnr_db", 0.0))),
                float(row.get("target_ssim", row.get("ssim", 0.0))),
            )
        )

    if not xs:
        raise SystemExit("No valid labeled images. Check labels.json paths vs --dataset.")
    return (
        np.stack(xs, axis=0),
        np.array(ys, dtype=np.int32),
        np.array(yr, dtype=np.float32),
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    ap.add_argument("--labels", type=Path, default=LABELS_JSON)
    ap.add_argument("--epochs", type=int, default=25)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--size", type=int, default=224)
    ap.add_argument("--val-split", type=float, default=0.15)
    args = ap.parse_args()

    if not args.labels.is_file():
        raise SystemExit(
            f"Missing {args.labels}. Run: python backend/label_stego_quality.py --dataset {args.dataset}"
        )

    try:
        import tensorflow as tf

        if not hasattr(tf, "keras"):
            raise AttributeError("tf.keras missing")
        keras_mod = tf.keras
    except (AttributeError, ImportError):
        import os as _os

        _os.environ.setdefault("KERAS_BACKEND", "tensorflow")
        import keras as keras_mod

    layers = keras_mod.layers
    MobileNetV2 = keras_mod.applications.MobileNetV2
    preprocess_input = keras_mod.applications.mobilenet_v2.preprocess_input

    paths = collect_images(args.dataset)
    if len(paths) < 8:
        print(
            f"Need at least 8 images in {args.dataset}, found {len(paths)}.\n"
            "Add natural photos (JPG/PNG). See dataset/README.md"
        )
        raise SystemExit(1)

    X, y_int, Yreg = build_dataset(paths, args.dataset, args.labels, args.size)
    y_one = keras_mod.utils.to_categorical(y_int, num_classes=3)

    rng = np.random.default_rng(42)
    idx = np.arange(len(X))
    rng.shuffle(idx)
    X, y_one, Yreg = X[idx], y_one[idx], Yreg[idx]

    n = len(X)
    n_val = max(1, int(n * args.val_split))
    X_val, y_val, Yr_val = X[:n_val], y_one[:n_val], Yreg[:n_val]
    X_train, y_train, Yr_train = X[n_val:], y_one[n_val:], Yreg[n_val:]
    if len(X_train) == 0:
        X_train, y_train, Yr_train = X, y_one, Yreg
        X_val, y_val, Yr_val = X[:1], y_one[:1], Yreg[:1]

    base = MobileNetV2(
        include_top=False,
        weights="imagenet",
        input_shape=(args.size, args.size, 3),
    )
    base.trainable = False
    inp = keras_mod.Input(shape=(args.size, args.size, 3))
    x = preprocess_input(inp * 255.0)
    x = base(x, training=False)
    x = layers.GlobalAveragePooling2D()(x)
    x = layers.Dropout(0.25)(x)
    x = layers.Dense(64, activation="relu")(x)
    out_cls = layers.Dense(3, activation="softmax", name="suitability")(x)
    out_phys = layers.Dense(2, activation="linear", name="phys")(x)
    model = keras_mod.Model(inp, outputs=[out_cls, out_phys])
    model.compile(
        optimizer=keras_mod.optimizers.Adam(args.lr),
        loss={"suitability": "categorical_crossentropy", "phys": "mse"},
        loss_weights={"suitability": 1.0, "phys": 0.25},
        metrics={"suitability": ["accuracy"]},
    )

    es = keras_mod.callbacks.EarlyStopping(patience=6, restore_best_weights=True, monitor="val_loss")
    history = model.fit(
        X_train,
        {"suitability": y_train, "phys": Yr_train},
        validation_data=(X_val, {"suitability": y_val, "phys": Yr_val}),
        epochs=args.epochs,
        batch_size=min(args.batch, len(X_train)),
        callbacks=[es],
        verbose=1,
    )

    OUT_MODEL.parent.mkdir(parents=True, exist_ok=True)
    model.save(str(OUT_MODEL))
    names_path = OUT_MODEL.parent / "class_names.json"
    names_path.write_text(json.dumps(CLASS_NAMES), encoding="utf-8")

    val_acc = float(history.history.get("val_suitability_accuracy", [0])[-1] or 0)
    train_acc = float(history.history.get("suitability_accuracy", [0])[-1] or 0)

    from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, mean_absolute_error

    y_val_int = np.argmax(y_val, axis=-1)
    pred = model.predict(X_val, batch_size=min(8, len(X_val)), verbose=0)
    y_pred_proba = pred[0]
    y_pred_int = np.argmax(y_pred_proba, axis=-1)
    sk_acc = float(accuracy_score(y_val_int, y_pred_int))
    report = classification_report(
        y_val_int, y_pred_int, labels=[0, 1, 2], target_names=CLASS_NAMES, output_dict=True, zero_division=0
    )
    cm = confusion_matrix(y_val_int, y_pred_int, labels=[0, 1, 2]).tolist()
    macro_f1 = float(report.get("macro avg", {}).get("f1-score", 0.0))

    phys_pred = pred[1]
    mae_psnr = float(mean_absolute_error(Yr_val[:, 0], phys_pred[:, 0]))
    mae_ssim = float(mean_absolute_error(Yr_val[:, 1], phys_pred[:, 1]))

    lab_doc = json.loads(args.labels.read_text(encoding="utf-8"))

    metrics = {
        "model": OUT_MODEL.name,
        "backend": "keras_cnn_mobilenet_multi",
        "classes": CLASS_NAMES,
        "train_samples": int(len(X_train)),
        "val_samples": int(len(X_val)),
        "epochs_trained": len(history.history.get("loss", [])),
        "final_train_accuracy": round(train_acc, 4),
        "final_val_accuracy": round(val_acc, 4),
        "val_accuracy_sklearn": round(sk_acc, 4),
        "val_macro_f1": round(macro_f1, 4),
        "val_mae_psnr_db": round(mae_psnr, 4),
        "val_mae_ssim": round(mae_ssim, 4),
        "confusion_matrix_val": cm,
        "classification_report_val": report,
        "label_type": "simulated_lsb_psnr_ssim",
        "label_note": lab_doc.get("label_definition", ""),
    }
    (ROOT / "cnn_model" / "evaluation_metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(json.dumps(metrics, indent=2))
    print(f"Saved {OUT_MODEL}")


if __name__ == "__main__":
    main()
