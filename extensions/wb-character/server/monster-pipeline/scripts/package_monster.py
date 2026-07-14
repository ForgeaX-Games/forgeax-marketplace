"""
package_monster.py — Monster Pipeline V2 Packaging Script
Consolidates per-direction output folders into a unified delivery package.

Usage:
    python package_monster.py <monster_name> <source_base> <output_dir>

Example:
    python package_monster.py MutantWolf c:\\path\\to\\workspace c:\\path\\to\\MutantWolf

Expects source folders at:
    <source_base>/mut_wolf_S/
    <source_base>/mut_wolf_SE/
    ... etc (pattern: <source_base>/<prefix>_<DIR>/)
"""

import os, sys, shutil, json
from PIL import Image


DIRS = ["S", "SE", "E", "NE", "N"]
ANIMS = ["idle", "walk", "atk", "hit", "die"]


def find_source_dirs(base, monster_prefix):
    """Auto-detect source directories matching the pattern."""
    found = {}
    for d in DIRS:
        candidates = [
            os.path.join(base, f"{monster_prefix}_{d}"),
            os.path.join(base, f"mut_{monster_prefix.lower()}_{d}"),
        ]
        for c in candidates:
            if os.path.isdir(c):
                found[d] = c
                break
    return found


def package(monster_name, source_base, output_dir, dir_prefix=None):
    print(f"=== Packaging {monster_name} ===\n")

    os.makedirs(output_dir, exist_ok=True)

    if dir_prefix:
        src_dirs = {d: os.path.join(source_base, f"{dir_prefix}_{d}") for d in DIRS}
    else:
        src_dirs = find_source_dirs(source_base, monster_name)

    total = 0
    for dir_key, src in src_dirs.items():
        if not os.path.isdir(src):
            print(f"  [SKIP] {dir_key}: source not found at {src}")
            continue

        dst = os.path.join(output_dir, dir_key)
        os.makedirs(dst, exist_ok=True)
        os.makedirs(os.path.join(dst, "frames"), exist_ok=True)

        for anim in ANIMS:
            for ext in [".png", ".gif"]:
                sf = os.path.join(src, anim + ext)
                if os.path.exists(sf):
                    shutil.copy2(sf, os.path.join(dst, anim + ext))
                    total += 1

            for fi in range(4):
                fname = f"{anim}_F{fi}.png"
                sf = os.path.join(src, "frames", fname)
                if os.path.exists(sf):
                    shutil.copy2(sf, os.path.join(dst, "frames", fname))
                    total += 1

        print(f"  [OK] {dir_key}/: copied from {src}")

    # Generate monster_config.json
    dir_cells = {}
    for d in DIRS:
        idle_path = os.path.join(output_dir, d, "idle.png")
        if os.path.exists(idle_path):
            img = Image.open(idle_path)
            w, h = img.size
            dir_cells[d] = {"cell_w": w // 4, "cell_h": h}

    config = {
        "monster_id": monster_name,
        "pipeline": "TOPDOWN_5DIR_4FRAME",
        "anchor": "com-x_feet-y",
        "directions": {
            "generated": DIRS,
            "flip_x_map": {"SW": "SE", "W": "E", "NW": "NE"},
        },
        "cell_sizes": dir_cells,
        "animations": {
            "idle": {"frames": 4, "fps": 6, "loop": True},
            "walk": {"frames": 4, "fps": 8, "loop": True},
            "atk": {"frames": 4, "fps": 10, "loop": False, "hit_frame": 2},
            "hit": {"frames": 4, "fps": 12, "loop": False, "flash_frame": 1},
            "die": {"frames": 4, "fps": 6, "loop": False},
        },
    }

    config_path = os.path.join(output_dir, "monster_config.json")
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    total += 1
    print(f"\n  monster_config.json written")
    print(f"\n  Total: {total} files packaged to {output_dir}/")
    return total


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python package_monster.py <monster_name> <source_base> <output_dir>")
        sys.exit(1)
    package(sys.argv[1], sys.argv[2], sys.argv[3])
