---
name: design-scene-brief
description: >-
  Sino「设计脑」阶段——在动任何节点图之前，把用户的一句话/粗略需求（或一份精简 scene_nodes）
  自顶向下扩写成完整的场景设计意图树 scene-design-brief.json：分区 → 关键 POI → 室内/物件，
  并为每个节点补齐四关注点（游戏逻辑/白盒、叙事、布景美术、审美评审）与递归标记。
  当 Sino 被要求设计/规划/扩写一张地图、或在 compose-sino-scene 构图之前需要先定设计时使用。
  本阶段只产出设计意图（JSON 文件），不连任何 scene 电池、不生成资产。
---

# 设计脑手册（Sino · scene-design-brief）

> 这是 Sino 的**第零步**：先想清楚「设计什么」，再交给 `compose-sino-scene` 去「怎么搭」。
> 产出唯一工件 `scene-design-brief.json`（契约见 [scene-design-brief.schema.md](scene-design-brief.schema.md)），
> 它是下游白盒（keypoint 求解）/ 结构 / 布景 / 评审的 **SSOT**。
> **本阶段不调用任何 `scene:*` 电池工具、不创建/修改节点图、不收集资产**——只读需求、只写这一份 JSON。

---

## 为什么需要这一步

场景设计不是一次到位，而是「**递归细化 × 多工序反复循环**」。把「设计意图」从「构图执行」里剥出来，好处：

1. **设计先行**：先把分区、关键 POI、叙事节拍、玩法功能、装饰主张想全，构图时不再边搭边拍脑袋。
2. **四关注点显式化**：游戏逻辑（白盒）、叙事、布景美术、审美各有字段承载，下游可分别认领、分别评审。
3. **递归有据**：`expand` 标记哪些 POI 要继续展开内部（钟表店→柜台/橱柜），让递归是计划好的，不是临时起意。
4. **一图一 project**：整张地图一份 brief，下游在同一 project 的 scene tree 里把每个节点落成分支模块、自动装配。

---

## 第一步：判清输入形态

- **粗略需求**（如「西部世界地图，有城镇和郊区，城镇里有家关键的钟表店」）：你要**自顶向下扩写**出完整层级。
- **已有精简 `scene_nodes` / 上游叙事产出**：以它为骨架，**补齐**缺失的四关注点字段与 `expand` 标记，不要推翻其 `name`/`parent`/`adjacent`。
- **aw-support 派工**：若 runDir 已带上游场景 JSON，以其为准扩写；产出仍写回 runDir（见第五步）。

> 不确定题材/规模/玩法类型时，先问清楚再扩写；**禁止**凭空臆造与用户意图冲突的世界设定。

---

## 第二步：自顶向下建意图树（从大到小）

按 `type`/`scale` 分层，**先大后小**：

| 层级 | 典型 type | 典型 scale | 设计要点 |
|------|-----------|-----------|---------|
| 根 | 顶层世界 | XL | 世界基调、`style`、玩法主线与叙事主线（写进 `designNote`）。 |
| 区 | 大型/中型区域 | L/M | 把地图切成有性格的分区（城镇 vs 郊区），定 `layoutHint.inParent` 与区间 `adjacent`。 |
| 关键 POI | 建筑/小型区域 | S | 每个区的叙事/玩法锚点（钟表店、据点、遗迹），给 `gameplay.role` 与 `layoutHint.relativeTo`。 |
| 室内/物件簇 | 室内房间 | S | 仅对 `expand` 的 POI 展开；描述关键物件布置（柜台/橱柜/装备架）。 |

**连通性**：同级之间用 `adjacent` 写关系（要成环就两两双向写全），它是下游道路连通（PathConnection）的依据。

**方位**：用 `layoutHint`（`inParent` 粗放、`relativeTo{anchor,bearing,distance}` 精确）表达「城镇在中、郊区在西、钟表店在广场东」等意图；坐标真值由下游 keypoint 求解，**这里只给方位意图，不写绝对坐标**。

---

## 第三步：逐节点补齐四关注点

对每个 `location`，按需填（缺省即不特别指定）：

1. **游戏逻辑 / 白盒** → `gameplay`：`role`（spawn/hub/combat/puzzle/gate/transition/boss/safe/loot…）、`keyInteractions`、`encounter`、`gating`。先想「玩家在这里**做什么**、怎么进出、被什么卡住」。
2. **叙事** → `narrative`：`beats`（这里发生的剧情）、`reveals`（揭示的信息）、`mood`。`description.semantic` 答「是什么」，`narrative` 答「发生什么」。
3. **布景 / 环境美术 / 审美** → `dressing`：`keyProps`（关键物件清单）、`storytellingDetails`（环境叙事细节）、`density`。让空间**讲故事且好看**，避免大片空白或单调铺满。
4. **审美评审** → `acceptance`：写 1～3 条「怎样算这个节点合格」的验收要点，供后续评审打分。

> 关键 POI 必须至少有 `gameplay.role` + `dressing.keyProps`；纯过渡区可只给 `gameplay.role`。

---

## 第四步：标记递归 `expand`

- 若某 POI 的**内部**还值得单独细布（钟表店内的柜台/橱柜/挂钟墙、据点内的装备架/营地装饰），给它 `expand: { reason: "…" }`，并**补一个子 `location`**（`parent` 指向它，`type: 室内房间`）承载内部物件意图。
- `expand` 只是「计划展开」的声明；真正的内部子树由下游在**同一 project** 内更深层搭建后 merge 回来。
- 不是所有 POI 都要 expand——只标记内部确有叙事/玩法/装饰价值的。

---

## 第五步：写出 `scene-design-brief.json`

- 校验：满足 [schema](scene-design-brief.schema.md)（必填 `sceneName`/`style`/`locations`，每个 `location` 必填 `name`/`type`/`parent`）；`parent`/`adjacent` 引用的 name 都存在；root 的 `parent` 为 `null`。
- 路径：
  - aw-support 派工 → 本次 `runDir/scene-design-brief.json`（与 `keypoint-layout-solved.json` 同级）。
  - 独立对话 → `<active_game>.dir/pipeline/scene-design-brief.json`（与 `asset-requirements.json` 同级）。
- 用文件写入完成（本阶段不调 `scene:*`）。

---

## 与下游的衔接

- **白盒**：`locations` + `layoutHint` + `adjacent` 直接喂 keypoint 求解 → `keypoint-layout-solved.json`（坐标真值）。
- **构图（compose-sino-scene）**：按 brief 的层级/关系/方位选模板组连线；`gameplay`/`narrative` 指导布局取舍。
- **布景**：`dressing.keyProps`/`density` 指导装饰多遍叠加。
- **资产**：`assetHints` + `dressing.keyProps` 汇成 `asset-requirements.json` 的线索。
- **评审**：`acceptance` 是后续 sino-critic 生成 `review.json` 的打分依据。

---

## 收尾检查清单

- [ ] 自顶向下建好意图树，`type`/`scale`/`parent` 自洽，root `parent=null`
- [ ] 同级关系用 `adjacent` 写全（需成环则双向闭合）
- [ ] 方位用 `layoutHint` 表达，**未**写绝对坐标
- [ ] 关键 POI 至少有 `gameplay.role` + `dressing.keyProps`
- [ ] 需要内部细布的 POI 已标 `expand` 并补了子 `location`
- [ ] `scene-design-brief.json` 通过 schema 校验、写入正确路径
- [ ] 本阶段未调用任何 `scene:*` 工具、未生成资产
