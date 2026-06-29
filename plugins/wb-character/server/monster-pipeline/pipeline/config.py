"""
管线全局配置与常量。
"""
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_DIR = os.path.join(BASE_DIR, "output")
TEMP_DIR = os.path.join(BASE_DIR, "temp")

DIRS = ["S", "SE", "E", "NE", "N"]
ALL_DIRS = ["S", "SE", "E", "NE", "N", "SW", "W", "NW"]
ANIMS = ["idle", "walk", "atk", "hit", "die"]
COLS = 4
FLIP_MAP = {"SW": "SE", "W": "E", "NW": "NE"}

HISTORY_FILE = os.path.join(BASE_DIR, "history.json")

PAIR_KEYS = [
    "idle_01", "idle_23",
    "walk_01", "walk_23",
    "atk_01", "atk_23",
    "hit_02", "hit3_die0",
    "die_1", "die_23",
]

TARGET_BODY_H = 200
CELL_PAD = 16
GIF_FPS = 8
GIF_BG = (40, 40, 40, 255)

ANIM_META = {
    "idle": {"frames": 4, "fps": 6,  "loop": True,  "description": "放松站姿呼吸循环"},
    "walk": {"frames": 4, "fps": 8,  "loop": True,  "description": "四足步态循环"},
    "atk":  {"frames": 4, "fps": 10, "loop": False, "hit_frame": 2, "description": "蓄力→扑咬→落地→收势"},
    "hit":  {"frames": 4, "fps": 12, "loop": False, "flash_frame": 1, "description": "受击→白闪→后仰→恢复"},
    "die":  {"frames": 4, "fps": 6,  "loop": False, "description": "踉跄→倒下→半倒→趴倒死亡"},
}

DIR_KEYWORDS = {
    "S": (
        "FACING SOUTH (180°). "
        "Head points to BOTTOM of image (6 o'clock). Tail points to TOP (12 o'clock). "
        "Viewer sees the character's FACE/FRONT. The character walks DOWNWARD on screen."
    ),
    "SE": (
        "FACING SOUTH-EAST (135°). "
        "Head points to LOWER-RIGHT corner. Tail points to UPPER-LEFT corner. "
        "Body axis runs from upper-left to lower-right at 45° diagonal."
    ),
    "E": (
        "FACING EAST (90°). "
        "Head points to RIGHT edge of image (3 o'clock). Tail points to LEFT edge (9 o'clock). "
        "Perfect side profile. Body is horizontal, head=right, tail=left."
    ),
    "NE": (
        "FACING NORTH-EAST (45°). "
        "Head points to UPPER-RIGHT corner. Tail points to LOWER-LEFT corner. "
        "Body axis runs from lower-left to upper-right at 45° diagonal."
    ),
    "N": (
        "FACING NORTH (0°). "
        "Head points to TOP of image (12 o'clock). Tail points to BOTTOM (6 o'clock). "
        "Viewer sees the character's BACK. The character walks UPWARD on screen."
    ),
}

PAIR_DESC = {
    "idle_01": (
        "Idle F0 + F1 (Breathing In → Breathing Mid)",
        "LEFT POSE (F0 – Anticipation): chest slightly deflated, body relaxed, weight centered, "
        "mouth closed. "
        "RIGHT POSE (F1 – In-between): chest begins to expand, ribcage rises ~5%, subtle shoulder lift. "
        "TRANSITION RULE: The ONLY difference between F0 and F1 is a tiny chest expansion. "
        "Limbs, head angle, tail position stay IDENTICAL."
    ),
    "idle_23": (
        "Idle F2 + F3 (Breathing Peak → Exhale Return)",
        "LEFT POSE (F2 – Action Peak): chest fully expanded, shoulders at highest point, "
        "body at maximum inhale. "
        "RIGHT POSE (F3 – Follow-through): chest deflating back toward F0, shoulders dropping. "
        "TRANSITION RULE: F3 must look like a smooth return toward F0. "
        "The 4-frame loop is F0→F1→F2→F3→F0. Each step is a TINY increment."
    ),
    "walk_01": (
        "Walk F0 + F1 (Left Leg Forward → Passing Position)",
        "LEFT POSE (F0 – Contact): left front leg extended forward touching ground, "
        "right rear leg extended back, body tilted slightly forward, weight on front legs. "
        "RIGHT POSE (F1 – Passing/In-between): legs crossing mid-stride, left leg pulling back, "
        "right leg swinging forward, body upright at neutral height. "
        "TRANSITION RULE: F1 is the EXACT halfway point between F0 and F2. "
        "Leg positions must be midway. NO teleporting limbs."
    ),
    "walk_23": (
        "Walk F2 + F3 (Right Leg Forward → Passing Back)",
        "LEFT POSE (F2 – Mirror Contact): right front leg extended forward touching ground, "
        "left rear leg extended back — this is the MIRROR of F0 with opposite legs. "
        "RIGHT POSE (F3 – Passing/In-between): legs crossing mid-stride returning toward F0, "
        "right leg pulling back, left leg swinging forward. "
        "TRANSITION RULE: F3 is the EXACT halfway point between F2 and F0. "
        "The 4-frame walk cycle must be perfectly loopable: F0→F1→F2→F3→F0."
    ),
    "atk_01": (
        "Attack F0 + F1 (Wind-up → Strike Mid-swing)",
        "LEFT POSE (F0 – Anticipation): body coiled back, muscles tensed, head lowered, "
        "weapon/claws pulled back in preparation, weight shifting to rear legs. "
        "RIGHT POSE (F1 – In-between/Action): body lunging forward at HALF extension, "
        "weapon/claws at mid-arc with slight motion blur, weight shifting to front legs. "
        "TRANSITION RULE: F1 is the MID-POINT of the strike motion. "
        "Body position must be exactly between F0's coil and F2's full extension."
    ),
    "atk_23": (
        "Attack F2 + F3 (Full Strike Impact → Recovery)",
        "LEFT POSE (F2 – Action Peak/Impact): body at FULL forward extension, weapon/claws "
        "at maximum reach, slight impact effect, weight fully on front. "
        "RIGHT POSE (F3 – Follow-through/Recovery): body pulling back toward neutral, "
        "weapon/claws retracting, settling back to relaxed stance. "
        "TRANSITION RULE: F3 must be halfway between F2's peak and the idle pose. "
        "No instant teleporting back to rest — show the deceleration."
    ),
    "hit_02": (
        "Hit F0 + F2 (Impact Flinch → Maximum Recoil)",
        "LEFT POSE (F0 – Initial Impact): body just hit, slight flinch, head jerking back ~15°, "
        "eyes squinting, front legs bracing. The hit JUST happened. "
        "RIGHT POSE (F2 – Maximum Recoil): body leaning back at peak recoil ~30°, "
        "head thrown back, legs scrambling for balance. "
        "NOTE: F1 will be a programmatic white flash — F0 and F2 must feel like a "
        "continuous flinch with F2 being MORE exaggerated than F0."
    ),
    "hit3_die0": (
        "Hit F3 (Recovery) + Die F0 (Death Stagger Start)",
        "LEFT POSE (Hit F3 – Recovery): body straightening back up from recoil, "
        "returning toward neutral stance, still slightly off-balance but recovering. "
        "RIGHT POSE (Die F0 – Stagger Start): body beginning to lose balance, knees buckling, "
        "head drooping slightly, the very FIRST sign of collapse. "
        "TRANSITION RULE: Die F0 must look like the START of falling — NOT already fallen."
    ),
    "die_1": (
        "Die F1 (Mid-Collapse — Single Frame)",
        "ONE pose: body at MID-COLLAPSE, legs buckling at ~45° angle, body tilting toward ground, "
        "head drooping, clearly in the PROCESS of falling but NOT yet on the ground. "
        "This is the IN-BETWEEN frame: halfway between standing (Die F0) and lying down (Die F2)."
    ),
    "die_23": (
        "Die F2 + F3 (Near-Ground → Fully Dead)",
        "LEFT POSE (F2 – Almost Down): body nearly on the ground at ~20° angle, "
        "legs folded under, head resting low, final moments before full collapse. "
        "RIGHT POSE (F3 – Fully Dead): body completely flat on the ground, "
        "legs splayed out, fully still, eyes closed. Definitively dead. "
        "TRANSITION RULE: F2 is almost-but-not-quite on the ground. F3 is the final resting state."
    ),
}
