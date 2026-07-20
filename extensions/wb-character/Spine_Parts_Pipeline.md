# AI 角色拆件生成管线 (Spine 2D Character Parts Pipeline)

## 1. 概述
本管线用于通过 AI 图像生成工具（如 WebUI / ComfyUI / Midjourney / Nano），将**任意横版角色设定图**，自动化转换为**适用于 Spine 2D 骨骼绑定的 16+1 部件排版图**。

本管线采用**实体模板映射法 (Style Transfer / Identity Override)**，抛弃了容易让 AI 产生幻觉的“线框约束”，转而使用一张已经拆分好的“占位角色排版图”作为姿势和布局参考。

## 2. 必备输入文件

执行此管线前，必须准备两张参考图：

1. **LAYOUT TEMPLATE (布局模板图)**
   - **内容**：一张纯白背景的、包含 16 个身体切件 + 1 个武器的彩色角色拆分图。
   - **作用**：控制最终输出的画幅比例（竖版）、所有 17 个部件的位置、大小以及 3D 透视角度。
   - *（目前使用的是橘发机能风少女拆分图）*

2. **CHARACTER DESIGN (角色设定图)**
   - **内容**：该角色的详细概念设计图（无论排版多复杂、横版或竖版均可）。
   - **作用**：提供目标角色的性别、发型、面部特征、服装材质、武器外观以及整体画风。

## 3. 核心生图规则 (控制参数建议)

- **强制输出比例**：生图时，**必须**手动将输出的长宽比（Aspect Ratio）锁定为与“布局模板图”完全一致的尺寸（如 3:4 或 9:16）。绝对不能匹配“角色设定图”的横版尺寸，否则排版会彻底崩溃。
- **ControlNet 设置（若使用）**：
  - 将 `LAYOUT TEMPLATE` 放入 ControlNet (Canny 或 Depth)，权重设为 `0.8 - 0.9`，这能完美锁死部件不发生位置漂移。
  - 将 `CHARACTER DESIGN` 作为特征参考（IP-Adapter / Reference Only），权重设为 `0.6 - 0.8`。

---

## 4. 通用生成提示词模板 (Prompt Template)

以下是**第 13 版极致优化**的通用提示词。请将括号中的大写占位符（如 `[CHARACTER_DESCRIPTION]`）替换为您当前需要生成的角色特征。

```text
You are EXTRACTING and SEPARATING a character into 15 individual body parts + 1 weapon for 2D skeletal animation (Spine 2D).

You have two reference images:
1. LAYOUT TEMPLATE: Shows how the 16 separated parts should be arranged on the canvas.
2. CHARACTER DESIGN: The target character's concept art.

⚠ THE #1 MOST IMPORTANT RULE — EVERY PART MUST BE COMPLETELY ISOLATED:
Each of the 16 parts must be drawn as a SEPARATE, INDEPENDENT piece with CLEAR WHITE SPACE between it and every other part. NO part may touch, overlap, or connect to any other part. Think of it as cutting a paper doll into 16 pieces and spreading them apart on a white table — every piece is completely alone.

OTHER RULES:
1. LAYOUT: Arrange the 16 parts in approximately the same positions as the LAYOUT TEMPLATE (same rows, same columns). The exact scale can vary — adapt body proportions to match the CHARACTER DESIGN (male = masculine build, female = feminine build).
2. REPLACE IDENTITY: The template character (orange hair girl) is a placeholder. Replace her entirely with the character from the CHARACTER DESIGN ([ENTER_BRIEF_CHARACTER_IDENTITY_HERE]) — body type, clothing, weapon, everything.
3. FACE RIGHT: The HEAD must face RIGHT.
4. JOINT PADDING: At connection points (shoulders, elbows, knees, hips), add rounded padding so parts can overlap smoothly when animated. But the parts themselves must NOT touch each other on the sheet.
5. PURE WHITE BACKGROUND: No boxes, frames, or colored backgrounds. Pure white only.

=== THE 16 PARTS TO EXTRACT (each one ISOLATED, with white space around it) ===

1. [Top Center]: HEAD — [ENTER_HEAD_DESC]. Facing RIGHT. Include neck base.
2. [Row 2, Left]: RIGHT UPPER ARM — [ENTER_R_UPPER_ARM].
3. [Row 2, Center]: CHEST/TORSO — [ENTER_CHEST_DESC].
4. [Row 2, Right]: LEFT UPPER ARM — [ENTER_L_UPPER_ARM].
5. [Row 3, Left]: RIGHT FOREARM — [ENTER_R_FOREARM].
6. [Row 3, Center]: WAIST/PELVIS — [ENTER_WAIST_DESC].
7. [Row 3, Right]: LEFT FOREARM — [ENTER_L_FOREARM].
8. [Row 4, Far Left]: RIGHT HAND — [ENTER_R_HAND].
9. [Row 4, Center-Left]: RIGHT THIGH — [ENTER_R_THIGH].
10. [Row 4, Center-Right]: LEFT THIGH — [ENTER_L_THIGH].
11. [Row 4, Far Right]: LEFT HAND — [ENTER_L_HAND].
12. [Row 5, Left]: LEFT CALF — [ENTER_L_CALF].
13. [Row 5, Right]: RIGHT CALF — [ENTER_R_CALF].
14. [Row 6, Left]: LEFT BOOT — [ENTER_L_BOOT]. Draw as ONE single isolated boot.
15. [Row 6, Right]: RIGHT BOOT — [ENTER_R_BOOT]. Draw as ONE single isolated boot.
16. [Far Right, Vertical]: WEAPON — [ENTER_WEAPON_DESC]. Vertical orientation.

⚠ FINAL CHECK: Count all 16 parts. Verify NONE of them touch each other. Every part must have visible white space on all sides separating it from its neighbors.

Style: Match the art style of the CHARACTER DESIGN ([ENTER_STYLE_KEYWORDS]). All 16 parts on pure white background.
```

---

## 5. 编写特定角色提示词的 SOP（标准操作程序）

当有新的角色原画需要拆件时，按照以下步骤**填空**：

### 步骤 1：总结角色核心身份 (规则 2)
用一句话概括角色，覆盖掉模板的身份。
*示例：`a futuristic cyberpunk female medic with neon green jacket and high-tech glasses.`*

### 步骤 2：拆解角色 16 个部件 (部位列表 1-15)
观察角色的设定图，将他的衣服、护甲、肤色“脱下来”，填入 1 到 15 的位置。
- **要点 1**：不要写坐标，直接写穿了什么（如 `Brown leather jacket sleeve`）。
- **要点 2**：如果有不对称设计（如左手带手套，右手没带），必须在左右手明确区分，AI 会严格执行。
- **要点 3**：保留我预设的 `Rounded padding at elbow`（肘部圆滑补肉）等关于防穿帮的系统级后缀词，不要删掉。

### 步骤 3：定义武器 (部位 16)
用最明确的词语描述设定图中的武器，并确保它适合长条形的竖版空间。
*示例：`A futuristic glowing sniper rifle. Keep it Perfectly VERTICAL.`*

### 步骤 4：固定画风 (Style)
从原画中提取画风关键词。
*示例：`Flat anime rendering, cel-shading, pastel colors, thick clean lineart.`*

## 6. 常见问题排查 (Troubleshooting)

| 现象 | 原因分析 | 解决方案 |
|------|---------|---------|
| **部件位置乱飞/挤成一团** | AI 未能识别模板图或输出比例错误 | 检查是否将输出画幅设置成了横版。必须锁定为竖版（参考模板图比例）。若使用 ControlNet，需提高 Canny/Depth 权重。 |
| **面部朝向错误（朝左了）** | AI 受原设计图透视影响 | 提示词中第 3 条规则和部位 1 必须保留大写警告：`MUST BE FACING RIGHT`。 |
| **生出的图依然像橘发少女** | 提示词权重被参考图压制 | 强化规则 2，增加目标角色特征的详细描述；如果是图生图（Img2Img），调高 Denoising Strength（重绘幅度，建议 0.65-0.75）。 |
| **关节处像被一刀切平了** | AI 忽略了补肉（Padding）指令 | 确保部件描述后带有 `Rounded padding at...` 或 `Rounded extended bottom edge` 等术语。 |