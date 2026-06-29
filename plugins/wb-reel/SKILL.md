---
name: wb-reel:author-guide
description: 互动影游 (FMV) 编辑器 AI 调用指南 — 剧本 / 媒体 / Seedance 视频任务
trigger: /reel
---

# Reel Studio · AI Skill

`@forgeax-plugin/wb-reel` 是一个互动影游 (Full Motion Video) 编辑器与运行时。
作者用它把「提示词 / 视频 / QTE / 选项分支」拼装成可序列化的 `Scenario` JSON，
运行时按 `elapsedMs` 确定性回放。

灵感原型：《完蛋！我被美女包围了》一类限时点按 + 选择驱动的悬念片。

## 数据模型（先看这个）

```text
Scenario
└── Scene[]
     ├── media         { kind: VIDEO | IMAGE_PROMPT | IMAGE_STATIC | PLACEHOLDER, ... }
     ├── dialogue[]    台词 + TTS 配置
     ├── qte?          QTE 序列（perfect:80 / great:160 / good:280 ms 评分）
     └── branches[]    跳转 / 结局分支
```

- **编辑期** `mode='editor'`：作者拼装 100% 可序列化的 Scenario JSON。
- **运行期** `mode='player'`：纯函数 `QTEEngine` 负责评分，UI 按 `elapsedMs` 推进。
- **媒体三态**：上传视频 · GPT-Image-2 占位图 · 静态图 · 渐变兜底。

## Tool 列表

| tool id              | 用途                              | 关键 args |
|----------------------|-----------------------------------|-----------|
| `reel:list-scenarios`  | 列出所有本机剧本                  | `limit?`, `offset?` |
| `reel:get-scenario`    | 读取指定剧本完整 JSON             | `scenarioId`(必填) |
| `reel:save-scenario`   | 新建 / 覆盖剧本                   | `scenario`(完整对象) |
| `reel:list-assets`     | 列出 `.reel-assets/` 媒体库       | `kind?`(image/video), `scenarioId?` |
| `reel:generate-video`  | 提交 Seedance 异步视频任务        | `prompt`(必填), `referenceImages?`, `duration?`, `resolution?`, `ratio?` |
| `reel:get-video-task`  | 查询 Seedance 任务状态            | `taskId`(必填) |
| `reel:generate-visuals`| 提取视觉锚点(场景/道具)并出图：角色定妆照+场景基准图(多角度)+关键道具图（非破坏性，不碰分镜） | `scope?`('anchors'), `scenarioId?`, `force?` |
| `reel:generate-auditions`| 给角色生成「试镜视频+音色」：定妆照→Seedance ~10s/3:4 试镜视频→抽整段音轨为 MP3 绑为角色音色 | `scope?`('all'/'characters'), `characterIds?`, `scenarioId?`, `force?` |
| `reel:get-scene-timeline` | 读单场紧凑时间轴（shots/dialogue/qte/audio/textOverlays/markers，各带 id+时间）。**任何编辑前必调** | `sceneId`(必填), `scenarioId?` |
| `reel:update-shot`     | 改单镜：变速/定格 `speed`(0=定格/1=正常)、起止 `startMs/endMs`、入场转场 `transitionIn`、首尾动画 `clipAnim` | `sceneId`, `shotId`(必填) |
| `reel:edit-dialogue`   | 增/改/删 底栏字幕台词 | `sceneId`, `op`(add/update/remove) |
| `reel:edit-text-overlay`| 增/改/删 花字/文字叠加（自由摆放） | `sceneId`, `op`(add/update/remove) |
| `reel:edit-qte`        | 增/改/删 QTE 节奏点 | `sceneId`, `op`(add/update/remove) |
| `reel:edit-audio`      | 增/改/删 音频 clip（BGM/SFX/VO，含音量+淡入淡出） | `sceneId`, `op`(add/update/remove) |
| `reel:edit-marker`     | 增/命名/删 时间轴标记点（不进成片） | `sceneId`, `op`(add/rename/remove) |

### `reel:generate-visuals` —— 剧本→视觉锚点

剧本打磨好后调用一次，对**当前 active 剧本**做两步（均不新建/替换剧本、不生成分镜关键帧）：

1. **提取锚点**：若 `locations` / `props` 为空，自动从剧本蒸馏出场景与关键道具（复用 forge 同款提示词模板）。
2. **锚点出图**：生成角色定妆照(三视图) + 场景基准图(主图+多角度) + 关键道具图，写回各自 refImageId。

默认幂等（已有参考图的实体跳过）；`force:true` 全量重生。进度在 forge 对话区可见；该管线跑在浏览器，调用时工坊需保持打开。

### `reel:generate-auditions` —— 角色→试镜视频+音色

**前置**：角色必须先有定妆照（`reel:generate-visuals`）。以每个角色的定妆照为参考：

1. **试镜视频**：用 Seedance 2.0 图生视频生成一段 ~10s / 3:4 的单人胸像「试镜视频」（角色用本人口吻念一句台词，台词按角色性格各自生成）。定妆照网格会优先展示这段视频。
2. **音色提取**：把视频整段音轨抽成 MP3，绑为该角色的「音色样本」（`voiceSampleMediaId`）。后续生成该角色镜头视频时，自动用这段音色作 Seedance `reference_audio`，保证全剧嗓音一致。

参数：`scope='all'`（默认，给全部有定妆照的角色；缺失才生成）；`scope='characters'` + `characterIds:[...]` 只做指定角色；`force:true` 覆盖重生已有试镜视频。无定妆照的角色会被跳过并在对话里提示。该管线跑在浏览器（Seedance 凭据 + 抽音轨用 AudioContext），调用时工坊需保持打开。

**何时调**：用户说「生成试镜视频 / 角色试镜 / 角色音色 / 给角色配音色 / 定妆照视频」，或在视觉锚点（定妆照）出齐后想为角色补音色时。建议顺序：`forge-script` → `generate-visuals`（出定妆照）→ **`generate-auditions`**（出试镜视频+音色）→ `generate-storyboard` → `generate-keyframes` → `generate-video`（角色镜头会自动带上音色）。

## 时间轴编辑工具箱（成片后精修）

成片（分镜/关键帧/视频齐了）之后，用这组 **scene 级增量编辑**工具精修时间轴。也是 `reel-editor`
（剪辑师子智能体）的专属武器。**铁律：改任何 clip 前先 `reel:get-scene-timeline { sceneId }` 拿真实 id 与现有时间**；
时间一律 ms（相对场景起点），坐标一律归一化 0~1（中心 0.5,0.5）。

- **`reel:update-shot`** —— 改一镜的节奏与衔接：
  - `speed`：`0`=定格（画面停帧）、`1`=正常、`0.5~2` 慢/快放（范围 0~4）。
  - `startMs/endMs`：镜头在时间轴上的起止。
  - `transitionIn: { presetId, durationMs }`：入场转场；传 `null` 清除。
  - `clipAnim: { in:{preset,durationMs}, out:{...} }`：首尾动画；传 `null` 清除。
- **`reel:edit-dialogue`**（底栏电影字幕）/ **`reel:edit-text-overlay`**（花字，画面任意位置自由摆放）——
  `op=add`（`text+startMs` 必填，返回新 id）/ `op=update`（按 `id` 改）/ `op=remove`（按 `id` 删）。
  花字额外有 `x/y`(默认中心)、`fontSizePct`、`rotation`、`color`、`strokeColor`、`align`。
- **`reel:edit-qte`** —— QTE 节奏点。`op=add` 需 `shape(tap/hold/sweep)+appearAt+targetAt`；
  hold 需 `durationMs`、sweep 需 `sweepDir`；场景无 qte 块时自动以默认窗口/分值创建。
- **`reel:edit-audio`** —— 音频 clip。`op=add` 需 `role(bgm/sfx/vo)+ref+startMs+durationMs`
  （`ref`=素材库音频 id，先 `reel:list-assets` 查）；可设 `volume`(0~1)、`fadeInMs`、`fadeOutMs`、`offsetMs`、`label`。
- **`reel:edit-marker`** —— 时间轴标记点（编辑期锚点，**不进成片**）。`op=add` 需 `ms`（`label` 可选）/
  `op=rename` 需 `id+label` / `op=remove` 需 `id`。

> 这组工具都是**增量**：只动点名那一项，`update` 只改你传的字段。`add` 返回新 id；`update/remove/rename`
> 必须带来自 `reel:get-scene-timeline` 的真实 `id`。改完用 `reel:get-scene-timeline` 自查。

```
reel:get-scene-timeline({ sceneId: "scene-07" })
  → { shots:[{id,startMs,endMs,speed,...}], dialogue:[...], qteCues:[...], audio:[...], textOverlays:[...], markers:[...] }
reel:update-shot({ sceneId:"scene-07", shotId:"shot-3", speed:0.5, transitionIn:{ presetId:"flash-white", durationMs:400 } })
reel:edit-text-overlay({ sceneId:"scene-07", op:"add", text:"三年后", startMs:0, endMs:1500, x:0.5, y:0.18, fontSizePct:9 })
```

## 「重新生成」= 传 `force=true`（清理旧内容）

作者说「**重新生成 / 重做 / 重拆 / 重拍 / 重出 / 再来一次**」某个已有内容的节点时，调
`reel:produce-node` / `reel:generate-storyboard` **必须**带 `force=true`。否则管线**幂等跳过**
已完成的阶段，旧分镜/旧视频不被清理，新旧叠加→**重复镜头**。`force` 用新内容替换时间轴
旧镜头；**旧视频/关键帧不会删除**，会归档进素材库（按镜头归历史版本）可随时拿回采用。
工坊在替换前会弹确认框，不会偷偷删东西。

## 调用流程

### 1. 浏览作者已建剧本

```
reel:list-scenarios({})
  → { scenarios: [{ id, title, sceneCount, updatedAt, ... }, ...] }
```

### 2. 读取并修改剧本

```
reel:get-scenario({ scenarioId: "scn-xxxx" })
  → { scenario: { id, title, scenes: [...] } }
```

修改后整体回写：

```
reel:save-scenario({ scenario: { id: "scn-xxxx", title: "...", scenes: [...] } })
  → { ok: true, id: "scn-xxxx" }
```

### 3. 生成关键帧或视频

视频生成是**异步**的（Seedance 任务通常 30-90s）：

```
reel:generate-video({
  prompt: "雨夜，女主角撑着透明伞回头，电影感",
  referenceImages: ["uploads/ref-001.jpg"],
  duration: 5,
  resolution: "1080p",
  ratio: "16:9"
})
  → { taskId: "task_abc", status: "queued" }

# 轮询：
reel:get-video-task({ taskId: "task_abc" })
  → { status: "completed", videoUrl: "/api/video/file/task_abc", durationSec: 5 }
```

`status` 取值：`queued | generating | downloading | completed | failed | cancelled | interrupted`。

### 4. 列举素材

```
reel:list-assets({ kind: "video" })
  → { assets: [{ id, kind, filename, mimeType, bytes, meta: { ... } }, ...] }
```

## 设计约束 / 调用须知

1. **同一时刻只允许 1 份 scenario "active"**：`save-scenario` 写入会更新 `activeId`。
2. **scenarioId 必须匹配 `^[A-Za-z0-9_-]{1,64}$`**（防路径穿越）。
3. **视频任务有上限**：单次最多 9 张参考图，总参考图体积 ≤ 25MiB（image）/ 150MiB（video）。
4. **任务恢复**：进程重启时未完成的 `generating` / `downloading` 任务会自动续跑，AI 不需要手动 resume；但 `queued` 状态会被标 `interrupted`。
5. **缺 key 自动降级**：缺 ARK_API_KEY / GEMINI_API_KEY 时对应 provider 走 MockProvider，编辑器仍可离线使用。
6. **不要直接读写 `.reel-scenarios/scenarios.json`**：始终走 `save-scenario` —— 它会做 server-side per-item updatedAt 合并避免多 tab 互吞。

## 与 Reia Agent 的协作

`agent-reia` 是专门负责互动影游创作的 agent，建议作者用 `/reia` 触发她，再让她调本插件的工具。

典型职责切分：
- **Reia**：决定剧本结构、对话、QTE 节拍、分支走向（写 Scenario JSON）
- **wb-reel**（本插件）：执行落盘、生成、播放（执行 tool）
- **Iro**（美术）：必要时提供角色立绘风格 token，被 Reia 调用做关键帧

## 不做什么

- 不接管 BGM 调音 → 让 wb-bgm
- 不接管 lowpoly 3D → 让 wb-lowpoly-obj
- 不接管 narrative 长剧本（94 品类管线）→ 让 wb-narrative
- Reel Studio 专注：**短中篇 FMV 互动剧（多 endings、多 QTE、视频/图片关键帧）**
