"""
精灵图组装模块 — 移植自 assemble_wolf_s2.py。

职责：
  1. 加载去背景图片（本地路径或 URL）
  2. 拆分双帧对 → 单帧
  3. 三步清理：边缘线清除 → 最大连通域 → 自动裁切
  4. 统一缩放（idle 中位高度 → TARGET_BODY_H）
  5. 质心/脚底对齐 → 放入动态单元格
  6. 输出精灵条 PNG + 单帧 PNG + GIF 预览
"""
import io
import os
import math
import urllib.request

import numpy as np
import cv2
from PIL import Image

from .config import (
    COLS, TARGET_BODY_H, CELL_PAD, GIF_FPS, GIF_BG,
    PAIR_KEYS, ANIMS,
)

# ─── 图像加载 ───

def load_url(url: str) -> Image.Image:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGBA")


def load_file(path: str) -> Image.Image:
    return Image.open(path).convert("RGBA")


# ─── 裁切 ───

def autocrop(img: Image.Image, pad: int = 2) -> Image.Image:
    alpha = np.array(img)[:, :, 3]
    rows = np.where(alpha.max(axis=1) > 0)[0]
    cols = np.where(alpha.max(axis=0) > 0)[0]
    if len(rows) == 0 or len(cols) == 0:
        return img
    r0, r1 = max(0, rows[0] - pad), min(img.height, rows[-1] + pad + 1)
    c0, c1 = max(0, cols[0] - pad), min(img.width, cols[-1] + pad + 1)
    return img.crop((c0, r0, c1, r1))


# ─── 双帧分割 ───

def _find_best_split(density: np.ndarray, total_len: int) -> tuple:
    """Find the best split point on one axis. Returns (best_pos, quality_ratio)."""
    mid = total_len // 2
    search = range(max(mid - total_len // 6, 1), min(mid + total_len // 6, total_len - 1))
    if not search:
        return mid, 1.0
    peak = density.max()
    if peak < 1:
        return mid, 0.0
    best = min(search, key=lambda i: density[i])
    return best, float(density[best]) / peak


def _cc_split(img: Image.Image) -> tuple:
    """
    Fallback: use connected-component analysis to separate
    the two largest blobs when neither axis has a clean gap.
    """
    data = np.array(img)
    alpha = data[:, :, 3]
    binary = (alpha > 0).astype(np.uint8) * 255

    kernel = np.ones((5, 5), np.uint8)
    dilated = cv2.dilate(binary, kernel, iterations=3)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(dilated, connectivity=8)
    if n < 3:
        w = img.width
        return (autocrop(img.crop((0, 0, w // 2, img.height))),
                autocrop(img.crop((w // 2, 0, w, img.height))))

    areas = [(stats[i, cv2.CC_STAT_AREA], i) for i in range(1, n)]
    areas.sort(reverse=True)
    id_a, id_b = areas[0][1], areas[1][1]

    cx_a = stats[id_a, cv2.CC_STAT_LEFT] + stats[id_a, cv2.CC_STAT_WIDTH] / 2
    cy_a = stats[id_a, cv2.CC_STAT_TOP] + stats[id_a, cv2.CC_STAT_HEIGHT] / 2
    cx_b = stats[id_b, cv2.CC_STAT_LEFT] + stats[id_b, cv2.CC_STAT_WIDTH] / 2
    cy_b = stats[id_b, cv2.CC_STAT_TOP] + stats[id_b, cv2.CC_STAT_HEIGHT] / 2

    mask_a = (labels == id_a)
    mask_b = (labels == id_b)

    orig_alpha = np.array(img)[:, :, 3]
    data_a = np.array(img)
    data_a[~mask_a & (orig_alpha > 0), 3] = 0
    data_b = np.array(img)
    data_b[~mask_b & (orig_alpha > 0), 3] = 0

    img_a = autocrop(Image.fromarray(data_a, "RGBA"))
    img_b = autocrop(Image.fromarray(data_b, "RGBA"))

    if abs(cx_a - cx_b) >= abs(cy_a - cy_b):
        return (img_a, img_b) if cx_a < cx_b else (img_b, img_a)
    else:
        return (img_a, img_b) if cy_a < cy_b else (img_b, img_a)


def split_pair(img: Image.Image):
    """
    Adaptive pair splitting: tries vertical cut first, then horizontal,
    falls back to connected-component separation.
    """
    alpha = np.array(img)[:, :, 3].astype(float)
    h, w = alpha.shape
    QUALITY_THRESH = 0.08

    col_density = alpha.sum(axis=0)
    best_x, v_ratio = _find_best_split(col_density, w)

    row_density = alpha.sum(axis=1)
    best_y, h_ratio = _find_best_split(row_density, h)

    if v_ratio <= QUALITY_THRESH:
        left = autocrop(img.crop((0, 0, best_x, h)))
        right = autocrop(img.crop((best_x, 0, w, h)))
        return left, right

    if h_ratio <= QUALITY_THRESH:
        top = autocrop(img.crop((0, 0, w, best_y)))
        bottom = autocrop(img.crop((0, best_y, w, h)))
        return top, bottom

    if v_ratio <= h_ratio:
        left = autocrop(img.crop((0, 0, best_x, h)))
        right = autocrop(img.crop((best_x, 0, w, h)))
        return left, right

    if h_ratio < v_ratio:
        top = autocrop(img.crop((0, 0, w, best_y)))
        bottom = autocrop(img.crop((0, best_y, w, h)))
        return top, bottom

    return _cc_split(img)


# ─── 清理函数 ───

def clean_edge_artifacts(img: Image.Image, scan_px: int = 6,
                         min_density_ratio: float = 0.10) -> Image.Image:
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


def keep_largest_body(img: Image.Image, frag_ratio: float = 0.03) -> Image.Image:
    """
    保留最大连通域，清除所有小碎片。

    两阶段策略：
      1. 轻度膨胀找到主体区域，去掉远离主体的大块杂物
      2. 在原始 mask 上再做一次连通域分析，去掉面积 < 主体 frag_ratio 的碎片
    """
    data = np.array(img)
    alpha = data[:, :, 3]
    binary = (alpha > 0).astype(np.uint8) * 255

    kernel = np.ones((7, 7), np.uint8)
    dilated = cv2.dilate(binary, kernel, iterations=2)
    n_d, labels_d, stats_d, _ = cv2.connectedComponentsWithStats(dilated, connectivity=8)
    if n_d > 2:
        areas_d = stats_d[1:, cv2.CC_STAT_AREA]
        largest_d = int(np.argmax(areas_d)) + 1
        data[labels_d != largest_d, 3] = 0

    clean_alpha = data[:, :, 3]
    clean_bin = (clean_alpha > 0).astype(np.uint8) * 255
    n_c, labels_c, stats_c, _ = cv2.connectedComponentsWithStats(clean_bin, connectivity=8)
    if n_c > 2:
        areas_c = stats_c[1:, cv2.CC_STAT_AREA]
        max_area = int(np.max(areas_c))
        min_keep = max(max_area * frag_ratio, 50)
        for i in range(1, n_c):
            if stats_c[i, cv2.CC_STAT_AREA] < min_keep:
                data[labels_c == i, 3] = 0

    return Image.fromarray(data, "RGBA")


def remove_near_white(img: Image.Image, thresh: int = 190) -> Image.Image:
    """
    清除残留的纯白/近白色块 + 高亮纯绿屏幕残留。
    绿色检测收紧到 g>150, g>r+60, g>b+60 以避免误伤角色身上的
    青绿色/暗绿色装饰（水晶、鳞片等）。
    """
    data = np.array(img)
    if data.shape[2] != 4:
        return img
    alpha = data[:, :, 3]
    rgb = data[:, :, :3].astype(float)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    bright = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)

    white_pixels = (alpha > 0) & (bright > thresh) & (sat < 50)
    green_screen = (alpha > 0) & (g > 150) & (g > r + 60) & (g > b + 60) & (sat > 80)
    bad_mask = (white_pixels | green_screen).astype(np.uint8) * 255

    kernel = np.ones((5, 5), np.uint8)
    bad_mask = cv2.morphologyEx(bad_mask, cv2.MORPH_CLOSE, kernel)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(bad_mask, connectivity=8)
    total_fg = np.sum(alpha > 0)
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        if area >= 15 and area < total_fg * 0.3:
            data[labels == i, 3] = 0
    return Image.fromarray(data, "RGBA")


def _is_white_silhouette(img: Image.Image, threshold: float = 0.6) -> bool:
    """检测是否为白色剪影（AI 错误输出：整个角色都是纯白色填充）。"""
    data = np.array(img)
    alpha = data[:, :, 3]
    fg = np.sum(alpha > 0)
    if fg < 100:
        return True
    rgb = data[:, :, :3].astype(float)
    bright = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    white_fg = np.sum((alpha > 0) & (bright > 200) & (sat < 40))
    return (white_fg / fg) > threshold


def full_clean(img: Image.Image) -> Image.Image:
    return autocrop(keep_largest_body(remove_near_white(clean_edge_artifacts(img))))


def split_and_clean(img: Image.Image):
    a, b = split_pair(img)
    ca, cb = full_clean(a), full_clean(b)
    if _is_white_silhouette(ca) and not _is_white_silhouette(cb):
        ca = cb.copy()
    elif _is_white_silhouette(cb) and not _is_white_silhouette(ca):
        cb = ca.copy()
    return ca, cb


# ─── 度量函数 ───

def standing_height(img: Image.Image) -> int:
    alpha = np.array(img)[..., 3].astype(float)
    h, w = alpha.shape
    cx0, cx1 = w // 4, w * 3 // 4
    row_density = alpha[:, cx0:cx1].sum(axis=1)
    peak = row_density.max()
    if peak == 0:
        return h
    dense = np.where(row_density >= peak * 0.10)[0]
    return int(dense[-1]) - int(dense[0]) + 1 if len(dense) > 0 else h


def find_feet_y(img: Image.Image) -> int:
    alpha = np.array(img)[:, :, 3]
    rows = np.where(alpha.max(axis=1) > 0)[0]
    return int(rows[-1]) if len(rows) > 0 else img.height - 1


def center_of_mass_x(img: Image.Image) -> float:
    alpha = np.array(img)[:, :, 3].astype(float)
    col_weight = alpha.sum(axis=0)
    total = col_weight.sum()
    if total < 1:
        return img.width / 2.0
    return float(np.dot(col_weight, np.arange(len(col_weight))) / total)


# ─── 白闪效果 ───

def make_white_flash(img: Image.Image) -> Image.Image:
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


# ─── 辅助 ───

def _ceil4(x: int) -> int:
    return ((x + 3) // 4) * 4


def _content_bbox_size(img: Image.Image) -> tuple:
    """Return (content_width, content_height) of non-transparent pixels."""
    alpha = np.array(img)[:, :, 3]
    rows = np.where(alpha.max(axis=1) > 0)[0]
    cols = np.where(alpha.max(axis=0) > 0)[0]
    if len(rows) == 0 or len(cols) == 0:
        return (img.width, img.height)
    return (int(cols[-1] - cols[0] + 1), int(rows[-1] - rows[0] + 1))


def _normalize_frame_sizes(frames: list, tolerance: float = 0.25) -> list:
    """
    在同一动画的 4 帧之间做大小归一化。
    同时检查 body height 和 content width，如果任一维度偏离
    中位数超过 tolerance，缩放整帧对齐（取两个维度中偏差更大的那个）。
    防止 AI 生成的帧之间大小差异过大导致动画抖动。
    """
    if len(frames) < 2:
        return frames

    heights = [standing_height(f) for f in frames]
    widths = [_content_bbox_size(f)[0] for f in frames]
    median_h = float(np.median(heights))
    median_w = float(np.median(widths))

    if median_h < 10 and median_w < 10:
        return frames

    result = []
    for f, h, w in zip(frames, heights, widths):
        h_ratio = h / median_h if median_h > 10 else 1.0
        w_ratio = w / median_w if median_w > 10 else 1.0

        h_off = abs(h_ratio - 1.0)
        w_off = abs(w_ratio - 1.0)

        if h_off > tolerance or w_off > tolerance:
            if h_off >= w_off and h > 10:
                scale = median_h / h
            elif w > 10:
                scale = median_w / w
            else:
                scale = 1.0
            scale = min(scale, 1.0)
            if abs(scale - 1.0) > 0.05:
                nw = max(1, int(f.width * scale))
                nh = max(1, int(f.height * scale))
                f = f.resize((nw, nh), Image.LANCZOS)
        result.append(f)
    return result


def _uniform_crop(frames: list, pad: int = 4) -> list:
    """
    对同一动画的多帧使用共享包围盒裁切，保持帧间相对位置不变。
    先把所有帧放到相同尺寸的画布上（取最大宽高），
    然后计算所有帧的联合包围盒统一裁切。
    """
    if not frames:
        return frames

    max_w = max(f.width for f in frames)
    max_h = max(f.height for f in frames)

    centered = []
    for f in frames:
        canvas = Image.new("RGBA", (max_w, max_h), (0, 0, 0, 0))
        ox = (max_w - f.width) // 2
        oy = (max_h - f.height) // 2
        canvas.paste(f, (ox, oy), f)
        centered.append(canvas)

    union_r0, union_c0 = max_h, max_w
    union_r1, union_c1 = 0, 0
    for c in centered:
        alpha = np.array(c)[:, :, 3]
        rows = np.where(alpha.max(axis=1) > 0)[0]
        cols = np.where(alpha.max(axis=0) > 0)[0]
        if len(rows) == 0 or len(cols) == 0:
            continue
        union_r0 = min(union_r0, rows[0])
        union_r1 = max(union_r1, rows[-1])
        union_c0 = min(union_c0, cols[0])
        union_c1 = max(union_c1, cols[-1])

    if union_r1 <= union_r0 or union_c1 <= union_c0:
        return frames

    r0 = max(0, union_r0 - pad)
    r1 = min(max_h, union_r1 + pad + 1)
    c0 = max(0, union_c0 - pad)
    c1 = min(max_w, union_c1 + pad + 1)

    return [c.crop((c0, r0, c1, r1)) for c in centered]


# ─── 主组装类 ───

class DirectionAssembler:
    """
    组装一个方向的全部 5 动画 x 4 帧。

    用法:
        asm = DirectionAssembler(output_dir="output/MutantWolf/S")
        asm.load_pair_images({
            "idle_01": "/path/to/nobg/idle_01.png",
            ...
        })
        result = asm.assemble()
        # result = {"cell_w": ..., "cell_h": ..., "scale": ..., "files": [...]}
    """

    def __init__(self, output_dir: str):
        self.output_dir = output_dir
        self.frames_dir = os.path.join(output_dir, "frames")
        os.makedirs(self.frames_dir, exist_ok=True)
        self.pair_images = {}

    def load_pair_images(self, paths: dict):
        """paths: {pair_key: local_file_path}"""
        for key, path in paths.items():
            self.pair_images[key] = load_file(path)

    def load_pair_images_from_urls(self, urls: dict):
        """urls: {pair_key: url_string}"""
        for key, url in urls.items():
            self.pair_images[key] = load_url(url)

    def _split_all_frames(self) -> dict:
        """拆分+清理所有图像对，返回 {anim: [f0,f1,f2,f3]}。"""
        raw = self.pair_images

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

        result = {
            "idle": [idle_f0, idle_f1, idle_f2, idle_f3],
            "walk": [walk_f0, walk_f1, walk_f2, walk_f3],
            "atk":  [atk_f0, atk_f1, atk_f2, atk_f3],
            "hit":  [hit_f0, hit_f1, hit_f2, hit_f3],
            "die":  [die_f0, die_f1, die_f2, die_f3],
        }

        for anim in ANIMS:
            result[anim] = _normalize_frame_sizes(result[anim])
            result[anim] = _uniform_crop(result[anim])

        return result

    def assemble(self, on_progress=None) -> dict:
        """
        执行完整组装流程。
        on_progress(step, detail) 可选回调。
        返回 {"cell_w", "cell_h", "scale", "files": [path, ...]}.
        """
        if on_progress:
            on_progress("split", "拆分帧 + 清理中...")

        anim_frames = self._split_all_frames()

        if on_progress:
            on_progress("scale", "计算全局缩放...")

        idle_heights = [standing_height(f) for f in anim_frames["idle"]]
        median_h = float(np.median(idle_heights))
        global_scale = TARGET_BODY_H / median_h if median_h > 0 else 1.0

        if on_progress:
            on_progress("resize", f"统一缩放 (scale={global_scale:.3f})...")

        scaled_anims = {}
        max_w, max_h = 0, 0
        for anim in ANIMS:
            scaled = []
            for f in anim_frames[anim]:
                nw = max(1, int(f.width * global_scale))
                nh = max(1, int(f.height * global_scale))
                s = f.resize((nw, nh), Image.LANCZOS)
                scaled.append(s)
                max_w, max_h = max(max_w, nw), max(max_h, nh)
            scaled_anims[anim] = scaled

        cell_w = _ceil4(max_w + 2 * CELL_PAD)
        cell_h = _ceil4(max_h + 2 * CELL_PAD)

        def place_frames_stable(frames):
            """
            对同一动画的 4 帧计算共享锚点，消除帧间抖动。
            使用中位数脚底 Y 和中位数质心 X 作为稳定锚点。
            """
            feet_ys = [find_feet_y(f) for f in frames]
            com_xs = [center_of_mass_x(f) for f in frames]
            anchor_fy = float(np.median(feet_ys))
            anchor_cx = float(np.median(com_xs))
            feet_target = cell_h - CELL_PAD

            cells = []
            for f in frames:
                oy = int(feet_target - anchor_fy)
                ox = int(cell_w / 2.0 - anchor_cx)
                ox = max(0, min(ox, cell_w - f.width))
                oy = max(0, min(oy, cell_h - f.height))
                canvas = Image.new("RGBA", (cell_w, cell_h), (0, 0, 0, 0))
                canvas.paste(f, (ox, oy), f)
                cells.append(canvas)
            return cells

        if on_progress:
            on_progress("output", "输出精灵条 + 单帧 + GIF...")

        output_files = []
        strip_w = cell_w * COLS

        for anim in ANIMS:
            frames = scaled_anims[anim]
            cells = place_frames_stable(frames)

            strip = Image.new("RGBA", (strip_w, cell_h), (0, 0, 0, 0))
            for ci, cell in enumerate(cells):
                strip.paste(cell, (ci * cell_w, 0), cell)
            strip_path = os.path.join(self.output_dir, f"{anim}.png")
            strip.save(strip_path, "PNG")
            output_files.append(strip_path)

            for ci, cell in enumerate(cells):
                fp = os.path.join(self.frames_dir, f"{anim}_F{ci}.png")
                cell.save(fp, "PNG")
                output_files.append(fp)

            gif_frames = []
            for cell in cells:
                bg = Image.new("RGBA", cell.size, GIF_BG)
                bg.paste(cell, mask=cell.split()[3])
                gif_frames.append(bg.convert("RGB"))
            gif_path = os.path.join(self.output_dir, f"{anim}.gif")
            gif_frames[0].save(
                gif_path, save_all=True,
                append_images=gif_frames[1:],
                loop=0, duration=int(1000 / GIF_FPS),
            )
            output_files.append(gif_path)

        return {
            "cell_w": cell_w,
            "cell_h": cell_h,
            "scale": global_scale,
            "files": output_files,
        }


def flip_direction(src_dir: str, dst_dir: str) -> list:
    """
    水平翻转一个方向的全部精灵条/帧/GIF，生成镜像方向。
    E → W, SE → SW, NE → NW

    每帧单独 Flip X，然后按原顺序重拼精灵条（不能直接翻转整条，
    否则帧顺序会倒过来）。
    """
    os.makedirs(dst_dir, exist_ok=True)
    frames_src = os.path.join(src_dir, "frames")
    frames_dst = os.path.join(dst_dir, "frames")
    os.makedirs(frames_dst, exist_ok=True)

    from .config import ANIMS, GIF_FPS, GIF_BG
    output_files = []

    for anim in ANIMS:
        strip_path = os.path.join(src_dir, f"{anim}.png")
        if not os.path.isfile(strip_path):
            continue

        strip = Image.open(strip_path).convert("RGBA")
        n_frames = COLS
        cell_w = strip.width // n_frames
        cell_h = strip.height

        flipped_frames = []
        gif_frames = []
        for i in range(n_frames):
            frame_src = os.path.join(frames_src, f"{anim}_F{i}.png")
            if os.path.isfile(frame_src):
                frame = Image.open(frame_src).convert("RGBA")
            else:
                frame = strip.crop((i * cell_w, 0, (i + 1) * cell_w, cell_h))
            flipped = frame.transpose(Image.FLIP_LEFT_RIGHT)

            frame_dst = os.path.join(frames_dst, f"{anim}_F{i}.png")
            flipped.save(frame_dst, "PNG")
            output_files.append(frame_dst)
            flipped_frames.append(flipped)

            bg = Image.new("RGBA", flipped.size, GIF_BG)
            bg.paste(flipped, mask=flipped.split()[3])
            gif_frames.append(bg.convert("RGB"))

        new_strip = Image.new("RGBA", (cell_w * n_frames, cell_h), (0, 0, 0, 0))
        for i, ff in enumerate(flipped_frames):
            new_strip.paste(ff, (i * cell_w, 0), ff)
        dst_strip = os.path.join(dst_dir, f"{anim}.png")
        new_strip.save(dst_strip, "PNG")
        output_files.append(dst_strip)

        if gif_frames:
            gif_path = os.path.join(dst_dir, f"{anim}.gif")
            gif_frames[0].save(
                gif_path, save_all=True,
                append_images=gif_frames[1:],
                loop=0, duration=int(1000 / GIF_FPS),
            )
            output_files.append(gif_path)

    return output_files
