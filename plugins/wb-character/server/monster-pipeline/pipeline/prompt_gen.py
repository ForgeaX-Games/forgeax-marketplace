"""
自动生成全部提示词（5方向 x 10图像对 = 50条）。

核心策略：
  1. 方向（Direction）是第一优先级，在 prompt 开头 + 中间 + 结尾重复三次
  2. 立绘参考图作为角色设计的唯一真相源
  3. 双帧对中两帧的方向必须完全相同
"""
from .config import DIRS, PAIR_KEYS, DIR_KEYWORDS, PAIR_DESC


def build_prompt(feature_lock: str, direction: str, pair_key: str,
                 camera_angle: int = 60, style: str = "CEL_2D") -> str:
    dir_kw = DIR_KEYWORDS[direction]
    pair_label, pair_desc = PAIR_DESC[pair_key]
    is_single = pair_key == "die_1"

    # Per-frame style suffix. MATCH_REFERENCE points the model at the hero image
    # that is already supplied as the multimodal reference_image — it should preserve
    # the hero's visual language rather than imposing cel or pixel.
    if style == "CEL_2D":
        style_suffix = "crisp cel-shaded 2D, thick dark outlines, high contrast, flat color fills"
    elif style == "PIXEL":
        style_suffix = "true pixel art, crisp pixel outlines, limited color palette, no anti-alias"
    elif style == "MATCH_REFERENCE":
        style_suffix = (
            "match the attached hero reference image's art style EXACTLY — preserve its line weight, "
            "shading language, palette, surface finish and rendering resolution. Do NOT impose cel-shaded or "
            "pixel art unless the reference is already that."
        )
    else:
        style_suffix = "crisp cel-shaded 2D, thick dark outlines, high contrast, flat color fills"

    if is_single:
        count_desc = "ONE single character pose centered on the canvas."
        frame_dir_rule = f"The character MUST face {direction}. {dir_kw}"
    else:
        count_desc = (
            "Exactly TWO poses of the SAME character side by side, separated by a clear gap. "
            "Both poses must show the IDENTICAL character with IDENTICAL colors, proportions, and SIZE."
        )
        frame_dir_rule = (
            f"BOTH the left pose AND the right pose MUST face EXACTLY {direction}. "
            f"{dir_kw} "
            f"Neither pose may face any other direction. If a pose looks like it faces a different way, it is WRONG."
        )

    anim_continuity = []
    if not is_single:
        anim_continuity = [
            "",
            "########## ANIMATION CONTINUITY — CRITICAL ##########",
            "These two poses are ADJACENT FRAMES in a sprite animation.",
            "They MUST follow the 'Traditional Animation Three-Step Rule':",
            "  Anticipation → In-between/Action → Follow-through",
            "",
            "MANDATORY PHYSICS RULES for the two poses:",
            "  1. The physical displacement between LEFT and RIGHT pose must be SMALL and GRADUAL.",
            "     NO teleporting limbs. NO sudden jumps in position.",
            "  2. If the left pose has a leg at position A, the right pose's leg must be at",
            "     a position SLIGHTLY past A — NOT at a completely different place.",
            "  3. Body center-of-mass must shift by no more than ~10-15% of body height between frames.",
            "  4. Head angle change between frames: maximum 15 degrees.",
            "  5. Think of these as two frames from a VIDEO — pause a video and step forward one frame.",
            "     That is how SMALL the change should be.",
            "",
            "FORBIDDEN (will cause choppy animation):",
            "  ✗ Two completely different random poses",
            "  ✗ Large jumps in limb positions between left and right",
            "  ✗ Different body tilt/lean angles that jump more than 15°",
            "  ✗ One pose in motion and the other completely static",
            "##########################################################",
        ]

    lines = [
        f"########## DIRECTION LOCK: {direction} — DO NOT DEVIATE ##########",
        f"The character MUST face {direction} in EVERY pose in this image.",
        f"{dir_kw}",
        f"This is NON-NEGOTIABLE. Any frame facing a different direction = FAILURE.",
        "",
        "=== CHARACTER SPRITE SHEET — ANIMATION FRAME PAIR ===",
        "",
        "A reference image of this character is provided. Reproduce the EXACT SAME character.",
        "Copy colors, body proportions, markings, and silhouette from the reference precisely.",
        "The ONLY changes: camera angle, facing direction, and pose.",
        "",
        f"Camera: overhead top-down {camera_angle}° bird's eye view looking DOWN.",
        "",
        f"########## DIRECTION (REPEAT): {direction} ##########",
        f"{dir_kw}",
        "",
        f"Pose: {pair_label}",
        f"FRAME-BY-FRAME DESCRIPTION: {pair_desc}",
        "",
        count_desc,
        "",
        f"DIRECTION RULE FOR ALL FRAMES: {frame_dir_rule}",
        *anim_continuity,
        "",
        "CHARACTER IDENTITY (copy from reference — NO deviation):",
        f"  {feature_lock}",
        "",
        "CONSISTENCY RULES:",
        "  - SAME body shape, proportions, silhouette as reference image",
        "  - SAME color palette — copy every color from reference",
        "  - SAME markings, patterns, scars, accessories",
        "  - SAME head-to-body ratio, limb thickness, tail length",
        "  - SAME art style and detail level",
        "  - SAME SIZE for both poses (if two poses) — neither should be bigger or smaller",
        "  - Between the two poses: SAME character proportions, SAME scale, only TINY pose changes",
        "",
        f"Art style: {style_suffix}",
        "Composition: small character centered, ~35-40% of canvas height, generous empty space.",
        "Background: PURE SOLID BRIGHT GREEN (#00FF00) — uniform green screen, ZERO variation.",
        "",
        f"########## FINAL CHECK: Is EVERY pose facing {direction}? Head position: {dir_kw.split('.')[0]}. ##########",
        "########## ANIMATION CHECK: Are the two poses SEQUENTIAL with TINY incremental changes? ##########",
    ]
    return "\n".join(lines)


def generate_all_prompts(feature_lock: str, camera_angle: int = 60,
                         style: str = "CEL_2D") -> dict:
    """返回 {direction: {pair_key: prompt_string}}。"""
    result = {}
    for d in DIRS:
        result[d] = {}
        for pk in PAIR_KEYS:
            result[d][pk] = build_prompt(feature_lock, d, pk, camera_angle, style)
    return result
