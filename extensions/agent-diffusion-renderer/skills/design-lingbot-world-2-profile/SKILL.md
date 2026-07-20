---
name: design-lingbot-world-2-profile
description: 为 Diffusion Renderer 设计、审查和修复 LingBot World 2 可交互场景 Prompt Profile，生成分层 base/camera/movement/action/vertical 文案预览与匹配的 seed-image prompt。Use when authoring LingBot World 2 scenes, refining action prose, or diagnosing prompt/input/image drift.
---

# Design LingBot World 2 Profile

## 入口

收集：

- active game root 与 `continuityKey`
- `visual-priors/manifest.json` 对应图片
- 主体、环境、风格、固定地标、可用道具
- camera mode 与 move/look 输入语义
- runtime `actionKey` 列表及 actor/target
- jump/crouch/stand 等 vertical action

缺信息时只询问会改变主体、视角或动作集合的决定；其余采用保守默认值。

## Runtime gate

输出任何可落盘建议前检查当前仓库是否存在并导出：

1. 版本化 portable `visual-presentation/manifest.json` schema
2. 对应 Editor resolver
3. Diffusion Renderer composer/adapter consumer
4. 覆盖该 contract version 的 consumer test
5. durable `VisualPresentationIntent` consumer for creative direction/playback

任一缺失：

- 只输出设计预览与待实现 blocker。
- 不创建 runtime 不会读取的 manifest、namespaced profile 或 Agent Pack。
- 不声称游戏已接入该 Profile。

## 模式

| 模式 | 条件 | 产出 |
| :-- | :-- | :-- |
| Author | 游戏明确要求 LingBot 高保真 | portable catalog/action prose 与 LingBot prompt 预览 |
| Repair | 已有 catalog 或 prompt 输出漂移 | 最小修改冲突 layer；用干净 session 复验 |

## 工作流

1. **读游戏真相**
   - 从 ECS/游戏代码提取实际 actor、camera、movement、action keys。
   - 从 prior 图片提取可见主体、构图、道具与地标。
   - 文案不得要求图片和游戏状态里不存在的核心对象。

2. **建立 layer ownership**
   - `base`：主体、环境、风格、固定地标。
   - `camera`：构图与 look-input 含义。
   - `movement`：idle 与 travel 的主体行为。
   - `events`：由 active action 追加的视觉变化。
   - `vertical`：jump/crouch/stand 的完整动作弧。

3. **写 base**
   - 一至三句；具体描述主体、环境和风格。
   - 事件会使用的道具必须已出现且处于可使用姿态。
   - 只固定二至四个空间锚点；不要固定纹理噪声。
   - 不写 camera、输入、持续运动或 action。

4. **写 camera pair**
   - `static`：主体/anchor 稳定；仅 held look-input 产生运动。
   - `dynamic`：明确跟随或第一人称推进；定义 look-input 是转向还是观察。
   - 武器/工具容易导致第一人称漂移时加入局部 disambiguation guard。

5. **写 movement pair**
   - `static`：主体位置不变，但有两到三个微动作。
   - `dynamic`：写地面接触、推进方式和环境响应。
   - 不重述主体外观、世界身份或 camera contract。

6. **写 action details**
   - key 必须与游戏 `actionKey` 一致；不绑定数字键。
   - `active` 描述持续期间可见的完整行为。
   - 当前 runtime 只消费必填 `active`；`started`/`ended` prose 等待后续 namespaced profile contract。
   - camera/movement/vertical prose must remain portable; never write `set_camera_pose`,
     chunk-size, or provider command names into the catalog.
   - 所有 active action 必须可稳定排序和叠加；不能假设另一 action 未激活。
   - 动作必须引用已建立或合理引入的 actor、target、道具。

7. **写 vertical**
   - jump 必须包含起跳、腾空、落地。
   - crouch/stand 必须互为可逆的稳定状态。
   - 车辆、坐骑或非人主体使用场景专用文案。

8. **组合与预算**
   - 分别组合 idle、moving、最大两个 active events、每个 vertical 状态。
   - 最坏常见组合目标不超过约 2000 字符。
   - 超限时报告 blocker 并返回修订建议；runtime 不静默截断 prompt。
   - 相同 action 集合必须产生字节稳定的 event 顺序。

9. **派生 seed-image prompt**
   - 从 `base + camera.static + movement.static` 派生，不另写一个世界。
   - 去掉输入语言；保留主体、固定地标、构图、idle 姿态和 action 道具。
   - 目标为 16:9；文本与已有 prior 不一致时优先修正文案或重新生成 prior。
   - Seed-image prompt 是临时派生物，不得回写成 authored runtime SSOT。

10. **验证**
    - 按 [references/prompt-language.md](references/prompt-language.md) 检查 layer 冲突。
    - 按 [references/profile-format.md](references/profile-format.md) 检查 portable catalog 输出形状。
    - 首次作者化时对照 [references/example.md](references/example.md) 的 runtime action → profile event 映射。
    - 用全新 session 验证 prompt 修复；坏帧进入历史后不能用热更新证明修复无效。

## 输出

返回：

1. 模式与 `continuityKey`
2. schema/runtime gate 结果
3. scene/action 或 LingBot profile
4. 派生 seed-image prompt
5. 字符预算报告
6. image/text/input 对齐风险
7. 需要游戏开发者确认的最少问题

## 禁止

- 不向游戏代码写 `set_prompt`、`set_camera_pose`、JWT、session 或 KV cache 命令。
- 不把 `StructuredExample` 抬进共享 `@forgeax/types`。
- 不复制 seed image 路径到第二个 catalog。
- 不用 camera 文案修正 movement 问题，也不用 event 重写 world identity。
- 不生成 loader 尚未支持的文件，不写 namespaced profile 或 Agent Pack manifest。
- 不把 pause/resume/restart、seed、rotation speed、attention 或 KV-cache 命令写入游戏 catalog。
