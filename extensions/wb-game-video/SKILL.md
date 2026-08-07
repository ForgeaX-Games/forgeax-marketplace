---
name: wb-game-video:author-guide
description: 视频游戏（玩法优先）蓝图编辑、素材生成与运行时调用指南
trigger: /wb-game-video
---

# 视频游戏工坊 · AI Skill

`@forgeax-extension/wb-game-video` 编辑和运行 `GraphLibraryDocument`。根 `graph` 是运行入口，`manifest.mainPackId` 指向主蓝图，`manifest.packs` 保存主/子蓝图。修改后应通过 `src/runtime/validate/validate.ts` 校验。

## 工具

| tool id | 用途 |
|---|---|
| `wb-game-video:get-graph` | 读取当前游戏的完整蓝图；无文件时返回 `project: null` |
| `wb-game-video:save-graph` | 仅供编辑器 UI 覆盖写入 `blueprint.json`；不向 AI 暴露 |
| `wb-game-video:patch-graph` | AI 增量改图；顺序应用 `ops`，失败时整批不写盘 |
| `wb-game-video:list-videos` | 列出扩展内置视频的 `media.ref` |
| `wb-game-video:generate-shot-script` | 为节点生成镜头脚本文本 |
| `wb-game-video:generate-keyframe` | 生成关键帧或分镜图并登记素材 |
| `wb-game-video:generate-video` | 生成不超过 15 秒的单段视频 |
| `wb-game-video:generate-video-clip` | 直接生成不绑定节点的视频素材 |
| `wb-game-video:generate-node-video` | 为长节点拆段并连续生成视频 |
| `wb-game-video:list-assets` | 按类型、生产方式或节点查询共享素材 |
| `wb-game-video:get-asset` | 查询一条素材的状态、文件或错误 |
| `wb-game-video:import-character-refs` | 只读导入角色参考图 |
| `wb-game-video:import-scene-refs` | 只读导入场景参考图 |

## 编辑闭环

```text
wb-game-video:get-graph({})
  → 根据现有节点、边和蓝图 id 构造增量 ops
  → wb-game-video:patch-graph({ blueprintId?, ops })
```

如果 `get-graph` 返回 `project: null`，说明 Host 尚未初始化 empty library seed。向编排层报错并停止——你无法 `save-graph`，不得编造整本 `GraphLibraryDocument` 或 Write/Edit `blueprint.json`。正常 Pass A 前提是盘上已有 Host empty seed（单 `entry` 节点）。Nodia demo 只用于用户显式重置。
AI 改图只使用 `patch-graph`，不要拼接整本 `project` 调用 `save-graph`。游戏身份始终来自宿主绑定；
所有 12 个 AI 工具都不接受 `gameSlug` 或其它游戏选择参数。

## Bootstrap · 最小可玩（Pass A）

新游戏 Host 初始化后的盘面是**空壳**：主包 `bp-main`、唯一 `perf` 节点 `entry`、无边、无 Nodia demo。
AI **不得**假设存在 demo 节点；**不得**用 `save-graph`；只用：

```text
get-graph →（可选 Load 本 Skill）→ 多批 patch-graph → get-graph 自检
```

### Pass A 过关线

1. 从 `entry` 到结局的主路径连通
2. ≥1 个抉择点：≥2 条选项出边（不同 `sourceHandle`，如 `opt_a` / `opt_b`），下游合流或分结局
3. 主路径每个叙事节点 `data.storyText` 非空（字段名是 **storyText**，不是 scriptText）
4. 本轮不做战斗子图 / 探索枢纽 / 成片生成

### 拓扑草图

```text
entry → beat_1 → choice → path_a → merge → ending
                       ↘ path_b ↗
```

### 推荐 ops（示意）

1. `set-node-data` 写 `entry.storyText`
2. `add-node` 增加 `type:"perf"` 节点，`data: { name, storyText }`
3. `connect`：线性边用 `sourceHandle:"default"`；抉择边用 `opt_a` / `opt_b`
4. 一批失败整批不写盘 → 读 `errors` / `failedOpIndex` 后重试

可点击的 choice overlay（`ensure-node-overlay` / `add-overlay-child`）**不是** Pass A 硬门槛；拓扑选项边 + `storyText` 写清选项即可。需要可玩 UI 时再补 overlay（Pass B / 后续任务）。

## 视频生产闭环

```text
import-character-refs + import-scene-refs
  → generate-shot-script
  → generate-keyframe
  → generate-video 或 generate-node-video
  → 把返回的 asset.id 绑定到节点 media.ref
```

素材写入宿主绑定工作区的逻辑目录 `assets/`。蓝图写入 `blueprint.json`，首次保存补
`project.json`；物理目录布局由宿主决定。

本扩展不替代纯叙事影片、BGM、低模 3D 或 ECS 游戏工具；它专注于视频承载的玩法交互。

## 宿主契约

发布时需要 `@forgeax/extension-platform@0.0.2` 与
`/workbench-host.2.3`。宿主加载 `@forgeax-extension/wb-game-video/host` 的 `host`
导出，并注入游戏工作区、版本、媒体、模型、视频生成与服务 capability。所有工具和扩展 HTTP 路由共享同一
`WorkbenchExtensionContext`；不支持根据 URL、进程环境、全局 active game 或工具参数选择游戏。
浏览器必须等待 nonce-bound handshake，并只使用 handshake 返回的游戏身份和端点。版本与游戏
组件是可选 capability；缺失时不得猜测或拼接备用 URL。
