"""Cover-image features + stego simulation (matches browser texture-priority LSB order)."""
from __future__ import annotations

from pathlib import Path

import numpy as np

CLASS_NAMES = ("low", "medium", "high")

SPATIAL_BLOCK_PX = 16

# --- Stego frame (must match frontend/src/core/stego.ts) ---
STEGO_MAGIC = b"DNS1"
STEGO_FRAME_VERSION = 1
STEGO_HEADER_LOGICAL_BYTES = 9
STEGO_HEADER_TRIPLICATE = 3
STEGO_HEADER_BITS = STEGO_HEADER_LOGICAL_BYTES * STEGO_HEADER_TRIPLICATE * 8


def luminance_msb_u8(rgb_u8: np.ndarray) -> np.ndarray:
    """MSB-stable luminance (same weighting as browser)."""
    r = np.bitwise_and(rgb_u8[..., 0].astype(np.uint16), 0xFE)
    g = np.bitwise_and(rgb_u8[..., 1].astype(np.uint16), 0xFE)
    b = np.bitwise_and(rgb_u8[..., 2].astype(np.uint16), 0xFE)
    return (0.299 * r + 0.587 * g + 0.114 * b).astype(np.float32)


def block_texture_score(
    lum_msb: np.ndarray, x0: int, y0: int, bw: int, bh: int, width: int
) -> float:
    patch = lum_msb[y0 : y0 + bh, x0 : x0 + bw]
    flat = patch.ravel()
    if flat.size == 0:
        return 0.0
    v = float(np.var(flat))
    return v


def build_embed_flat_order(h: int, w: int, rgb_u8: np.ndarray) -> np.ndarray:
    """
    Flat indices into row-major HxWx3 RGB (channel-major per pixel: R,G,B).
    Texture-priority order — must match frontend buildEmbeddableIndexOrder.
    """
    bs = SPATIAL_BLOCK_PX
    nbx = int(np.ceil(w / bs))
    nby = int(np.ceil(h / bs))
    lum = luminance_msb_u8(rgb_u8)

    blocks: list[tuple[float, int, int, np.ndarray]] = []
    for br in range(nby):
        for bc in range(nbx):
            x0 = bc * bs
            y0 = br * bs
            x1 = min(x0 + bs, w)
            y1 = min(y0 + bs, h)
            bw_i = x1 - x0
            bh_i = y1 - y0
            idx_list: list[int] = []
            for yy in range(y0, y1):
                for xx in range(x0, x1):
                    base = (yy * w + xx) * 3
                    idx_list.extend((base, base + 1, base + 2))
            scores = block_texture_score(lum, x0, y0, bw_i, bh_i, w)
            blk = np.array(idx_list, dtype=np.int32)
            blocks.append((scores, br, bc, blk))

    blocks.sort(key=lambda x: (-x[0], x[1], x[2]))
    out_list: list[int] = []
    for _, _, _, blk in blocks:
        out_list.extend(blk.tolist())
    return np.array(out_list, dtype=np.int32)


def simulate_lsb_embed_random(
    rgb_u8: np.ndarray, density: float = 0.5, rng: np.random.Generator | None = None
) -> np.ndarray:
    """
    Flip LSBs along texture-priority scan order — pseudo-random bit values.
    `density`: fraction [0..1] of R/G/B indices to touch.
    """
    if rng is None:
        rng = np.random.default_rng(0)
    h, w, _ = rgb_u8.shape
    order = build_embed_flat_order(h, w, rgb_u8)
    n_touch = int(np.clip(density, 0.0, 1.0) * len(order))
    out = rgb_u8.copy()
    bits = rng.integers(0, 2, size=max(0, n_touch), dtype=np.uint8)
    flat = out.ravel()
    for i in range(min(n_touch, len(order))):
        idx = int(order[i])
        ch = idx % 3
        pix = idx // 3
        y = pix // w
        x = pix % w
        v = out[y, x, ch]
        out[y, x, ch] = (v & 0xFE) | int(bits[i])
    return out


def grayscale_pair_chi_gray(gray_u8: np.ndarray) -> float:
    """Pearson-style pair anomaly on grayscale histogram — detectability-ish proxy."""
    gray_u8 = np.clip(gray_u8.astype(np.int32), 0, 255)
    h = np.bincount(gray_u8.ravel(), minlength=256).astype(np.float64)
    chi = 0.0
    for i in range(0, 256, 2):
        v = h[i] + h[i + 1]
        d = float(h[i]) - float(h[i + 1])
        chi += (d * d) / (v + 1e-9)
    return float(max(0.0, chi))


def load_rgb(path: Path, size: int) -> np.ndarray:
    """
    Load and resize cover images for ML (report: OpenCV-style preprocessing).

    Prefer OpenCV (BGR→RGB, resize) when installed; fall back to Pillow so training
    still works without cv2.
    """
    try:
        import cv2

        raw = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if raw is None:
            raise OSError("cv2.imread failed")
        rgb = cv2.cvtColor(raw, cv2.COLOR_BGR2RGB)
        rgb = cv2.resize(rgb, (size, size), interpolation=cv2.INTER_LINEAR)
        return rgb.astype(np.float32) / 255.0
    except Exception:
        from PIL import Image

        img = Image.open(path).convert("RGB").resize((size, size), Image.Resampling.BILINEAR)
        return np.asarray(img, dtype=np.float32) / 255.0


def load_rgb_uint8(path: Path, size: int) -> np.ndarray:
    """Resize to size×size RGB uint8 (for stego simulation and metrics)."""
    rgb = load_rgb(path, size)
    return np.clip(rgb * 255.0 + 0.5, 0.0, 255.0).astype(np.uint8)


def pseudo_label_from_rgb(rgb: np.ndarray) -> int:
    """
    Fallback rule-based suitability (entropy + edges).
    Prefer labels from cnn_model/labels.json for training paths.
    """
    gray = np.mean(rgb, axis=-1)
    gx = np.abs(np.diff(gray, axis=1))
    gy = np.abs(np.diff(gray, axis=0))
    edge = float(np.mean(gx) + np.mean(gy)) / 2.0
    edge_n = float(np.clip(edge / 0.15, 0.0, 1.0))
    g8 = (gray * 255.0).astype(np.uint8).ravel()
    hist, _ = np.histogram(g8, bins=256, range=(0, 256))
    p = hist.astype(np.float64)
    p = p[p > 0]
    p = p / np.sum(p)
    ent = float(-np.sum(p * np.log2(p + 1e-12)))
    ent_n = float(np.clip(ent / 7.5, 0.0, 1.0))
    score = 0.55 * ent_n + 0.45 * edge_n
    if score < 0.34:
        return 0
    if score < 0.67:
        return 1
    return 2


def _percentile(vals: np.ndarray, p: float) -> float:
    return float(np.percentile(vals, p))


def feature_vector(rgb: np.ndarray) -> np.ndarray:
    """Hand-crafted texture / smoothness / saturation features (no raw histogram mimic of pseudo-rule)."""
    h, w, _ = rgb.shape
    u8 = np.clip(rgb[..., :3] * 255.0, 0.0, 255.0).astype(np.uint8)
    lum = luminance_msb_u8(u8)

    bs = SPATIAL_BLOCK_PX
    vars_list: list[float] = []
    smooth_eps = 20.0
    smooth_blocks = 0
    total_blocks = 0
    nbx = int(np.ceil(w / bs))
    nby = int(np.ceil(h / bs))

    for br in range(nby):
        for bc in range(nbx):
            x0 = bc * bs
            y0 = br * bs
            x1 = min(x0 + bs, w)
            y1 = min(y0 + bs, h)
            patch = lum[y0:y1, x0:x1]
            v = float(np.var(patch.ravel()))
            vars_list.append(v)
            total_blocks += 1
            if v < smooth_eps:
                smooth_blocks += 1

    vl = np.array(vars_list, dtype=np.float64) if vars_list else np.array([0.0])
    gl = float(np.mean(lum))

    gx = np.abs(np.diff(lum.astype(np.float64), axis=1))
    gy = np.abs(np.diff(lum.astype(np.float64), axis=0))
    edge_density = float((np.mean(gx) + np.mean(gy)) * 0.5)

    ld = lum.astype(np.float64)
    lap_var = float(np.var(np.diff(ld, axis=0)) + np.var(np.diff(ld, axis=1)))

    sat = np.mean(
        (u8[..., 0] <= 1)
        | (u8[..., 0] >= 254)
        | (u8[..., 1] <= 1)
        | (u8[..., 1] >= 254)
        | (u8[..., 2] <= 1)
        | (u8[..., 2] >= 254)
    )

    feats: list[float] = [
        gl,
        float(np.std(lum)),
        edge_density,
        lap_var,
        float(np.mean(vl)),
        float(np.std(vl)),
        float(_percentile(vl, 10)),
        float(_percentile(vl, 50)),
        float(_percentile(vl, 90)),
        float(smooth_blocks / max(1, total_blocks)),
        float(np.mean(u8[..., 0])),
        float(np.mean(u8[..., 1])),
        float(np.mean(u8[..., 2])),
        float(sat),
    ]
    return np.array(feats, dtype=np.float32)


def collect_images(folder: Path) -> list[Path]:
    exts = {".png", ".jpg", ".jpeg", ".jfif", ".webp", ".bmp", ".avif"}
    out: list[Path] = []
    for p in folder.rglob("*"):
        if p.suffix.lower() in exts and p.is_file():
            out.append(p)
    return sorted(out)
