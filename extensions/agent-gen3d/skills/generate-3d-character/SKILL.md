---
name: generate-3d-character
description: 从一句需求或一张参考图生成一个带贴图、游戏可用的 3D 角色资产。默认只交付静态角色；只有用户明确要它「会动」才绑骨 + 套动作（按次计费）。当用户要一个 3D 角色（人形 / 生物）时调用。
---

# Generate a 3D Character

## When to use

- 用户要一个 3D **角色**资产（人形 / 生物），文生 / 图生 / 多视图都行
- 已有一个静态角色，用户明确说「让它动起来」（走 / 跑 / 挥手）要绑骨 + 套动作
- 不要用它做道具 / 小物件（那是 AI-Asset / wb-ai-asset）或程序化 CAD（那是 Poly / wb-3d-lowpoly）

## Procedure

> **默认只做到「静态角色」就交付。** 绑骨 / 动作要花真钱（按次计费），**只在用户明确要它会动时**才做。

1. **确认前置**：先有激活的游戏，拿到 `slug`（kebab-case）；每次 `gen3d:*` 调用都显式带 `slug`，漏了会直接报 `missing_game`。先 `gen3d:provider-status` 看 provider 能力 / 配置。
2. **生成静态角色**：`gen3d:text-to-3d` / `gen3d:image-to-3d` / `gen3d:views-to-3d`（公测默认 provider = Meshy）。图生 / 多视图前若是简单卡通全身图，可先 `gen3d:pose-standardization` 标准化成 A/T-pose；Meshy 文生想加贴图用 `gen3d:refine-mesh`。
3. **评分**：`gen3d:score-quality` 跑客观五维（geometry / topology / texture / pbr / prompt_fidelity），判断要不要重生成或换 provider。
4. **命名 + 交付**：`gen3d:rename-asset` 给清晰显示名（`userLabel`，只改显示名不动磁盘），把静态角色的 `assetPath` 回报给用户。
5. **交付时主动补一句（必做）**：告诉用户「这个角色现在是静态的；想让它**会动**（走 / 跑 / 挥手）我可以帮它绑骨 + 加动作，但要花一点配额——需要就说一声」。
6. **仅当用户明确要会动**（仅人形 `characters` 槽）：`gen3d:auto-rig` 绑骨（追加 `rigged_model`、保贴图、置位 `readiness.rigged`）→ `gen3d:list-motions`（按 `query`/`category`/`rigType` 收窄）挑 `actionId` → `gen3d:apply-motion`（一次一个动作，按动作幂等）。

## Examples

- ✅ 「一个红斗篷骑士」→ text-to-3d → score-quality → rename → 交 `assetPath` + 提示「要不要让它动」
- ✅ 用户给一张角色全身图 → pose-standardization(A/T-pose) → image-to-3d → 交付静态
- ✅ 用户「让骑士走起来」→ auto-rig → list-motions(query=walk) → apply-motion
- ❌ 用户只要个静态展示，却自作主张 auto-rig + apply-motion —— 白烧配额
- ❌ 给非人形（道具 / 怪物座骑）硬 auto-rig —— 软门控会拒，别硬试

## Anti-patterns

- 不要漏 `slug`——每次 `gen3d:*` 调用都要显式带，否则 `missing_game`。
- 不要默认就绑骨 / 套动作——静态优先，会动是 opt-in、按次计费。
- 一次只套一个动作；命中 cache 会复用旧资产**并忽略新名字**（预期行为）。
- `rig_task_id` ~3 天过期；套动作报 `rig_expired` 时由用户决定，只有显式 `autoReRig` 才自动重绑（再扣分）。
- 资产状态走 sidecar 结构化字段（`motionRef` 等），**不要靠解析文件名**判断。
- 不接道具 / 小物件（转 AI-Asset）、不接程序化 CAD（转 Poly）、不写引擎代码。
