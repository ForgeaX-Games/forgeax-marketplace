---
name: wb-game-video:author-guide
description: 视频游戏 (玩法优先) 蓝图编辑器 AI 调用指南 — GameGraph 演出节点图 / 判断折进出边 / 皮肤组件
trigger: /gamevideo
---

# 视频游戏工坊 · AI Skill

`@forgeax-plugin/wb-game-video` = **玩法优先的视频游戏**蓝图编辑器 + 运行时。

**唯一引擎 = graph 引擎**（`src/runtime/ / src/graph/ / src/editor/`）：一张 `GameScenario` 图，纯 TS 状态机直接跑。
旧 FMV 内容生产那套（`gvid:*` 工具、剧本/生图/生视频/素材库、`/__reel__` 端点）已**整体删除**，不再存在。
**硬性规则见 `AGENTS.md`。**

## 玩法图数据模型（SSOT）

```text
GameScenario                         # src/runtime/ / src/graph/ / src/editor/graph-schema.ts
├── variables{} entities{}           # 实体 = 开放数值袋 attrs（hp 只是约定 attr，无特权）
├── ui.hud[]  rng.seed  rules?[]     # HUD 元素(可指定皮肤 component/pos) / 种子随机 / 图级反应规则
└── graph { nodes[], edges[] }
     nodes[] 全是「演出节点」(type:'perf')：media(视频) + timeline[](role/kind/trigger/params) + hud
     edges[] 条件/加权/效果出边：判断(出手/血量/胜负/变招…)一律折这里，无独立网关节点
```

> [!IMPORTANT]
> **图 schema 契约（强制）**：
> - **只有「演出节点」，每个绑视频**；判断折进出边（handle `cond:N`/`else`/`opt:*`/`pass|good|fail`/`out`，边带 `weight`=加权随机）。跨节点记忆用变量+条件边。
> - **一切声明式、可序列化、无函数**：条件 `GraphCondition`、效果 `GraphEffect`（value 可为 `{expr}`）。
> - 盖在视频上的 QTE/血条/选择等 = `skins/` 下可替换组件，图里只记 `params.component` / `ui.hud[i].component`（契约见 `src/runtime/skins/components/CONTRACT.md`）。
> - 代码级权威：`src/runtime/ / src/graph/ / src/editor/graph-schema.ts`（形态）+ `engine.ts`（运行时）+ demo `src/runtime/ / src/graph/ / src/editor/demo/nodia.graph.json`（SSOT 样例）。
> - ⚠️ 旧 `Scenario/Scene → scenarioToBlueprint → 蓝图运行时`、以及 `gvid:*` 工具链已**退役删除**，勿再引用。

## 怎么编辑：AI 工具（graph-native）

AI 与工坊沟通的唯一契约 = **直接读/改 GameGraph**。只有三个瘦工具（LLM 侧工具名以 `_` 连接：`gvid_get-graph` 等）：

| tool id            | 用途                                                                 | 关键 args |
|--------------------|----------------------------------------------------------------------|-----------|
| `gvid:get-graph`   | 读当前 game 的 GameGraph（无盘数据回退内置 demo）                     | `gameSlug?` |
| `gvid:save-graph`  | 整本覆盖写 GameGraph + 压版本快照（留10）；落盘前结构校验，有 error 拒绝 | `scenario`(必填), `title?`, `gameSlug?` |
| `gvid:list-videos` | 列出内置演出视频库可用的 `media.ref`（basename）                       | — |

**标准编辑闭环**（如「把 A 节点到 B 的连线改成到 C」「加一本简单视频游戏」）：

```
gvid:get-graph({})                          # 拿现有 nodes/edges
  → 在返回的 scenario.graph 上改：加/删演出节点、改 edge.target、把判断折进出边 condition/weight…
gvid:list-videos({})                        # （需要绑视频时）看有哪些片段可用
gvid:save-graph({ scenario, title:"..." })  # 整本回写；ok:false 时看 errors 修完再存
```

`save-graph` 校验：节点 id 唯一、边 `source`/`target` 指向存在的节点。深层 kind 语义走前端 `validate.ts` / 工坊「试玩」页自检。

**人也能在工坊 UI 改**：左侧「蓝图 / 视频 / 界面 / 规则 / 试玩」五个 tab（蓝图=可编辑画布，点节点出配置；试玩=新引擎预览）。AI 与人共享同一份 GameGraph。

**持久化**：`save-graph`（AI）与工坊「保存」（人）都落盘到
`.forgeax/games/<slug>/game-video/scenarios.graph.json`（+ 版本快照留 10）；工坊里的未保存草稿走 localStorage。
进入优先级：草稿 > 最新已保存版本 > 磁盘原始 > 内置 demo。

## 校验

改完用图自带校验（`src/runtime/ / src/graph/ / src/editor/validate.ts` / `validate-refs.ts`）确认：节点/边 handle 齐全、
媒体引用存在、条件/效果引用的变量存在、皮肤 `component` 有对应注册。测试见
`src/runtime/ / src/graph/ / src/editor/__tests__/`。

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
