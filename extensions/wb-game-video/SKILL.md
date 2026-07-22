---
name: wb-game-video:author-guide
description: 视频游戏 (玩法优先) 蓝图编辑器 AI 调用指南 — GameGraph 演出节点图 / 判断折进出边 / 皮肤组件
trigger: /gamevideo
---

# 视频游戏工坊 · AI Skill

`@forgeax-extension/wb-game-video` = **玩法优先的视频游戏**蓝图编辑器 + 运行时。

**唯一引擎 = graph 引擎**（`src/runtime/ / src/graph/ / src/editor/`）：一张 `GameScenario` 图，纯 TS 状态机直接跑。
旧 FMV 内容生产那套（`gvid:*` 工具、剧本/生图/生视频/素材库、`/__reel__` 端点）已**整体删除**，不再存在。
**硬性规则见 `AGENTS.md`。**

## 玩法图数据模型（SSOT）

落盘/传输类型 = **`GraphLibraryDocument`**（原 `GameScenario` + `manifest`）。端点 JSON 字段名仍可叫 `project`。

```text
GraphLibraryDocument                 # src/runtime/schema/graph-schema.ts
├── variables{} entities{}           # 全 game 共享
├── ui.overlays{}
├── graph { nodes[], edges[] }       # 运行开跑入口 = 主蓝图镜像
└── manifest
     ├── mainPackId                  # 入口标记（只住这里，根上不再镜像）
     └── packs{ id → BlueprintDoc }  # 含 main + 全部子蓝图（编辑库 SSOT；对齐 subFlowPack）
```

> [!IMPORTANT]
> **契约（强制）**：
> - **开跑**用根 `graph`；执行中遇 `subFlowPack` → 查 `manifest.packs`（无根级 `packs` 数组）。
> - 改子蓝图：改 `manifest.packs[id].graph`，保存前用规范化保证根 `graph` ↔ main 同步。
> - **只有「演出节点」**；判断折进出边。三层：edges=路由；节点/挂载 reactions=副作用；overlays=UI。无局级 reactions。
> - 蓝图库设计 SSOT：`docs/superpowers/specs/2026-07-21-blueprint-library-folder-management.md`。
> - 代码权威：`graph-schema.ts` + `blueprint-project.ts` + `engine.ts` + demo `nodia.graph.json`。

## 怎么编辑：AI 工具（graph-native）

AI 与工坊沟通 = **读写整份库文档**（`project`）。核心工具（LLM 侧工具名以 `_` 连接）：

| tool id            | 用途 | 关键 args |
|--------------------|------|-----------|
| `gvid:get-graph`   | 读当前 game 的库文档（无盘 → `{ project: null }`，前端回落 demo） | `gameSlug?` |
| `gvid:save-graph`  | 整本覆盖写 `scenarios.graph.json` + 版本快照（留10） | `project`(必填), `title?`, `gameSlug?` |
| `gvid:list-videos` | 列出内置演出视频库可用的 `media.ref` | — |

**标准编辑闭环**：

```
gvid:get-graph({})
  → 改 project.graph 和/或 project.manifest.packs[*].graph
gvid:save-graph({ project, title:"..." })
```

**人也能在工坊 UI 改**：左侧「蓝图 / 视频 / 界面 / 规则 / 试玩」。蓝图 tab = 库列表 + 画布。

**持久化**：单文件 `.forgeax/games/<slug>/game-video/scenarios.graph.json`（无 `blueprints/` 文件夹）。
进入优先级：草稿 > 磁盘最新 > 内置 demo。

## 校验

改完用图自带校验（`src/runtime/validate/validate.ts` / `validate-refs.ts`）确认：节点/边 handle 齐全、
媒体引用存在、条件/效果引用的变量存在、皮肤 `component` 有对应注册。测试见
`src/runtime/__tests__/` / `src/graph/__tests__/`。

## 与 Nodia Agent 的协作

`agent-nodia` 是专门负责**玩法优先视频游戏**创作的导演 agent，建议作者用 `/nodia` 触发她。

典型职责切分：
- **Nodia**：决定玩法结构（演出节点编排 / 实体 / Boss / 热点 / QTE 节拍 / 条件分支），产出 GameGraph 数据。
- **wb-game-video**（本插件）：提供蓝图编辑 / 试玩运行时 / 落盘。

## 不做什么

- 不接管纯叙事互动影片 / FMV（无玩法、重剧情）→ 让 wb-reel。
- 不接管 BGM 调音 → 让 wb-bgm。
- 不接管 lowpoly 3D → 让 wb-lowpoly-obj。
- 不接管 narrative 长剧本管线 → 让 wb-narrative。
- 不接管引擎实时渲染的 3D/2D 玩法（ECS、物理、自由操控）→ 走常规做游戏流水线。
- 视频游戏工坊专注：**玩法优先的视频游戏（Boss 战 / 血条 / QTE 闯关 / 限时·暂停选择 / 可点热点 + 视频分支）**。
