# Prompt Templates — Monster Pipeline V2

## Universal Prefix (ALL prompts)

```
strict overhead top-down 60° bird's eye view looking DOWN,
we see the character's BACK from above
```

## Anti-Clipping Suffix (ALL prompts)

```
Positive: small character centered in frame, generous empty space on ALL sides,
          character occupies about 40% of canvas height. White background.
Negative: cropped, cut off, out of frame, tight framing, close up
```

For **single-frame** images (e.g. die_1), add:
```
VERY LARGE margins, zoomed out
```

---

## Direction Keywords

| Direction | Prompt Keywords |
|-----------|----------------|
| **S** | `HEAD at BOTTOM of frame facing toward viewer, TAIL at TOP, four legs spread sideways` |
| **SE** | `head at lower-right of frame, tail at upper-left, left side of body prominent` |
| **E** | `head at RIGHT of frame, tail at LEFT, full side profile seen from above` |
| **NE** | `head at upper-right of frame, tail at lower-left, right side of body prominent` |
| **N** | `head at TOP of frame facing away from viewer, tail at BOTTOM, back of head visible` |

---

## Per-Animation Templates

### Idle (pair: 2 frames per image)

```
Two side-by-side frames of a {monster} standing idle.
{universal_prefix}. {direction_keywords}.

Left frame (F0/F2): {monster} standing relaxed, weight centered, {crystals/features} {glowing/dim}.
Right frame (F1/F3): {monster} slight breathing motion, subtle weight shift.

Character: {featureLock}.
High-contrast 2D pixel art, crisp outlines.
{anti_clipping_suffix}
```

### Walk (pair: 2 frames per image)

```
Two side-by-side frames of a {monster} walking.
{universal_prefix}. {direction_keywords}.

Left frame (F0/F2): {monster} with front-left and rear-right legs forward, mid-stride.
Right frame (F1/F3): {monster} with front-right and rear-left legs forward, alternating stride.

FULL SIZE, same proportions as idle standing pose.
Character: {featureLock}.
{anti_clipping_suffix}
```

### Attack (pair: 2 frames per image)

```
Two side-by-side frames of a {monster} attacking.
{universal_prefix}. {direction_keywords}.

CRITICAL: BOTH frames must face the SAME direction ({direction}).

Left frame (F0 anticipation / F2 follow-through): {attack_pose_description}.
Right frame (F1 strike / F3 recovery): {attack_pose_description}.

Character: {featureLock}.
{anti_clipping_suffix}
```

### Hit (pair: F0 + F2 only, F1 = white flash by code)

```
Two side-by-side frames of a {monster} getting hit.
{universal_prefix}. {direction_keywords}.

Left frame (F0): {monster} flinching from impact, body recoiling.
Right frame (F2): {monster} recovering from hit, body tensed.

CRITICAL: Both frames PURE {direction} view.
Character: {featureLock}.
{anti_clipping_suffix}
```

### Hit3 + Die0 (pair: cross-animation bridge)

```
Two side-by-side frames of a {monster}.
{universal_prefix}. {direction_keywords}.

Left frame (Hit F3): {monster} recovering from hit, returning to stance.
Right frame (Die F0): {monster} staggering, losing balance, beginning to fall.

Character: {featureLock}.
{anti_clipping_suffix}
```

### Die Single Frame (die_1)

```
Single frame of a {monster} dying.
{universal_prefix}. {direction_keywords}.

Die F1: {monster} falling, legs buckling, body tilting, halfway collapse.
Head STILL points toward {direction}.

Character: {featureLock}.
VERY LARGE margins, zoomed out, character at 40% canvas height.
{anti_clipping_suffix}
```

### Die (pair: F2 + F3)

```
Two side-by-side frames of a {monster} dying.
{universal_prefix}. {direction_keywords}.

Left frame (Die F2): {monster} nearly collapsed, lying on side, head still points {direction}.
Right frame (Die F3): {monster} fully dead, flat on ground, head still points {direction}.
Even when dead, do NOT rotate or flip the body orientation.

Character: {featureLock}.
{anti_clipping_suffix}
```

---

## featureLock Examples

### Mutant Wolf
```
dark-furred mutant wolf with glowing purple crystals along spine,
green glowing eyes, lean agile build,
crisp pixel outlines, high-contrast 2D pixel art
```

### Lava Golem
```
dark obsidian rock skin, glowing magma veins,
two large curved horns on head, glowing yellow eyes,
no mouth, small stubby arms, chibi proportions,
high-contrast 2D cel shading
```

### Skeleton Warrior
```
bleached white bones, rusty iron armor on shoulders and chest,
tattered dark red cape, glowing blue ghost fire eyes,
chipped iron sword in right hand, chibi proportions,
crisp pixel outlines, true pixel art
```

### Ice Spider
```
translucent ice-blue crystalline exoskeleton, eight sharp legs with frost tips,
multiple red eyes glowing on cephalothorax, white frost particles emanating,
compact arachnid body, cel shading flat 2D
```

---

## Direction-Specific Prompt Warnings

| Direction | Common AI Error | Fix |
|-----------|----------------|-----|
| **E** | AI generates top-down view instead of side profile | Emphasize: `PURE SIDE PROFILE, head at RIGHT, tail at LEFT` |
| **NE** | F3/F4 drifts to N (straight back) | Add: `head DIAGONAL upper-right, NOT straight up` |
| **N** | Die frames flip to face viewer | Add: `even when dead, head STILL at TOP facing AWAY` |
| **SE** | Attack frames mirror to SW | Add: `BOTH frames head at LOWER-RIGHT, do NOT mirror` |
| **S** | Walk frames shrink | Reference idle_F0 as size guide, add: `FULL SIZE` |
