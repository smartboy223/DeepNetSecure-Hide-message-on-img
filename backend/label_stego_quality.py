#!/usr/bin/env python3
"""Build cnn_model/labels.json: PSNR/SSIM after simulated LSB embed (texture order) + chi proxy."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
BACKEND = Path(__file__).resolve().parent

import sys

sys.path.insert(0, str(BACKEND))

from ml_common import (  # noqa: E402
    CLASS_NAMES,
    collect_images,
    grayscale_pair_chi_gray,
    load_rgb_uint8,
    simulate_lsb_embed_random,
)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", type=Path, default=ROOT / "dataset" / "covers")
    ap.add_argument("--out", type=Path, default=ROOT / "cnn_model" / "labels.json")
    ap.add_argument("--size", type=int, default=224)
    ap.add_argument("--density", type=float, default=0.5, help="fraction of LSB slots to flip")
    args = ap.parse_args()

    try:
        from skimage.metrics import peak_signal_noise_ratio, structural_similarity
    except ImportError as e:
        raise SystemExit("Install scikit-image: pip install scikit-image\n" + str(e)) from e

    paths = collect_images(args.dataset)
    if len(paths) < 4:
        raise SystemExit(f"Need at least 4 images under {args.dataset}, found {len(paths)}.")

    raw_rows: list[dict[str, object]] = []
    chis: list[float] = []

    for p in paths:
        rgb = load_rgb_uint8(p, args.size)
        h = hashlib.sha256(str(p.resolve()).encode()).digest()
        rng = np.random.default_rng(int.from_bytes(h[:8], "big") % (2**32))
        stego = simulate_lsb_embed_random(rgb, density=args.density, rng=rng)
        psnr = float(peak_signal_noise_ratio(rgb, stego, data_range=255))
        g0 = np.clip(np.mean(rgb, axis=-1), 0, 255).astype(np.uint8)
        g1 = np.clip(np.mean(stego, axis=-1), 0, 255).astype(np.uint8)
        ssim = float(
            structural_similarity(g0, g1, data_range=255)
        )
        chi = grayscale_pair_chi_gray(g1)
        chis.append(chi)
        ds = args.dataset.resolve()
        try:
            rel = str(p.resolve().relative_to(ds)).replace("\\", "/")
        except ValueError:
            rel = p.name.replace("\\", "/")
        raw_rows.append(
            {
                "path": rel,
                "pair_chi": chi,
                "psnr_db": psnr,
                "ssim": ssim,
                "target_psnr_db": psnr,
                "target_ssim": ssim,
            }
        )

    chis_a = np.asarray(chis, dtype=np.float64)
    chi_low_thr = float(np.percentile(chis_a, 55))
    chi_high_thr = float(np.percentile(chis_a, 80))

    entries: list[dict[str, object]] = []
    for row in raw_rows:
        psnr = float(row["psnr_db"])
        ssim = float(row["ssim"])
        chi = float(row["pair_chi"])

        if psnr < 45.0 or ssim < 0.985 or chi >= chi_high_thr:
            lbl = CLASS_NAMES[0]
        elif psnr >= 50.0 and ssim >= 0.995 and chi <= chi_low_thr:
            lbl = CLASS_NAMES[2]
        else:
            lbl = CLASS_NAMES[1]

        entries.append(
            {
                "path": row["path"],
                "class": lbl,
                "psnr_db": psnr,
                "ssim": ssim,
                "pair_chi": chi,
                "target_psnr_db": float(row["target_psnr_db"]),
                "target_ssim": float(row["target_ssim"]),
            }
        )

    doc = {
        "version": 1,
        "density": args.density,
        "resize": args.size,
        "label_definition": (
            "Targets from simulated LSB embedding (texture-first order) at given density; "
            "low/medium/high via PSNR/SSIM/pair-chi thresholds (chi percentiles on this dataset)."
        ),
        "thresholds": {
            "chi_low_max_for_high_quality": chi_low_thr,
            "chi_high_bad": chi_high_thr,
            "psnr_high_ge": 50.0,
            "psnr_low_lt": 45.0,
            "ssim_high_ge": 0.995,
            "ssim_low_lt": 0.985,
        },
        "entries": entries,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "wrote": str(args.out), "n": len(entries)}, indent=2))


if __name__ == "__main__":
    main()
