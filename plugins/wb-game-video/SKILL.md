---
name: wb-game-video:author-guide
description: 视频游戏 (玩法优先) 编辑器 AI 调用指南 — 蓝图 / 玩法 / 剧本 / 媒体 / Seedance 视频任务
trigger: /gamevideo
---

# 视频游戏工坊 · AI Skill

`@forgeax-plugin/wb-game-video` 是一个**玩法优先的视频游戏**编辑器与运行时（fork 自影游工坊 wb-reel）。
作者用它把「玩法结构（Boss 战 / 血条 / QTE 闯关 / 限时·暂停选择 / 可点画面热点）+ 视频/真人画面 +
分支」拼装成可序列化的 `Scenario` JSON，运行时按 `elapsedMs` 确定性回放、按状态机推进玩法。

定位：**玩法驱动**的视频游戏（视频/真人画面上叠 Boss 战、血条、QTE 闯关、操作挑战）——区别于
纯叙事向的互动影片/FMV（那是 Reia 的 wb-reel 的活）。

## 数据模型（先看这个）

```text
Scenario
├── entities[]       玩家 / Boss / 敌方（EntitySpec: id/name/kind/maxHp/portraitMediaId）
└── Scene[]
     ├── kind         story | battle | qte | choice （状态机内层场景类别）
     ├── media        { kind: VIDEO | IMAGE_PROMPT | IMAGE_STATIC | PLACEHOLDER, ... }
     ├── boss?        BossSpec（entityId / rounds[] / win|loseSceneId / perfectFlagVarId）
     ├── hotspots?    可点画面热点（call-return / 触发分支）
     ├── dialogue[]   台词 + TTS 配置
     ├── qte?         QTE 序列（perfect:80 / great:160 / good:280 ms 评分；可连段 sequence + timeoutMs）
     ├── branches[]   跳转 / 结局分支
     └── ext?         通用扩展属性位 Record<string, unknown>（见下）
```

> [!IMPORTANT]
> **蓝图 schema 契约（强制）**：你写的是 `Scenario`，但它会被 `scenarioToBlueprint`
> 编译成 `GameVideoBlueprintGraph`——那张蓝图是**蓝图编辑器渲染 + 试玩运行时执行的唯一 SSOT**。
> 所以**可运行玩法必须用「能编译进蓝图」的 typed 字段**（`kind`/`boss`/`qte`/`decision`/
> `hotspots`/`branches`/`clipId`/`mediaPlayMode`/`hudPreset`/`transition`/`performance`/
> `onEnter*`/`entryGate`/`returnsToCaller` …）。塞进 `ext`/自造字段的玩法**编译器不读、运行时不跑**。
> 完整字段映射见 Nodia persona（`plugins/agent-nodia/persona/zh.md` §蓝图 schema 契约）；
> 代码级权威在 `src/blueprint/blueprint-schema.ts` + `src/blueprint/scenarioToBlueprint.ts`。

- **编辑期** `mode='editor'`：作者拼装 100% 可序列化的 Scenario JSON。
- **运行期** `mode='player'`：纯函数 `QTEEngine` 负责评分，UI 按 `elapsedMs` 推进，状态机驱动 Boss/血条/热点。
- **媒体三态**：上传视频 · GPT-Image-2 占位图 · 静态图 · 渐变兜底。
- **玩法字段全可选**：缺省即退化为纯影游，不破坏旧本——蓝图与剧情树**共用同一份 Scenario**(SSOT)。
- **`ext` 扩展位（按规则自定义，不写死 schema）**：作者要的自定义玩法维度——
  「界面方案 / 阶段标签 / 自定义数值 / 任意作者约定」——一律写进 `Scene.ext`
  （剧本级写 `Scenario.ext`），**不要新造 typed 字段**。typed 一等字段
  （kind/boss/decision/hotspots/qte…）始终优先；`ext` 只承载尚未一等化的维度。
  键 = 属性名（作者可读中文亦可），值 = 标量 / 数组 / 对象（JSON 可序列化）。
  蓝图节点点开右侧「玩法字段 → 扩展属性」即可见、可编辑；运行时不直接消费 ext。
  经 `gvid:save-scenario` 整文档写回即持久化。

## Tool 列表

| tool id              | 用途                              | 关键 args |
|----------------------|-----------------------------------|-----------|
| `gvid:list-scenarios`  | 列出所有本机剧本                  | `limit?`, `offset?` |
| `gvid:get-scenario`    | 读取指定剧本完整 JSON             | `scenarioId`(必填) |
| `gvid:lint-scenario`   | 结构机械质检（分支/玩法/媒体）    | `scenarioId?`（省略=active） |
| `gvid:save-scenario`   | 新建 / 覆盖剧本                   | `scenario`(完整对象) |
| `gvid:list-assets`     | 列出 `.gamevideo-assets/` 媒体库  | `kind?`(image/video), `scenarioId?` |
| `gvid:generate-video`  | 提交 Seedance 异步视频任务        | `prompt`(必填), `referenceImages?`, `duration?`, `resolution?`, `ratio?` |
| `gvid:get-video-task`  | 查询 Seedance 任务状态            | `taskId`(必填) |
| `gvid:generate-visuals`| 提取视觉锚点(场景/道具)并出图：角色定妆照+场景基准图(多角度)+关键道具图（非破坏性，不碰分镜） | `scope?`('anchors'), `scenarioId?`, `force?` |
| `gvid:generate-auditions`| 给角色生成「试镜视频+音色」：定妆照→Seedance ~10s/3:4 试镜视频→抽整段音轨为 MP3 绑为角色音色 | `scope?`('all'/'characters'), `characterIds?`, `scenarioId?`, `force?` |

> 此外还有 `gvid:generate-storyboard`（拆分镜）、`gvid:generate-keyframes`（逐镜关键帧）、
> `gvid:produce-node`（一键产出节点：拆镜→关键帧→出片）、`gvid:forge-script`（提交想法走锻造管线）、
> `gvid:import-from-narrative`（从 wb-narrative 导入）、`gvid:get-script-meta` / `gvid:update-outline` /
> `gvid:update-relations`（增量改大纲/人物关系）——详见 manifest 的 `tools[].description`。

### `gvid:generate-visuals` —— 剧本→视觉锚点

剧本打磨好后调用一次，对**当前 active 剧本**做两步（均不新建/替换剧本、不生成分镜关键帧）：

1. **提取锚点**：若 `locations` / `props` 为空，自动从剧本蒸馏出场景与关键道具（复用 forge 同款提示词模板）。
2. **锚点出图**：生成角色定妆照(三视图) + 场景基准图(主图+多角度) + 关键道具图，写回各自 refImageId。

默认幂等（已有参考图的实体跳过）；`force:true` 全量重生。进度在 forge 对话区可见；该管线跑在浏览器，调用时工坊需保持打开。

### `gvid:generate-auditions` —— 角色→试镜视频+音色

**前置**：角色必须先有定妆照（`gvid:generate-visuals`）。以每个角色的定妆照为参考：

1. **试镜视频**：用 Seedance 2.0 图生视频生成一段 ~10s / 3:4 的单人胸像「试镜视频」（角色用本人口吻念一句台词，台词按角色性格各自生成）。定妆照网格会优先展示这段视频。
2. **音色提取**：把视频整段音轨抽成 MP3，绑为该角色的「音色样本」（`voiceSampleMediaId`）。后续生成该角色镜头视频时，自动用这段音色作 Seedance `reference_audio`，保证全剧嗓音一致。

参数：`scope='all'`（默认，给全部有定妆照的角色；缺失才生成）；`scope='characters'` + `characterIds:[...]` 只做指定角色；`force:true` 覆盖重生已有试镜视频。无定妆照的角色会被跳过并在对话里提示。该管线跑在浏览器（Seedance 凭据 + 抽音轨用 AudioContext），调用时工坊需保持打开。

**何时调**：用户说「生成试镜视频 / 角色试镜 / 角色音色 / 给角色配音色 / 定妆照视频」，或在视觉锚点（定妆照）出齐后想为角色补音色时。建议顺序：`forge-script` → `generate-visuals`（出定妆照）→ **`generate-auditions`**（出试镜视频+音色）→ `generate-storyboard` → `generate-keyframes` → `generate-video`（角色镜头会自动带上音色）。

## 「重新生成」= 传 `force=true`（清理旧内容）

作者说「**重新生成 / 重做 / 重拆 / 重拍 / 重出 / 再来一次**」某个已有内容的节点时，调
`gvid:produce-node` / `gvid:generate-storyboard` **必须**带 `force=true`。否则管线**幂等跳过**
已完成的阶段，旧分镜/旧视频不被清理，新旧叠加→**重复镜头**。`force` 用新内容替换时间轴
旧镜头；**旧视频/关键帧不会删除**，会归档进素材库（按镜头归历史版本）可随时拿回采用。
工坊在替换前会弹确认框，不会偷偷删东西。

## 调用流程

### 1. 浏览作者已建剧本

```
gvid:list-scenarios({})
  → { scenarios: [{ id, title, sceneCount, updatedAt, ... }, ...] }
```

### 2. 读取并修改剧本

```
gvid:get-scenario({ scenarioId: "scn-xxxx" })
  → { scenario: { id, title, scenes: [...] } }
```

修改后整体回写：

```
gvid:save-scenario({ scenario: { id: "scn-xxxx", title: "...", scenes: [...] } })
  → { ok: true, id: "scn-xxxx" }
```

### 3. 生成关键帧或视频

视频生成是**异步**的（Seedance 任务通常 30-90s）：

```
gvid:generate-video({
  prompt: "雨夜屋顶，玩家与持刀 Boss 对峙，电影感运镜",
  referenceImages: ["uploads/ref-001.jpg"],
  duration: 5,
  resolution: "1080p",
  ratio: "16:9"
})
  → { taskId: "task_abc", status: "queued" }

# 轮询：
gvid:get-video-task({ taskId: "task_abc" })
  → { status: "completed", videoUrl: "/api/video/file/task_abc", durationSec: 5 }
```

`status` 取值：`queued | generating | downloading | completed | failed | cancelled | interrupted`。

### 4. 列举素材

```
gvid:list-assets({ kind: "video" })
  → { assets: [{ id, kind, filename, mimeType, bytes, meta: { ... } }, ...] }
```

## 设计约束 / 调用须知

1. **同一时刻只允许 1 份 scenario "active"**：`save-scenario` 写入会更新 `activeId`。
2. **scenarioId 必须匹配 `^[A-Za-z0-9_-]{1,64}$`**（防路径穿越）。
3. **视频任务有上限**：单次最多 9 张参考图，总参考图体积 ≤ 25MiB（image）/ 150MiB（video）。
4. **任务恢复**：进程重启时未完成的 `generating` / `downloading` 任务会自动续跑，AI 不需要手动 resume；但 `queued` 状态会被标 `interrupted`。
5. **缺 key 自动降级**：缺 ARK_API_KEY / GEMINI_API_KEY 时对应 provider 走 MockProvider，编辑器仍可离线使用。
6. **不要直接读写 `.gamevideo-scenarios/scenarios.json`**：始终走 `save-scenario` —— 它会做 server-side per-item updatedAt 合并避免多 tab 互吞。
7. **交付前跑质检**：里程碑产出或 `save-scenario` 后调 `gvid:lint-scenario`；有 `error` 先修再告诉作者可试玩（工坊「模块 › 质检」面板同步展示）。

## 与 Nodia Agent 的协作

`agent-nodia` 是专门负责**玩法优先视频游戏**创作的导演 agent，建议作者用 `/nodia` 触发她，再让她调本插件的工具。

典型职责切分：
- **Nodia**：决定玩法结构（蓝图：状态机 / 实体 / Boss / 热点 / QTE 节拍）、剧本、分支走向（写 Scenario JSON）
- **wb-game-video**（本插件）：执行落盘、生成、播放（执行 tool）
- **Iro**（美术）：必要时提供角色立绘风格 token，被 Nodia 调用做关键帧

## 不做什么

- 不接管纯叙事互动影片 / FMV（无玩法、重剧情）→ 让 Reia（wb-reel）
- 不接管 BGM 调音 → 让 wb-bgm
- 不接管 lowpoly 3D → 让 wb-lowpoly-obj
- 不接管 narrative 长剧本（94 品类管线）→ 让 wb-narrative
- 不接管引擎实时渲染的 3D/2D 玩法（ECS、物理、自由操控）→ 走常规做游戏流水线
- 视频游戏工坊专注：**玩法优先的视频游戏（Boss 战 / 血条 / QTE 闯关 / 限时·暂停选择 / 可点热点 + 视频分支）**
