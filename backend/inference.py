#!/usr/bin/env python3
"""Load CNN from cnn_model/ and classify one image; print one JSON line to stdout."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CNN = ROOT / "cnn_model"


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "missing_image_path"}))
        sys.exit(1)

    img_path = Path(sys.argv[1])
    if not img_path.is_file():
        print(json.dumps({"ok": False, "error": "image_not_found"}))
        sys.exit(1)

    model_files = sorted(CNN.glob("*.keras"))
    names_path = CNN / "class_names.json"

    if not model_files or not names_path.is_file():
        print(
            json.dumps(
                {
                    "ok": True,
                    "mode": "stub",
                    "message": (
                        "Run: python backend/train_embed_cnn.py  (creates embed_suitability.keras)."
                    ),
                    "suggested_class": "unknown",
                }
            )
        )
        return

    try:
        import numpy as np
        from PIL import Image

        try:
            import tensorflow as tf

            if hasattr(tf, "keras"):
                _load = tf.keras.models.load_model
            else:
                raise AttributeError("tf.keras")
        except (ImportError, AttributeError):
            import os

            os.environ.setdefault("KERAS_BACKEND", "tensorflow")
            import keras

            _load = keras.models.load_model
    except ImportError as e:
        print(json.dumps({"ok": False, "error": "missing_python_deps", "detail": str(e)}))
        sys.exit(1)

    class_names = json.loads(names_path.read_text(encoding="utf-8"))
    if not isinstance(class_names, list):
        print(json.dumps({"ok": False, "error": "class_names_must_be_json_array"}))
        sys.exit(1)

    model = _load(str(model_files[0]))
    _, h, w, _ = model.input_shape
    if h is None or w is None:
        h, w = 224, 224

    img = Image.open(img_path).convert("RGB").resize((int(w), int(h)))
    arr = np.array(img, dtype=np.float32) / 255.0
    batch = np.expand_dims(arr, 0)
    raw = model.predict(batch, verbose=0)
    if isinstance(raw, list) and len(raw) >= 2:
        preds = raw[0][0]
    elif isinstance(raw, list):
        preds = raw[0][0]
    else:
        preds = raw[0][0]
    idx = int(np.argmax(preds))
    out = {
        "ok": True,
        "class_index": idx,
        "class_name": class_names[idx] if idx < len(class_names) else str(idx),
        "confidence": float(preds[idx]),
    }
    print(json.dumps(out))


if __name__ == "__main__":
    main()
