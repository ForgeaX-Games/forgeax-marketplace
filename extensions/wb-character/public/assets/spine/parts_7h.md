# 七头身角色拆件提示词模板

## 概述

以**七头身拆件模板** (`template_parts_7h.png`) 和**角色参考图** 作为两张参考图，通过 `image_to_image` 生成角色拆件图。

### 输入

1. **布局模板**: `references/template_parts_7h.png` (768×1376)
2. **角色参考**: 角色侧视图或三视图原图
3. **严格逐框提示词**: 按下方模板组装

### 输出（强制规格）

- **尺寸**：**768×1376 像素**，**9:16 竖向**，与模板完全一致
- **布局**：必须与 `template_parts_7h.png` **完全一致**——**恰好 17 个**独立绿框的位置、大小、排列不得改变，仅替换框内人偶为角色部件
- **不得**改变画幅比例或布局结构，否则裁切与骨骼绑定时会错位
- **⚠️ 严禁多出绿框**：输出必须恰好 17 个绿框，不多不少。角色参考仅用于获取角色外观（配色、发型、服装），**不要**为不同视角分别生成部件。每个身体部件只出现一次（45° 侧面视角）

---

## 模板布局（17 个独立绿框）

```
768 × 1376 模板图，白色底 + 绿色(#00FF00)独立框
竖向人体解剖布局 — 从头到脚依次排列

              ┌──────────────────┐
              │   ① head         │
              │   353×243        │
              │   顶部居中       │
              └──────────────────┘
┌───────────┐ ┌──────────────────┐ ┌───────────┐
│ ⑤上臂R    │ │   ② upper_torso  │ │ ④上臂L    │
│ 141×142   │ │   353×141        │ │ 142×142   │
└───────────┘ └──────────────────┘ └───────────┘
┌───────────┐ ┌──────────────────┐ ┌───────────┐
│ ⑧前臂R    │ │   ③ lower_torso  │ │ ⑦前臂L    │
│ 141×142   │ │   352×121        │ │ 142×142   │
└───────────┘ └──────────────────┘ └───────────┘
┌───────────┐ ┌──────────────────┐ ┌───────────┐
│ ⑫手R      │ │   ⑥ hips         │ │ ⑨手L      │
│ 145×143   │ │   353×133        │ │ 145×141   │
└───────────┘ └──────────────────┘ └───────────┘
              ┌──────┐  ┌──────┐
              │⑩腿R  │  │⑪腿L  │
              │142×142│  │141×142│
              └──────┘  └──────┘
              ┌──────┐  ┌──────┐
              │⑭小腿R│  │⑬小腿L│
              │142×143│  │141×143│
              └──────┘  └──────┘
              ┌──────┐  ┌──────┐
              │⑯脚R  │  │⑮脚L  │
              │141×142│  │141×143│
              └──────┘  └──────┘
┌────────────────────────────────────────────────┐
│         ⑰ weapon 武器横条  768×219             │
└────────────────────────────────────────────────┘
```

### 布局特征

- **头部**：1 个大框居中顶部（只有一个表情，战斗/认真脸）
- **躯干拆为 3 段**：上胸（含颈+肩线）、下腰（胸下到腰）、臀裤（腰到髋），水平居中排列
- **手臂**：左右对称分列躯干两侧，每侧 3 段垂直排列（上臂 → 前臂 → 手）
- **腿部**：双列垂直排列在中央下方（大腿 → 小腿 → 脚）
- **每个框完全独立**，框之间有白色间隙

### 17 个绿框精确坐标

| # | 名称 | 位置描述 | 坐标 (x1,y1)-(x2,y2) | 尺寸 |
|---|------|---------|----------------------|------|
| 1 | head | 顶部居中 | (199,0)-(551,242) | 353×243 |
| 2 | upper_torso | 躯干第一行居中 | (199,261)-(551,401) | 353×141 |
| 3 | lower_torso | 躯干第二行居中 | (200,411)-(551,531) | 352×121 |
| 4 | upperarm_l | 上胸右侧 | (573,266)-(714,407) | 142×142 |
| 5 | upperarm_r | 上胸左侧 | (39,261)-(179,402) | 141×142 |
| 6 | hips | 躯干第三行居中 | (199,541)-(551,673) | 353×133 |
| 7 | lowerarm_l | 前臂右侧 | (573,416)-(714,557) | 142×142 |
| 8 | lowerarm_r | 前臂左侧 | (38,416)-(178,557) | 141×142 |
| 9 | hand_l | 手右侧 | (572,568)-(716,708) | 145×141 |
| 10 | thigh_r | 臀下方左列顶 | (219,687)-(360,828) | 142×142 |
| 11 | thigh_l | 臀下方右列顶 | (401,688)-(541,829) | 141×142 |
| 12 | hand_r | 手左侧 | (37,571)-(181,713) | 145×143 |
| 13 | calf_l | 左大腿下方 | (401,841)-(541,983) | 141×143 |
| 14 | calf_r | 右大腿下方 | (219,841)-(360,983) | 142×143 |
| 15 | foot_l | 左小腿下方 | (401,998)-(541,1140) | 141×143 |
| 16 | foot_r | 右小腿下方 | (220,998)-(360,1139) | 141×142 |
| 17 | weapon | 底部全宽横条 | (0,1157)-(767,1375) | 768×219 |

> **框17 武器中心点（强制）**：绿框 768×219 的几何中心在**框内**为水平 384px、垂直 110px。**剑柄/握柄必须画在此点**，整剑以此为中心向左右延伸、尖端朝右。

---

## 与二头身模板的关键差异

| 差异项 | 二头身模板 | 七头身模板 |
|--------|-----------|-----------|
| 画幅 | 1024×1024 (1:1) | 768×1376 (9:16 竖向) |
| 头身比 | 1:1（头占 50%） | 1:7（头占约 14%） |
| 头部框数 | 3 个（笑/战斗/死亡） | 1 个（仅战斗/认真） |
| 躯干拆分 | 1 段（颈到髋） | 3 段（上胸/下腰/臀裤） |
| 手臂布局 | 阶梯排列（偏移约 30px） | 左右对称分列躯干两侧，垂直排列 |
| 腿部框尺寸 | 不等大（大腿大于小腿大于脚） | 近似等大（约 141×142） |
| 总框数 | 17（3头+1躯干+6臂+6腿+1武器） | 17（1头+3躯干+6臂+6腿+1武器） |

---

## 核心原则

> **⚠️ 输出必须为 768×1376、9:16 竖向，与参考图同一布局。** 模板中的灰色人偶仅为姿势、大小、位置的参考指南。必须：
> 1. 将所有灰色皮肤替换为角色实际肤色
> 2. 将头部框的光头替换为角色完整发型+配饰
> 3. 将所有灰色身体部件替换为角色穿着衣服的、有颜色的身体部件
> 4. 参照人偶的姿势和位置，但部件按自然比例绘制——**不要拉伸填满整个框，框内允许留白**

## ⚠️ 画风隔离规则（关键）

模板图**仅提供布局**（17 个绿框的位置和大小），其画风（卡通描边、平涂灰色、简笔渲染）**必须被完全忽略**。

输出的画风**完全由以下两个来源决定**：
1. **`{ART_STYLE}` 字段** — 用户指定的画风描述（如"像素风"、"3D 渲染"、"平面矢量"、"赛璐璐动画"等）
2. **角色参考图的视觉风格** — 参考图的渲染技法、线条粗细、光影表现、色彩饱和度

| 用户指定画风 | 输出应呈现 | 绝对不能 |
|-------------|-----------|---------|
| 像素风 (pixel art) | 像素块、有限调色板、无平滑抗锯齿 | 不能画出模板的卡通描线 |
| 3D 渲染 (3D rendered) | 光影体积感、材质质感、环境光遮蔽 | 不能画成平涂 |
| 平面矢量 (flat vector) | 纯色块、几何简化、无渐变 | 不能有素描线条 |
| 赛璐璐动画 (anime cel-shaded) | 明确的二值阴影、动画风描线 | 不能照搬模板的简笔风 |
| 油画/手绘 (painterly) | 笔触纹理、色彩过渡 | 不能有硬描线 |

## ⚠️ 截面衔接规则（关键）

骨骼动画拼合时，相邻部件的截面必须**完整匹配**，不出现间隙或重叠。每个部件在其截断线处应画出**完整的截面轮廓**（如衣物、皮肤、盔甲的截面端），确保相邻两段拼接时视觉连续。

| 衔接关系 | 上段底部截面 | 下段顶部截面 | 说明 |
|----------|-------------|-------------|------|
| 头→上胸 | 头部在**下颌线**截断，**不含脖子** | 上胸从**脖子顶部**开始，含完整脖子 | 头部是纯头颅+发型，脖子归属上胸 |
| 上胸→下腰 | 上胸在**胸腔底部/肋骨线**截断 | 下腰从**胸腔底部**开始 | 截面线一致 |
| 下腰→臀裤 | 下腰在**腰线/髋线**截断 | 臀裤从**腰线**开始 | 截面线一致 |
| 臀裤→大腿 | 臀裤在**大腿根部**截断 | 大腿从**髋关节**开始 | 截面线一致 |
| 大腿→小腿 | 大腿在**膝关节**截断 | 小腿从**膝关节**开始 | 截面线一致 |
| 小腿→脚 | 小腿在**脚踝**截断 | 脚从**脚踝**开始 | 截面线一致 |
| 上臂→前臂 | 上臂在**肘关节**截断 | 前臂从**肘关节**开始 | 截面线一致 |
| 前臂→手 | 前臂在**腕关节**截断 | 手从**腕关节**开始 | 截面线一致 |

## 角色设计约束（骨骼动画兼容性）

- **头发**：可以有中长发（七头身比例下不易穿模），但不应超过胸线
- **裙子**：如果有裙子，裙摆应在臀裤框(BOX 6)内收束，不能遮住大腿框
- **手脚**：必须作为独立分离的部件生成，不能与相邻部件连接
- **躯干三段**：每段在截面线处画出完整的截面端，不留悬挂衣物，也不缺失截面轮廓
- **武器（框17）**：**按设定可选**。无武器则框17 留空。若有武器：武器绿框 768×219，**几何中心为横条内 (384, 110)**，**剑柄/握柄必须画在该中心点上**（整剑以此点为轴左右延伸，尖端朝右），否则绑骨后武器绕错点旋转、与右手错位。

---

## 提示词模板

```
You are generating a CHARACTER PARTS BREAKDOWN sheet for 2D skeletal animation — realistic 7-head body proportion.

⚠️ CRITICAL RULES — READ BEFORE DRAWING:

1. The FIRST reference image is the LAYOUT TEMPLATE (gray mannequin on green boxes, 768×1376 vertical). It defines ONLY the EXACT position, size, and arrangement of all 17 green boxes. You MUST reproduce this EXACT layout — same number of boxes (17), same positions, same sizes. ⚠️ The template's ART STYLE, rendering technique, line weight, shading, and color palette must be COMPLETELY IGNORED — do NOT copy or imitate the template's visual style in any way.
2. The SECOND reference image is the CHARACTER REFERENCE. Copy the character's appearance (skin color, hair, clothing, accessories, design details) from it. Do NOT create separate front/side/back breakdowns. Every body part is drawn ONLY ONCE in 45° side view.
3. The ART STYLE of the output is defined SOLELY by the "Style:" field below and the character reference image's visual style — NOT by the template. For example, if the style says "pixel art", draw pixel art parts; if it says "3D rendered", draw 3D-rendered parts; if it says "flat vector", draw flat vector parts. The gray mannequin template contributes ZERO influence to the art style.
4. The template mannequin is ONLY a guide for POSE, SIZE, and POSITION of each body part within its green box. You must:
   a. Replace ALL gray skin with the character's actual skin color
   b. Replace the bald head with the character's FULL HAIRSTYLE + accessories
   c. Replace ALL gray body parts with the character's clothed, colored body parts
   d. Match the mannequin's POSE and POSITION in each green box, but draw at natural size — do NOT stretch to fill the box
   e. ⚠️ Do NOT reproduce the mannequin's cartoon outline style, flat gray shading, or simplistic rendering — use the art style specified below instead

⚠️ BOX COUNT: The output MUST contain EXACTLY 17 green boxes — no more, no less. Do NOT add extra boxes. Do NOT duplicate any body part. Each part appears ONCE.

⚠️ SEAMLESS JOINT CUTS — Adjacent parts MUST have matching cross-sections at their shared boundary so they connect seamlessly when assembled. Each part must show the COMPLETE cross-section at its cut line (clothing edge, skin, armor rim). No gaps, no missing segments between adjacent parts. Specifically:
- HEAD ends at the JAWLINE — NO neck in the head box.
- UPPER TORSO starts from the TOP OF THE NECK (includes the full neck) down to the ribcage bottom.
- Each pair of adjacent parts shares the SAME cut line: upper torso↔lower torso at ribcage, lower torso↔hips at waist, hips↔thigh at hip joint, thigh↔calf at knee, calf↔foot at ankle, upper arm↔forearm at elbow, forearm↔hand at wrist.

Character: {CHARACTER_DESC}
Style: {ART_STYLE}

=== EXACTLY 17 GREEN BOXES (each part appears ONLY ONCE, all in 45° side view) ===

--- 1 HEAD BOX (top center, character's head with FULL HAIR + accessories) ---

[BOX 1 — top-center 353×243] BATTLE/SERIOUS head:
45° side view facing right. Sharp determined eyes, firm or neutral mouth. Complete hairstyle with full volume + all hair accessories. Head centered in box. ⚠️ The head ends at the JAWLINE — do NOT draw any neck. The bottom edge of the head is a clean horizontal cut at the jaw/chin line. No neck, no shoulders.

--- TORSO (3 boxes, center column — split into upper chest / lower waist / hips) ---

[BOX 2 — center 353×141] Upper torso (neck + chest + shoulders):
⚠️ This box INCLUDES the FULL NECK. Draw from the TOP of the neck (where the head's jawline ends) down to the bottom of the ribcage, including shoulder lines. The neck must be complete — show the full cylinder of the neck connecting to the collarbone/shoulder area. Wearing the character's upper clothing (collar, chest armor, shirt, etc). Cut off cleanly at: shoulder joints (where upper arms connect), ribcage bottom. The TOP of this part must show the neck's cross-section that seamlessly meets the head's jawline cut. 45° side view.

[BOX 3 — center 352×121] Lower torso (waist):
Draw from ribcage bottom to waist/hip line. The TOP cross-section must match BOX 2's bottom edge exactly. Wearing the character's mid-section clothing (belt area, waist sash, etc). Clean cut at top (ribcage line) and bottom (hip joint line). Both cut lines must show complete cross-section edges. 45° side view.

[BOX 6 — center 353×133] Hips (pelvis + shorts/skirt base):
Draw from hip joint line to the top of the thigh. The TOP cross-section must match BOX 3's bottom edge exactly. Wearing lower garment (shorts, skirt base, armor tassets, etc). If character wears a skirt, draw ONLY the portion above thigh-top — the skirt MUST NOT hang below this box. Clean cut at top (waist) and bottom (thigh joint). Both cut lines must show complete cross-section edges. 45° side view.

--- ARMS (6 boxes, symmetrically flanking the torso rows) ---

[BOX 5 — left of BOX 2, 141×142] Right upper arm:
Shoulder joint to elbow ONLY, with sleeve. Show complete cross-section at both shoulder end and elbow end. Centered in box at natural size. 45° side view.

[BOX 4 — right of BOX 2, 142×142] Left upper arm:
Shoulder joint to elbow ONLY, with sleeve. Show complete cross-section at both shoulder end and elbow end. Centered in box at natural size. 45° side view.

[BOX 8 — left of BOX 3, 141×142] Right forearm:
Elbow to wrist ONLY, with sleeve/bracer. Top cross-section matches BOX 5's elbow cut; bottom cross-section at wrist. Centered in box at natural size. 45° side view.

[BOX 7 — right of BOX 3, 142×142] Left forearm:
Elbow to wrist ONLY, with sleeve/bracer. Top cross-section matches BOX 4's elbow cut; bottom cross-section at wrist. Centered in box at natural size. 45° side view.

[BOX 12 — left of BOX 6, 145×143] Right hand:
Wrist to fingertips ONLY, empty hand (weapon is drawn separately). Top cross-section matches BOX 8's wrist cut. Centered in box at natural size. 45° side view.

[BOX 9 — right of BOX 6, 145×141] Left hand:
Wrist to fingertips ONLY, empty hand. Top cross-section matches BOX 7's wrist cut. Centered in box at natural size. 45° side view.

--- LEGS (6 boxes, two vertical columns below hips) ---

[BOX 10 — below hips, left column top, 142×142] Right thigh:
Hip joint to knee ONLY, fitted clothing/armor. Top cross-section matches BOX 6's thigh-joint cut. Show complete cross-section at knee end. Centered in box at natural size. 45° side view.

[BOX 11 — below hips, right column top, 141×142] Left thigh:
Hip joint to knee ONLY, fitted clothing/armor. Top cross-section matches BOX 6's thigh-joint cut. Show complete cross-section at knee end. Centered in box at natural size. 45° side view.

[BOX 14 — below BOX 10, 142×143] Right calf:
Knee to ankle ONLY, with leg armor/stocking. Top cross-section matches BOX 10's knee cut; bottom cross-section at ankle. Centered in box at natural size. 45° side view.

[BOX 13 — below BOX 11, 141×143] Left calf:
Knee to ankle ONLY, with leg armor/stocking. Top cross-section matches BOX 11's knee cut; bottom cross-section at ankle. Centered in box at natural size. 45° side view.

[BOX 16 — below BOX 14, 141×142] Right foot/boot:
Foot and shoe/boot ONLY — nothing above the ankle. Top cross-section matches BOX 14's ankle cut. Centered in box. 45° side view.

[BOX 15 — below BOX 13, 141×143] Left foot/boot:
Foot and shoe/boot ONLY — nothing above the ankle. Top cross-section matches BOX 13's ankle cut. Centered in box. 45° side view.

--- WEAPON (1 horizontal bar at bottom, OPTIONAL by character design) ---

[BOX 17 — bottom 768×219] Weapon:
- OPTIONAL: If the character has NO weapon / is unarmed, leave this box EMPTY (draw nothing inside the green box).
- IF drawing a weapon (MANDATORY center alignment):
  - The weapon green box is 768×219 pixels. Its geometric center is at 384px from the left and 110px from the top within the box.
  - The grip/handle (the part the hand holds) MUST be drawn AT this exact center point — the weapon extends left and right from this pivot, grip in the middle, tip pointing RIGHT.
  - Lay the weapon horizontally, tip points RIGHT.

=== ⚠️ ONE PART PER BOX — NO MIX-UPS ===
Each green box is assigned to ONE specific body part. Draw ONLY that assigned part inside its box. Do NOT place a body part in the wrong box. If a part looks similar to another (e.g., forearm vs calf), check the BOX NUMBER and its label — the label tells you exactly what goes there. No part should appear in more than one box, and no box should contain a part that belongs elsewhere.

=== RULES ===
- ⚠️ ART STYLE ISOLATION — The template (first image) provides LAYOUT ONLY. Its cartoon/flat shading style MUST NOT influence the output. The art style comes EXCLUSIVELY from the "Style:" field and the character reference image. If the style says pixel art, the output must be pixel art. If 3D rendered, the output must look 3D rendered. If anime cel-shaded, use anime cel-shading. NEVER default to the template's gray mannequin style
- EXACTLY 17 green boxes in total — count them: 1 head + 3 torso segments + 6 arms + 6 legs + 1 weapon bar = 17. Do NOT create more boxes. No extra boxes allowed
- The character reference (second image) defines the character's APPEARANCE and VISUAL STYLE — copy both the character design AND the rendering style from it. Do NOT generate multiple-view versions of body parts. Every part appears ONCE in 45° side view
- Output image MUST be 768×1376 pixels, 9:16 vertical, same layout as the FIRST reference template. Do not change aspect ratio or box positions
- Generate boxes 1–16 always; BOX 17 (weapon) is OPTIONAL — leave empty if no weapon; if armed, draw weapon with grip/handle at box center (768×219 → center at 384, 110 within the bar)
- Each part is a SEPARATE isolated piece — do NOT connect or merge adjacent parts
- ⚠️ HEAD has NO NECK — head box cuts at jawline only. The NECK belongs to BOX 2 (upper torso)
- ⚠️ SEAMLESS CROSS-SECTIONS — Every part must show a complete, clean cross-section at each cut line. Adjacent parts share the same cut line so they tile together with zero gaps. Do NOT leave ragged or incomplete edges at cut boundaries
- Torso is split into 3 SEPARATE segments (upper chest with neck / lower waist / hips) — each segment shows complete cross-section edges at its top and bottom cut lines
- Parts should be at NATURAL proportional size, centered in their box — do NOT stretch to fill the entire box, empty space around the part is OK
- Hands and feet are SEPARATE boxes — draw them as distinct isolated parts
- White areas between boxes must stay empty — do NOT fill white space with additional boxes or parts
- All parts 45° side view facing right
- Realistic 7-head body proportion (NOT chibi)
- Character skin color from description, NOT gray
- No text or letters on the image
```

---

## MCP 调用规范

```json
{
  "tool": "image_to_image",
  "server": "image-gemini",
  "arguments": {
    "prompt": "[组装后的完整英文提示词，含角色详细描述]",
    "inputImagePaths": [
      "/path/to/references/template_parts_7h.png",
      "/path/to/output/side34.png"
    ],
    "outputPath": "/path/to/character_parts.png",
    "aspectRatio": "9:16"
  }
}
```

---

## 后处理

生成的 768×1376 拆件图需要配合七头身专用的 `boxs.json`（包含上述 17 个绿框坐标）进行裁切。裁切后对每个部件执行 `remove_background` + `despill_green` 去除绿幕和绿边，再传给 `generate_spine_animation` 生成动画。
