"""
assemble_direction.py — Template Assembly Script
Monster Pipeline V2 — Direction Sprite Assembly

Usage:
    1. Copy this file as assemble_<monster>_<dir>.py
    2. Fill in the `urls` dictionary with COS URLs from remove_background
    3. Set OUT_DIR to target output folder
    4. Run: python assemble_<monster>_<dir>.py

Produces three output formats per animation:
    - Strip PNG (1x4)
    - Individual frame PNGs (frames/)
    - GIF preview (#282828 background, 8fps)
"""

import io, os, urllib.request, math, numpy as np
import cv2
from PIL import Image

# ══════════════════════════════════════════════════════════════
#  CONFIG — Edit these for each direction
# ══════════════════════════════════════════════════════════════

MONSTER_NAME = "CHANGE_ME"         # e.g. "MutantWolf"
DIRECTION    = "CHANGE_ME"         # e.g. "S", "SE", "E", "NE", "N"

COLS = 4
TARGET_BODY_H = 200
CELL_PAD = 16
GIF_FPS = 8

OUT_DIR = r"CHANGE_ME"            # e.g. r"c:\path\to\mut_wolf_S"

urls = {
    "idle_01":   "PASTE_COS_URL",
    "idle_23":   "PASTE_COS_URL",
    "walk_01":   "PASTE_COS_URL",
    "walk_23":   "PASTE_COS_URL",
    "atk_01":    "PASTE_COS_URL",
    "atk_23":    "PASTE_COS_URL",
    "hit_02":    "PASTE_COS_URL",
    "hit3_die0": "PASTE_COS_URL",
    "die_1":     "PASTE_COS_URL",
    "die_23":    "PASTE_COS_URL",
}


# ══════════════════════════════════════════════════════════════
#  Core Utility Functions (do not modify)
# ══════════════════════════════════════════════════════════════

def load_url(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGBA")


def autocrop(img, pad=2):
    alpha = np.array(img)[:, :, 3]
    rows = np.where(alpha.max(axis=1) > 0)[0]
    cols = np.where(alpha.max(axis=0) > 0)[0]
    if len(rows) == 0 or len(cols) == 0:
        return img
    r0 = max(0, rows[0] - pad)
    r1 = min(img.height, rows[-1] + pad + 1)
    c0 = max(0, cols[0] - pad)
    c1 = min(img.width, cols[-1] + pad + 1)
    return img.crop((c0, r0, c1, r1))


def split_pair(img):
    alpha = np.array(img)[:, :, 3].astype(float)
    w = img.width
    mid = w // 2
    search = range(max(mid - w // 6, 1), min(mid + w // 6, w - 1))
    col_density = alpha.sum(axis=0)
    best_x = min(search, key=lambda x: col_density[x])
    left = autocrop(img.crop((0, 0, best_x, img.height)))
    right = autocrop(img.crop((best_x, 0, w, img.height)))
    return left, right


def clean_edge_artifacts(img, scan_px=6, min_density_ratio=0.10):
    data = np.array(img)
    alpha = data[:, :, 3]
    h, w = alpha.shape
    threshold = h * min_density_ratio
    for x in range(min(scan_px, w)):
        if np.sum(alpha[:, x] > 0) >= threshold:
            break
        data[:, x, 3] = 0
    for x in range(w - 1, max(w - 1 - scan_px, -1), -1):
        if np.sum(alpha[:, x] > 0) >= threshold:
            break
        data[:, x, 3] = 0
    return Image.fromarray(data, "RGBA")


def keep_largest_body(img):
    data = np.array(img)
    alpha = data[:, :, 3]
    binary = (alpha > 0).astype(np.uint8) * 255
    kernel = np.ones((7, 7), np.uint8)
    dilated = cv2.dilate(binary, kernel, iterations=2)
    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(dilated, connectivity=8)
    if n_labels <= 2:
        return img
    areas = stats[1:, cv2.CC_STAT_AREA]
    largest = int(np.argmax(areas)) + 1
    keep_mask = labels == largest
    data[~keep_mask, 3] = 0
    return Image.fromarray(data, "RGBA")


def full_clean(img):
    return autocrop(keep_largest_body(clean_edge_artifacts(img)))


def split_and_clean(img):
    a, b = split_pair(img)
    return full_clean(a), full_clean(b)


def standing_height(img):
    alpha = np.array(img)[..., 3].astype(float)
    h, w = alpha.shape
    cx0, cx1 = w // 4, w * 3 // 4
    row_density = alpha[:, cx0:cx1].sum(axis=1)
    peak = row_density.max()
    if peak == 0:
        return h
    dense = np.where(row_density >= peak * 0.10)[0]
    return int(dense[-1]) - int(dense[0]) + 1 if len(dense) > 0 else h


def find_feet_y(img):
    alpha = np.array(img)[:, :, 3]
    rows = np.where(alpha.max(axis=1) > 0)[0]
    return int(rows[-1]) if len(rows) > 0 else img.height - 1


def center_of_mass_x(img):
    alpha = np.array(img)[:, :, 3].astype(float)
    col_weight = alpha.sum(axis=0)
    total = col_weight.sum()
    if total < 1:
        return img.width / 2.0
    return float(np.dot(col_weight, np.arange(len(col_weight))) / total)


def make_white_flash(img):
    data = np.array(img.copy()).astype(float)
    mask = data[..., 3] > 0
    lum = 0.299 * data[..., 0] + 0.587 * data[..., 1] + 0.114 * data[..., 2]
    out = np.where(lum < 60,
                   80 + (lum / 60.0) * 60,
                   140 + ((lum - 60) / 195.0) * 115)
    for ch in range(3):
        col = data[..., ch].copy()
        col[mask] = out[mask]
        data[..., ch] = col
    return Image.fromarray(data.astype(np.uint8), "RGBA")


def ceil4(x):
    return ((x + 3) // 4) * 4


# ══════════════════════════════════════════════════════════════
#  Main Pipeline
# ══════════════════════════════════════════════════════════════

def main():
    print(f"[{MONSTER_NAME} / {DIRECTION}] Downloading images...")
    raw = {k: load_url(v) for k, v in urls.items()}

    print("Splitting pairs + cleaning...")
    idle_f0, idle_f1 = split_and_clean(raw["idle_01"])
    idle_f2, idle_f3 = split_and_clean(raw["idle_23"])
    walk_f0, walk_f1 = split_and_clean(raw["walk_01"])
    walk_f2, walk_f3 = split_and_clean(raw["walk_23"])
    atk_f0, atk_f1 = split_and_clean(raw["atk_01"])
    atk_f2, atk_f3 = split_and_clean(raw["atk_23"])
    hit_f0, hit_f2 = split_and_clean(raw["hit_02"])
    hit_f3, die_f0 = split_and_clean(raw["hit3_die0"])
    hit_f1 = make_white_flash(hit_f2)
    die_f1 = full_clean(autocrop(raw["die_1"]))
    die_f2, die_f3 = split_and_clean(raw["die_23"])

    rows_data = [
        [idle_f0, idle_f1, idle_f2, idle_f3],
        [walk_f0, walk_f1, walk_f2, walk_f3],
        [atk_f0, atk_f1, atk_f2, atk_f3],
        [hit_f0, hit_f1, hit_f2, hit_f3],
        [die_f0, die_f1, die_f2, die_f3],
    ]
    row_labels = ["idle", "walk", "atk", "hit", "die"]

    print("Computing GLOBAL_SCALE...")
    idle_heights = [standing_height(f) for f in rows_data[0]]
    median_h = float(np.median(idle_heights))
    GLOBAL_SCALE = TARGET_BODY_H / median_h if median_h > 0 else 1.0
    print(f"  idle heights={idle_heights}, median={median_h:.1f}")
    print(f"  TARGET_BODY_H={TARGET_BODY_H}, GLOBAL_SCALE={GLOBAL_SCALE:.4f}")

    print("Scaling all frames...")
    scaled_rows = []
    max_w, max_h = 0, 0
    for frames in rows_data:
        scaled = []
        for f in frames:
            nw = max(1, int(f.width * GLOBAL_SCALE))
            nh = max(1, int(f.height * GLOBAL_SCALE))
            s = f.resize((nw, nh), Image.LANCZOS)
            scaled.append(s)
            max_w = max(max_w, nw)
            max_h = max(max_h, nh)
        scaled_rows.append(scaled)

    CELL_W = ceil4(max_w + 2 * CELL_PAD)
    CELL_H = ceil4(max_h + 2 * CELL_PAD)
    print(f"  Max scaled frame: {max_w}x{max_h}, CELL: {CELL_W}x{CELL_H}")

    def place_frame(img):
        feet_target = CELL_H - CELL_PAD
        fy = find_feet_y(img)
        oy = feet_target - fy
        com_x = center_of_mass_x(img)
        ox = int(CELL_W / 2.0 - com_x)
        ox = max(0, min(ox, CELL_W - img.width))
        oy = max(0, min(oy, CELL_H - img.height))
        canvas = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
        canvas.paste(img, (ox, oy), img)
        return canvas

    os.makedirs(OUT_DIR, exist_ok=True)
    FRAMES_DIR = os.path.join(OUT_DIR, "frames")
    os.makedirs(FRAMES_DIR, exist_ok=True)
    STRIP_W = CELL_W * COLS

    print(f"\nOutput: strips + frames + GIFs -> {OUT_DIR}/")
    for frames, lbl in zip(scaled_rows, row_labels):
        cells = [place_frame(f) for f in frames]

        strip = Image.new("RGBA", (STRIP_W, CELL_H), (0, 0, 0, 0))
        for ci, cell in enumerate(cells):
            strip.paste(cell, (ci * CELL_W, 0), cell)
        strip.save(os.path.join(OUT_DIR, f"{lbl}.png"), "PNG")
        print(f"  {lbl}.png  ({STRIP_W}x{CELL_H})")

        for ci, cell in enumerate(cells):
            cell.save(os.path.join(FRAMES_DIR, f"{lbl}_F{ci}.png"), "PNG")
        print(f"  frames/{lbl}_F0~F3.png  ({CELL_W}x{CELL_H})")

        gif_frames = []
        for cell in cells:
            bg = Image.new("RGBA", cell.size, (40, 40, 40, 255))
            bg.paste(cell, mask=cell.split()[3])
            gif_frames.append(bg.convert("RGB"))
        duration_ms = int(1000 / GIF_FPS)
        gif_frames[0].save(
            os.path.join(OUT_DIR, f"{lbl}.gif"),
            save_all=True, append_images=gif_frames[1:],
            loop=0, duration=duration_ms,
        )
        print(f"  {lbl}.gif  ({GIF_FPS} fps)")

    print(f"\nDone! CELL={CELL_W}x{CELL_H}, GLOBAL_SCALE={GLOBAL_SCALE:.4f}")


if __name__ == "__main__":
    main()
