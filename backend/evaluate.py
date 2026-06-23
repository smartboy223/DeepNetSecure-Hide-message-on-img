#!/usr/bin/env python3
"""Placeholder metrics file for GET /api/metrics if you have not trained yet.

Prefer:
  python backend/label_stego_quality.py
  python backend/train_embed_mlp.py
  python backend/train_embed_cnn.py

They overwrite cnn_model/evaluation_metrics.json with split metrics + MAE regressors where applicable.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "cnn_model" / "evaluation_metrics.json"


def main() -> None:
    doc = {
        "note": "No training run yet. Run backend/train_embed_mlp.py or train_embed_cnn.py to generate real metrics.",
        "accuracy": None,
        "generated_by": "backend/evaluate.py",
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
