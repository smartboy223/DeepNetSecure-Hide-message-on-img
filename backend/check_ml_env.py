#!/usr/bin/env python3
"""Quick check: TensorFlow + Keras vs sklearn fallback. Run: python backend/check_ml_env.py"""
from __future__ import annotations

import sys


def main() -> None:
    print("Python:", sys.version.split()[0])

    try:
        import tensorflow as tf

        print("TensorFlow:", getattr(tf, "__version__", "?"), "| tf.keras:", hasattr(tf, "keras"))
    except Exception as e:
        print("TensorFlow:", "NOT OK", e)

    try:
        import keras

        print("Keras package:", keras.__version__)
    except Exception as e:
        print("Keras package:", "NOT OK", e)

    try:
        import sklearn

        print("scikit-learn:", sklearn.__version__)
    except Exception as e:
        print("scikit-learn:", e)

    from pathlib import Path

    root = Path(__file__).resolve().parent.parent
    cnn = root / "cnn_model"
    keras_m = cnn / "embed_suitability.keras"
    mlp = cnn / "embed_mlp.joblib"
    print("Models:", "keras" if keras_m.is_file() else "-", "| mlp" if mlp.is_file() else "-")


if __name__ == "__main__":
    main()
