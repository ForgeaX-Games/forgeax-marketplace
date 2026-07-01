---
name: design-2d-character
description: 从一行 idea + Iori 的玩法柱 + Kotone 的角色 bio + Iro 的画风 token 出发，产出一个角色的 2D 三件套——portrait + turnaround + character.manifest.json（含 profile.md）。当用户要在 wb-character 工作台里立一个角色 / 怪物 / NPC / 载具时调用。
---

# Design a 2D Character

## When to use

- 用户要一个新角色 / 怪物 / NPC / 载具的 2D 概念视觉 + 档案
- 已有角色要续写 / 改风（先读现状再改，不从零开始）
- 不要用它画动画（交 2D 动画设计师）、做 VFX（交 3D 特效设计师）、建 3D 模型（交建模师）

## Procedure

1. **先 list 再 generate**：开场第一件事 `character:list` 扫当前 game 已有哪些角色，告诉作者「你已有 X / Y / Z，要续写还是新建」——别看见空白就盲目新建。
2. **读上游 + 画风**：`code:read` 一次 `art-style.md` / `palette.json`（Iro 的画风 token）+ Iori 的 `pillars.md` + Kotone 的 `characters/*.md`，把 color / line / composition token 写进 prompt。
3. **定位三选一（硬字段）**：明确角色是 `hero | npc | monster | vehicle`——这决定下游 wb-anim 走哪条流水线，不能含糊。
4. **出 portrait（先于 turnaround）**：`character:generate-portrait`（主用 Seedream，备 Gemini nano-banana / Azure GPT-Image）。prompt 必带**相机语言**（景别 + 视角 + 光线）+ **画风 token**。作者满意人脸 / 姿态后再往下。
5. **出 turnaround（满意才跑，贵 3 倍）**：`character:generate-turnaround`（正 / 侧 / 背）。载具只要一张 3/4 视角 hero shot，不跑三视图。
6. **补档案三件套**：`character.manifest.json`（name / role / world / class / vibe / anchors / downstream_hints）+ `profile.md`（80–200 字：定位 / 战斗类型 / 性格关键词 / 招牌动作 / 视觉记忆点）。怪物多写 weakness / behavior_pattern；NPC 多写 occupation / dialogue_tone；载具多写 vehicle_class / silhouette_keyword。
7. **emit 完工事件**：每完成一个三件套，主动 emit `character.portrait.generated` / `character.turnaround.generated`，通知下游 wb-anim / wb-skill。

## Examples

- ✅ 「一个手持长剑的红斗篷骑士」→ list → 读 art-style → portrait(full-body, 3/4, soft rim, palette token) → 作者点头 → turnaround → manifest + profile
- ✅ 载具「蒸汽朋克独轮摩托」→ 一张 3/4 hero shot + manifest（vehicle_class / silhouette_keyword），不跑三视图
- ❌ 没读 art-style 就生成 → 画风对不齐
- ❌ 只交一张 portrait、不写 manifest + profile → 下游拿不到锚点等于没干活

## Anti-patterns

- 不要不 `character:list` 就盲目新建。
- 不要 portrait 还没满意就跑 turnaround（倒过来浪费配额）。
- 不要手动改文件名 / 文件——用 `character:rename`，否则 manifest 脱节。
- prompt 不要只写「骑士」——必带相机语言 + 画风 token。
- 失败兜底：portrait 失败立刻降级备用模型（Seedream → Gemini → Azure），把失败 prompt 写进 memory。
- 不画动画 / 不做 VFX / 不写玩法数值 / 不写剧情对白——各有其人。
