# Protocols & Hard Rules — Monster Pipeline V2

## Hard Rules (NEVER override)

| # | Rule | Detail |
|---|------|--------|
| 1 | **Direction Independence** | Each generation call handles ONE direction only. Never mix. |
| 2 | **Frame Count Lock** | Every animation = exactly 4 frames. No more, no less. |
| 3 | **Independent Strip Output** | Each animation outputs as 1x4 strip. Never merge into multi-row sheets. |
| 4 | **Camera Lock** | All frames locked to overhead 60 bird's-eye view. No frame may switch to side/portrait view. |
| 5 | **COM-X Alignment** | Horizontal alignment via `center_of_mass_x()` weighted centroid, NOT bounding box center. |
| 6 | **Feet-Y Alignment** | Vertical alignment via `find_feet_y()` to `CELL_H - CELL_PAD`. |
| 7 | **Single GLOBAL_SCALE** | ALL frames use ONE scale factor derived from idle median standing height. No secondary constraints. |
| 8 | **Dynamic Cell Size** | `CELL_W`/`CELL_H` computed from max scaled frame + padding. Never hardcode. |
| 9 | **Three-Step Cleaning** | After pair split: `clean_edge_artifacts` -> `keep_largest_body` (7x7 dilate x2) -> `autocrop`. |
| 10 | **Animation Coherence** | 4 frames must follow anticipation->action->follow-through->recovery. No random poses. |
| 11 | **White Flash Implementation** | Hit F1 = `make_white_flash(recoil_frame)`. Dark pixels -> gray, bright pixels -> white. |
| 12 | **Anti-Clipping** | Character occupies 40% canvas max. 20% margin on all edges. Single frames get extra zoom-out. |
| 13 | **Connected Component Protection** | Dilate 7x7 x2 before connected component analysis to bridge neck/leg gaps. |
| 14 | **Reference Image Lock** | All directions and animations use the same `reference_image_paths`. |
| 15 | **Three Output Formats** | Strip PNG + Individual Frame PNGs + GIF preview. All three required. |
| 16 | **featureLock Immutable** | Once frozen, featureLock string is injected into ALL prompts unchanged. |
| 17 | **No Shadows** | ALL prompts must include `(ABSOLUTELY NO DROP SHADOW:1.5), completely shadowless`. |
| 18 | **Style Lock** | Once `detect_style()` determines CEL_2D or PIXEL, that style is injected into ALL prompts. |
| 19 | **No 3D** | 3D/CGI/PBR is always forbidden. |

---

## Camera Angle Enforcement

All frames must include this prompt prefix:

```
strict overhead top-down 60° bird's eye view looking DOWN,
NOT side view, NOT portrait
```

### Common AI Drift Issues

| Issue | Affected Frames | Countermeasure |
|-------|----------------|----------------|
| Death frames switch to side view | Die F2/F3 | Add: `even when dead, camera stays overhead, we see the body from ABOVE` |
| Attack frames switch to portrait | Atk F1 | Add: `attack seen from above, body stretches toward camera/bottom of frame` |
| Hit frames switch to side recoil | Hit F2 | Add: `recoil viewed from above, body slides away from camera toward TOP of frame` |

---

## Assembly Script Spec

### Core Constants

```python
COLS = 4                  # 4 frames per animation
TARGET_BODY_H = 200       # Idle target body height (px)
CELL_PAD = 16             # Minimum padding per cell edge
GIF_FPS = 8               # Preview GIF frame rate
```

### GLOBAL_SCALE Computation

```python
idle_heights = [standing_height(f) for f in idle_frames]
median_h = np.median(idle_heights)
GLOBAL_SCALE = TARGET_BODY_H / median_h
# WARNING: No secondary width constraint after this!
# WARNING: No "if new_w > CELL_W" clamping!
```

### Dynamic Cell Size

```python
# After scaling ALL 20 frames with GLOBAL_SCALE:
CELL_W = ceil4(max_w + 2 * CELL_PAD)   # Round up to multiple of 4
CELL_H = ceil4(max_h + 2 * CELL_PAD)
```

### Three-Step Cleaning Pipeline

```python
def full_clean(img):
    step1 = clean_edge_artifacts(img)    # Scan 6px from L/R edges, clear thin vertical lines
    step2 = keep_largest_body(step1)     # 7x7 dilate x2 -> connected components -> keep largest
    step3 = autocrop(step2)              # Re-crop transparent borders
    return step3
```

---

## Historical Bugs & Prevention

| Bug | Root Cause | Prevention |
|-----|-----------|-----------|
| Pair split vertical line residue | Split boundary pixel leaked into frame | `full_clean` pipeline: edge scan + connected component + autocrop |
| Connected component deletes head | Thin neck (1-2px) splits head from body | Dilate 7x7 x2 BEFORE connected component analysis |
| Frame size inconsistency | Secondary width constraint `if new_w > CELL_W` | Forbidden. Single GLOBAL_SCALE only. |
| Spine drift between frames | BBox center alignment varies with pose width | Use `center_of_mass_x()` weighted centroid instead |
| Tail/limb clipping | Hardcoded CELL_H (e.g. 280px) too small | Dynamic CELL_W/CELL_H from max frame + padding |
| Death frame angle switch | AI auto-switches to side view for collapse | Prompt: `even when dead, camera stays overhead from ABOVE` |
| Single-frame head clipping | AI fills canvas when generating single frame | Add: `VERY LARGE margins, zoomed out, character occupies only 40%` |
| Dark fur color contamination | Green screen bleeds into dark fur pixels | Use white background for dark-furred quadrupeds, MCP AI remove_background per-frame |
| Adjacent frame fragments | Strip slice captures pixels from neighbor | Post-split: `remove_fragments(min_frac=0.05)` or `keep_largest_body()` |
| Walk only bobs, legs don't move | Root Bob applied to quadruped walk | Quadruped walk MUST use strip generation method, NOT Root Bob |
