"""
立绘生成模块 — 生成高精度怪物立绘（hero art）。

立绘是整个管线的起点，后续所有方向的精灵帧都基于同一立绘的设计一致性约束生成。
"""
import os
import logging
from PIL import Image

from .config import OUTPUT_DIR, TEMP_DIR
from .image_gen import generate_image_api
from .bg_removal import remove_background

log = logging.getLogger(__name__)

DEFAULT_HERO_SIZE = 1024

# 摄像视角——只有用户显式指定时才追加到 prompt。"不指定"会让上传参考图/模型自由发挥。
ANGLE_DIRECTIVES = {
    "topdown_45": "VIEW: classic 45° top-down (Hades / Diablo-style three-quarter bird's-eye).",
    "topdown_60": "VIEW: high-angle 60° top-down (RTS / tactical).",
    "topdown_30": "VIEW: low-angle 30° top-down (closer to eye level, shallow perspective).",
    "side": "VIEW: strict side-view (platformer / horizontal action game). Character in profile, orthographic, no perspective distortion.",
}

STYLE_SUFFIXES = {
    "CEL_2D": "crisp cel-shaded 2D illustration, thick dark outlines, high contrast, flat color fills, vibrant",
    "PIXEL": "true pixel art, crisp pixel outlines, limited color palette, no anti-alias",
    "MATCH_REFERENCE": (
        "MATCH THE ATTACHED REFERENCE IMAGE'S ART STYLE EXACTLY — do NOT apply any preset rendering doctrine. "
        "Replicate the reference's line-work (weight / colour / presence), shading (cel vs soft vs painted vs dithered), "
        "palette (colour count and hue range), surface finish (pixel grid / paper grain / digital flat / canvas / airbrush), "
        "and rendering resolution (pixelated vs smooth). If the reference is painted illustration, stay painted; "
        "if it is pixel, stay pixel; if it is anime cel, stay anime cel — do NOT coerce into any other style."
    ),
}


def build_hero_prompt(feature_lock: str, style: str = "",
                      has_reference: bool = False,
                      angle: str = "") -> str:
    """
    组装立绘 prompt。空 style 默认走 MATCH_REFERENCE（如有参考图）或 CEL_2D。
    空 angle 不追加视角指令，完全让模型 / 参考图决定。
    """
    effective_style = style or ""
    if effective_style == "MATCH_REFERENCE" and not has_reference:
        effective_style = "CEL_2D"
    if not effective_style:
        effective_style = "MATCH_REFERENCE" if has_reference else "CEL_2D"

    style_suffix = STYLE_SUFFIXES.get(effective_style, STYLE_SUFFIXES["CEL_2D"])
    angle_line = ANGLE_DIRECTIVES.get(angle, "") if angle else ""

    # ── 参考图强绑定块 ──
    # 之前的 prompt 只说"preserve silhouette, colors, markings"模型仍会自由发挥。
    # 这里改成多段、大写、重复强调的 identity-lock 指令，把参考图当成"必须复刻"
    # 的源，而不是"灵感"。实测 Gemini 3 Pro Image 对多段强约束响应更好。
    reference_block = ""
    if has_reference:
        reference_block = (
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            "*** IDENTITY LOCK: THE ATTACHED IMAGE IS THE CANONICAL CHARACTER. ***\n"
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            "The image above is NOT a mood-board, NOT an inspiration, NOT a loose reference — it IS the character. "
            "Your job is to re-draw that exact character in a clean full-body hero-art composition. "
            "Treat the reference as a locked source of truth for ALL of the following:\n"
            "  1. SILHOUETTE / BODY PLAN — number of limbs, horns, wings, tails, body segments. Do not add, remove, or swap parts.\n"
            "  2. PROPORTIONS — relative head-to-body ratio, limb lengths, bulk.\n"
            "  3. COLOUR PALETTE — replicate hues exactly. No substitutions, no 're-imagining' of colour.\n"
            "  4. SURFACE DETAILS — markings, stripes, cracks, glow spots, armor plates, fur patches, scars.\n"
            "  5. ACCESSORIES — weapons, helmets, chains, jewellery, straps. Draw every single one that is visible.\n"
            "  6. FACIAL / EXPRESSION CUES — if the reference has eyes/mouth visible, preserve their shape, colour, and number.\n"
            "\n"
            "What you ARE allowed to change:\n"
            "  - Add a clean pose that reveals the full body (if the reference is partial / portrait / odd crop).\n"
            "  - Replace the reference's background with a SOLID bright green (#00FF00) green-screen.\n"
            "  - Normalise lighting to be clear and readable for game art.\n"
            "\n"
            "What you are FORBIDDEN from doing:\n"
            "  - Inventing a new character 'inspired by' the reference.\n"
            "  - Rotating to a drastically different view when the user did not ask for one.\n"
            "  - Adding or removing visible limbs, wings, tails, weapons, or armor pieces.\n"
            "  - Changing the species or creature family (e.g. turning a bird into a mammal).\n"
            "  - 'Cleaning up' the design by simplifying or stylising away key markings.\n"
            "\n"
            "If the reference is low-resolution, blurry, or partial — upscale / infer faithfully but conservatively, \n"
            "ALWAYS preferring accuracy over embellishment.\n"
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        )

    # 视角逻辑：
    #   - 有参考图 + 未指定 angle → 沿用参考图视角（不强制 3/4 front）。
    #   - 有参考图 + 指定 angle → 按 angle 重投影，但 identity lock 仍生效。
    #   - 无参考图 → 默认 3/4 front-facing（老行为）。
    if has_reference and not angle:
        view_line = (
            "VIEW: preserve the viewing angle of the attached reference image. "
            "If the reference shows the character from a 3/4 view, keep 3/4; "
            "if side-on, keep side-on; if front, keep front. Do NOT re-project."
        )
    elif angle_line:
        view_line = angle_line
    else:
        view_line = (
            "VIEW: 3/4 front-facing view, slightly angled, dynamic but readable pose. "
            "The character should be standing or in a signature idle stance."
        )

    lines = [
        "=== HIGH-QUALITY CHARACTER HERO ART — FULL BODY ILLUSTRATION ===",
        "",
        "Create a SINGLE, detailed full-body illustration of this character.",
        "This is the DEFINITIVE reference image — all future sprites will match this exactly.",
        "",
        view_line,
        "",
        reference_block + "CHARACTER IDENTITY:",
        f"  {feature_lock}" if feature_lock else "  (identity fully derived from the attached reference image)",
        "",
        "REQUIREMENTS:",
        "  - Full body visible from head to feet/paws/tail tip",
        "  - Show ALL distinguishing features clearly: colors, markings, accessories, glowing parts",
        "  - Character fills ~70-80% of canvas height, well centered",
        "  - High detail level: clear textures, materials, surface qualities",
        "  - Dynamic lighting that highlights key features",
        "",
        f"Art style: {style_suffix}",
        "Background: PURE SOLID BRIGHT GREEN (#00FF00) background — like a green screen. The ENTIRE background must be uniform #00FF00 green with ZERO variation. (Even if the reference has a different background, the OUTPUT must use #00FF00 green.)",
    ]
    return "\n".join(lines)


def generate_hero(monster_name: str, feature_lock: str,
                  api_key: str = "", model: str = "nanobanana-pro",
                  api_base: str = "", style: str = "",
                  reference_image: str = "",
                  angle: str = "",
                  hero_size: int = DEFAULT_HERO_SIZE,
                  upscale: bool = False) -> str:
    """
    生成怪物立绘，返回最终 hero_<size>.png 的路径。
    流程: 生成原图 → 去背景 → 缩放/升采样到目标 size

    参数：
      hero_size: 目标正方形画布边长，支持 512 / 1024 / 2048。
      upscale:   True 时对去背景结果做 LANCZOS 升采样再回贴画布，
                 适合把 Gemini 输出（~1024）放大到 2048 做 2K 出图。
      angle:     摄像视角（topdown_45 / side / ...）。空串不追加，
                 有参考图时优先遵循参考图的视角。
    """
    hero_dir = os.path.join(OUTPUT_DIR, monster_name)
    os.makedirs(hero_dir, exist_ok=True)

    raw_path = os.path.join(TEMP_DIR, monster_name, "hero_raw.png")
    nobg_path = os.path.join(TEMP_DIR, monster_name, "hero_nobg.png")
    final_path = os.path.join(hero_dir, "hero_512.png")  # keep legacy filename for serving

    os.makedirs(os.path.dirname(raw_path), exist_ok=True)

    has_reference = bool(reference_image and os.path.isfile(reference_image))
    prompt = build_hero_prompt(feature_lock, style,
                                has_reference=has_reference, angle=angle)
    log.info(
        "Generating hero art for %s (reference=%s, style=%s, angle=%s, size=%d, upscale=%s)",
        monster_name, "yes" if has_reference else "no",
        style or "auto", angle or "auto", hero_size, upscale,
    )

    generate_image_api(prompt, api_key, raw_path,
                       api_base=api_base, model=model,
                       reference_image=reference_image if has_reference else "")
    log.info("Hero raw image saved: %s", raw_path)

    remove_background(raw_path, nobg_path)
    log.info("Hero background removed: %s", nobg_path)

    img = Image.open(nobg_path).convert("RGBA")

    target = int(hero_size) if hero_size in (512, 1024, 2048) else DEFAULT_HERO_SIZE

    if upscale and max(img.size) < target:
        # 等比升采样到 target，LANCZOS 对 alpha 友好，锐度也比 BICUBIC 好。
        scale = target / max(img.size)
        new_w = int(img.width * scale)
        new_h = int(img.height * scale)
        img = img.resize((new_w, new_h), Image.LANCZOS)
        log.info("Hero upscaled to %dx%d via LANCZOS", new_w, new_h)
    else:
        img.thumbnail((target, target), Image.LANCZOS)

    canvas = Image.new("RGBA", (target, target), (0, 0, 0, 0))
    ox = (target - img.width) // 2
    oy = (target - img.height) // 2
    canvas.paste(img, (ox, oy), img)
    canvas.save(final_path, "PNG")
    log.info("Hero art finalized: %s (%dx%d)", final_path, target, target)

    return final_path
