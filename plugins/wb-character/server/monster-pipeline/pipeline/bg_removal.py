"""
Background-removal module — optional remote API (primary) + local rembg (fallback).

Primary flow (when REMOTE_BG_API_URL is set and COS creds are present):
  1. Upload the local image to object storage
  2. POST $REMOTE_BG_API_URL with body: {"image_cos_url": "<presigned URL>"}
  3. Receive the cut-out PNG bytes
  4. Save to disk

When the remote API is unavailable or unconfigured, automatically falls
back to local rembg (chroma-key green-screen).
"""
import io
import os
import logging
import requests
import numpy as np
import cv2
from PIL import Image

log = logging.getLogger(__name__)

LIGHTAI_API_URL = os.environ.get("REMOTE_BG_API_URL", "")
LIGHTAI_TIMEOUT = 15


def _call_lightai_api(local_path: str) -> bytes:
    """
    调用 LightAI 云端去背景 API。
    返回去背景后的 PNG 字节流，失败则抛异常。
    """
    from pipeline.cos_helper import upload_file

    cos_url = upload_file(local_path, key_prefix="LightAI_input")
    log.info("COS upload done, calling LightAI API...")

    resp = requests.post(
        LIGHTAI_API_URL,
        json={"image_cos_url": cos_url},
        timeout=LIGHTAI_TIMEOUT,
    )
    resp.raise_for_status()

    content_type = resp.headers.get("Content-Type", "")
    if "json" in content_type:
        raise RuntimeError(f"LightAI API returned JSON error: {resp.text[:500]}")

    if len(resp.content) < 1000:
        raise RuntimeError(f"LightAI API returned suspiciously small response ({len(resp.content)} bytes)")

    log.info("LightAI API success, received %d bytes", len(resp.content))
    return resp.content


# ─── 本地降级方案（rembg + 绿幕色键）───

_session = None

def _get_session():
    global _session
    if _session is None:
        from rembg import new_session
        _session = new_session("u2net")
    return _session


def _chroma_key_green(img: Image.Image, tolerance: int = 80) -> Image.Image:
    data = np.array(img.convert("RGB"))
    h, w = data.shape[:2]
    r, g, b = data[:, :, 0].astype(float), data[:, :, 1].astype(float), data[:, :, 2].astype(float)

    green_dominant = (g > 130) & (g > r + tolerance) & (g > b + tolerance)
    near_green = (g > 100) & (g > r + 50) & (g > b + 50)
    near_u8 = near_green.astype(np.uint8) * 255

    flood = np.zeros((h + 2, w + 2), np.uint8)
    for sy, sx in [(0, 0), (0, w-1), (h-1, 0), (h-1, w-1),
                   (0, w//2), (h-1, w//2), (h//2, 0), (h//2, w-1)]:
        if near_u8[sy, sx] > 0:
            cv2.floodFill(near_u8, flood, (sx, sy), 128)

    edge_green = near_u8 == 128
    bg_mask = green_dominant | edge_green

    kernel = np.ones((3, 3), np.uint8)
    bg_mask_u8 = bg_mask.astype(np.uint8) * 255
    bg_mask_u8 = cv2.dilate(bg_mask_u8, kernel, iterations=1)

    alpha = np.full((h, w), 255, dtype=np.uint8)
    alpha[bg_mask_u8 > 0] = 0

    rgba = np.dstack([data, alpha])
    return Image.fromarray(rgba, "RGBA")


def _despill_green(img: Image.Image) -> Image.Image:
    """
    去绿溢出：只修正亮度高、绿通道远超红蓝的绿幕溢出像素，
    不动角色自身的深绿/青绿色特征。
    """
    data = np.array(img).astype(np.float32)
    alpha = data[:, :, 3]
    visible = alpha > 0
    r, g, b = data[:, :, 0], data[:, :, 1], data[:, :, 2]
    brightness = (r + g + b) / 3.0
    spill = visible & (g > 150) & (g > r + 50) & (g > b + 50) & (brightness > 100)
    if np.any(spill):
        avg_rb = (r[spill] + b[spill]) / 2.0
        data[:, :, 1][spill] = avg_rb
    return Image.fromarray(data.astype(np.uint8), "RGBA")


def _clean_fringe(img: Image.Image, fringe_px: int = 2,
                  white_kill: bool = True) -> Image.Image:
    """
    淡化角色轮廓外缘的残留像素（绿溢 / 白雾）。

    `white_kill=False` 时只清绿溢出边缘，不动亮色——保护白羽毛、白毛、
    白色装饰的外缘；绿屏精确色键后走这个模式。
    """
    data = np.array(img).astype(np.float32)
    alpha = data[:, :, 3]
    binary = (alpha > 0).astype(np.uint8) * 255
    kernel = np.ones((fringe_px * 2 + 1, fringe_px * 2 + 1), np.uint8)
    eroded = cv2.erode(binary, kernel, iterations=1)
    edge_mask = (binary - eroded) > 0
    if not np.any(edge_mask):
        return img
    r = data[:, :, 0][edge_mask]
    g = data[:, :, 1][edge_mask]
    b = data[:, :, 2][edge_mask]
    green_spill = (g > 150) & (g > r + 50) & (g > b + 50)
    if white_kill:
        brightness = (r + g + b) / 3.0
        bad = (brightness > 200) | green_spill
    else:
        bad = green_spill
    coords = np.argwhere(edge_mask)
    for y, x in coords[bad]:
        data[y, x, 3] *= 0.15
    return Image.fromarray(data.astype(np.uint8), "RGBA")


def _clean_white_blobs(img: Image.Image) -> Image.Image:
    """
    清除与图像边缘相连的白色/近白色背景块。

    旧版本无差别清理任何"够亮 + 够不饱和"的连通区域，把角色自己身上的
    白色特征（眼睛、喙、羽毛高光、白毛、皮毛反光）全一起扣了。
    现在改成：只处理**贴着图像边界**的白色连通区——那才是真正的背景残留，
    角色身上的白色块再小再浅都保留。

    此函数仅在去背景结果**未贴边**时才应调用（LightAI 云端返回偶尔会有
    白底带出来）。绿屏色键路径已经精确去干净，不需要再走这里。
    """
    data = np.array(img)
    alpha = data[:, :, 3]
    rgb = data[:, :, :3].astype(float)
    brightness = rgb.mean(axis=2)
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    white_mask = ((alpha > 0) & (brightness > 220) & (sat < 25)).astype(np.uint8) * 255
    kernel = np.ones((3, 3), np.uint8)
    white_mask = cv2.morphologyEx(white_mask, cv2.MORPH_CLOSE, kernel, iterations=1)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(white_mask, connectivity=8)
    if n <= 1:
        return img
    h, w = alpha.shape
    for i in range(1, n):
        x0 = stats[i, cv2.CC_STAT_LEFT]
        y0 = stats[i, cv2.CC_STAT_TOP]
        bw = stats[i, cv2.CC_STAT_WIDTH]
        bh = stats[i, cv2.CC_STAT_HEIGHT]
        touches_edge = (x0 == 0) or (y0 == 0) or (x0 + bw >= w) or (y0 + bh >= h)
        if not touches_edge:
            continue  # interior white (character highlights) — keep
        if stats[i, cv2.CC_STAT_AREA] < 15:
            continue
        data[labels == i, 3] = 0
    return Image.fromarray(data, "RGBA")


def _has_green_bg(img: Image.Image) -> bool:
    data = np.array(img.convert("RGB"))
    r, g, b = data[:, :, 0].astype(float), data[:, :, 1].astype(float), data[:, :, 2].astype(float)
    green_pixels = (g > 150) & (g > r + 60) & (g > b + 60)
    return green_pixels.sum() > (data.shape[0] * data.shape[1] * 0.10)


def _local_remove_background(input_path: str, output_path: str) -> str:
    """本地降级方案。

    立绘 prompt 要求输出 #00FF00 绿屏背景，所以 99% 情况走绿幕色键即可。
    色键本身是颜色-exact 判定，不会误伤角色身上的白色/高光，
    因此绿屏路径**不再跑 _clean_white_blobs**（那函数会把角色的白色
    特征——眼睛、喙、白羽毛高光——一并扣掉）。

    只有当输出意外不是绿屏时才走 rembg；rembg 结果可能残留贴边白底，
    此时才需要 _clean_white_blobs，且已收紧为"仅清贴边白块"。
    """
    raw = Image.open(input_path).convert("RGB")

    if _has_green_bg(raw):
        img = _chroma_key_green(raw)
        img = _despill_green(img)
        # 绿屏流程：色键已精确，不做白色清理；仅做极弱的绿溢边缘修。
        img = _clean_fringe(img, fringe_px=1, white_kill=False)
    else:
        img = _rembg_or_passthrough(raw)
        img = _clean_white_blobs(img)
        img = _clean_fringe(img, fringe_px=2, white_kill=True)

    img.save(output_path, "PNG")
    return output_path


def _rembg_or_passthrough(raw: Image.Image) -> Image.Image:
    """Try rembg when available, otherwise return the raw image as RGBA.

    onnxruntime isn't in requirements.txt; when it's missing we must not
    crash the entire hero generation — downstream code will still see
    an RGBA image, just without alpha cutout.
    """
    try:
        from rembg import remove  # type: ignore[import-not-found]
    except Exception as e:
        log.warning("rembg unavailable (%s), skipping ML matting — keeping raw image", e)
        return raw.convert("RGBA")

    buf = io.BytesIO()
    raw.save(buf, "PNG")
    try:
        out_bytes = remove(
            buf.getvalue(),
            session=_get_session(),
            alpha_matting=True,
            alpha_matting_foreground_threshold=240,
            alpha_matting_background_threshold=20,
            post_process_mask=True,
        )
    except Exception:
        out_bytes = remove(buf.getvalue(), session=_get_session(), post_process_mask=True)
    return Image.open(io.BytesIO(out_bytes)).convert("RGBA")


# ─── 主入口 ───

def _post_clean(img: Image.Image) -> Image.Image:
    """LightAI 云端结果的后清理：只清 *贴边* 白块和大片绿残留，
    不杀角色身上的白色高光。"""
    img = _clean_white_blobs(img)
    img = _clean_green_residue(img)
    img = _clean_fringe(img, fringe_px=2, white_kill=False)
    return img


def _clean_green_residue(img: Image.Image) -> Image.Image:
    """
    清除残留的绿幕像素块。
    只针对接近 #00FF00 的高亮度纯绿色，避免误伤角色身上的
    青绿色、暗绿色装饰（水晶、鳞片等）。
    """
    data = np.array(img)
    alpha = data[:, :, 3]
    rgb = data[:, :, :3].astype(float)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]

    hsv = cv2.cvtColor(data[:, :, :3], cv2.COLOR_RGB2HSV).astype(float)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]

    green_screen = (
        (alpha > 0) &
        (g > 150) &
        (g > r + 60) &
        (g > b + 60) &
        (s > 80) &
        (v > 120)
    ).astype(np.uint8) * 255

    kernel = np.ones((3, 3), np.uint8)
    green_screen = cv2.morphologyEx(green_screen, cv2.MORPH_CLOSE, kernel, iterations=2)

    n, labels, stats, _ = cv2.connectedComponentsWithStats(green_screen, connectivity=8)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= 20:
            data[labels == i, 3] = 0

    return Image.fromarray(data, "RGBA")


def remove_background(input_path: str, output_path: str) -> str:
    """
    去背景主入口。
    优先使用 LightAI 云端 API（质量高），
    失败时自动降级到本地 rembg。
    两种方式的结果都会经过白色/绿色残留清理。
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    try:
        png_bytes = _call_lightai_api(input_path)
        img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
        img = _post_clean(img)
        img.save(output_path, "PNG")
        log.info("Background removed via LightAI API -> %s", output_path)
        return output_path
    except Exception as e:
        log.warning("LightAI API failed (%s), falling back to local rembg...", e)
        return _local_remove_background(input_path, output_path)


def remove_background_bytes(input_bytes: bytes) -> bytes:
    """字节流版本。"""
    tmp_in = os.path.join(os.environ.get("TEMP", "/tmp"), "_rmbg_in.png")
    tmp_out = os.path.join(os.environ.get("TEMP", "/tmp"), "_rmbg_out.png")
    with open(tmp_in, "wb") as f:
        f.write(input_bytes)
    remove_background(tmp_in, tmp_out)
    with open(tmp_out, "rb") as f:
        return f.read()
