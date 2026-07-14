"""
verify_delivery.py — Monster Pipeline V2 Delivery Verification
Checks all 5 directions x 5 animations for completeness.

Usage:
    python verify_delivery.py <monster_dir>
    python verify_delivery.py c:\\path\\to\\MutantWolf
"""

import os, sys, json


def verify(base_dir):
    dirs = ["S", "SE", "E", "NE", "N"]
    anims = ["idle", "walk", "atk", "hit", "die"]

    name = os.path.basename(base_dir)
    print(f"=== {name} Delivery Verification ===\n")

    total_ok = 0
    total_fail = 0
    issues = []

    for d in dirs:
        print(f"  {d}/")
        for a in anims:
            strip = os.path.exists(os.path.join(base_dir, d, f"{a}.png"))
            gif = os.path.exists(os.path.join(base_dir, d, f"{a}.gif"))
            frames = all(
                os.path.exists(os.path.join(base_dir, d, "frames", f"{a}_F{i}.png"))
                for i in range(4)
            )
            ok = strip and gif and frames
            if ok:
                total_ok += 1
            else:
                total_fail += 1
                missing = []
                if not strip: missing.append("strip")
                if not gif: missing.append("gif")
                if not frames: missing.append("frames")
                issues.append(f"{d}/{a}: missing {', '.join(missing)}")

            s = "Y" if strip else "N"
            g = "Y" if gif else "N"
            fr = "Y" if frames else "N"
            mark = "[OK]" if ok else "[!!]"
            print(f"    {mark} {a}: strip={s} gif={g} frames={fr}")
        print()

    config_ok = os.path.exists(os.path.join(base_dir, "monster_config.json"))
    preview_ok = os.path.exists(os.path.join(base_dir, "preview.html"))
    print(f"  monster_config.json: {'OK' if config_ok else 'MISSING'}")
    print(f"  preview.html: {'OK' if preview_ok else 'MISSING'}")

    total_files = sum(len(f) for _, _, f in os.walk(base_dir))
    status = "ALL CLEAR" if total_fail == 0 else f"{total_fail} FAILED"
    print(f"\n  Result: {total_ok}/25 animations OK | {total_files} files | {status}")

    if issues:
        print("\n  Issues:")
        for issue in issues:
            print(f"    - {issue}")

    return total_fail == 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python verify_delivery.py <monster_dir>")
        sys.exit(1)
    success = verify(sys.argv[1])
    sys.exit(0 if success else 1)
