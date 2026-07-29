# Sino 快循环 + Rest 链接（自写 checklist · 按 batch 施工）

> Phase 0 **一次**写 checklist；Phase 1+ **只读 SSOT、按 batch 施工** — 禁止重写、禁止重想设计。  
> 规划要点见 [design-and-checklist.md](design-and-checklist.md)。

---

## Phase 0（一次）

1. 批量读 runDir 输入（**先** `keypoint-layout-estimate.json`，再 contract/scatter/catalog）+ brief 区域树（仅此一轮）
2. `write_file` → `scene-composition-checklist.json`（`_source: "sino-planned"`，含 `restFrom` / `structureParams` / footprint）
3. **立刻** M0 — 规划 turn **只写文件**

---

## Phase 1+（读清单 · 按 batch 施工）

1. **找 checklist**：派工有 `checklist: X/Y | next batch:` 则直接用；否则 `read_file` SSOT **一次**
2. **禁止重写 checklist** — 只允许更新 task `status`
3. **当前 batch**：同 `batchId` 的连续 pending → 可多组 instantiate + 一次 applyBatch + 一次 execute
4. **每 turn 只想**：选电池 · params · 连线 — 不重读 contract/picks，不长篇复盘

---

## 快循环四拍（每个 batch）

0. **对照 batch 内 tasks**：template / locationId / assets / connects
1. **落组（通道 A）**：对本 batch 每项 `instantiateTemplate`（可多个）
2. **接线（通道 B）**：一个 `applyBatch` 连完本 batch 全部 connect
3. **核对**：`pipeline.get({ groupId })` 或 `{ mode: "hash" }` — 摘要；忘了具体 `groupId` 就用 `pipeline.get({ nameContains: "关键字" })` / `{ opIdIn: [...] }` 模糊查，不用 `raw:true` 翻整图
4. **执行**：`pipeline.execute` + checklist.`narrativeLocationNames`

**禁止**在 M0 第一个 `execute` 之前：连读多个 pipeline.md、长篇文字重规划。M0 只搭底图（AddBaseGrid）先出 Preview。

**允许查文档的时机**：**仅** `applyBatch` 返回 **422** 时看 [mutation-lanes.md](mutation-lanes.md)。

---

## M0：先出 Preview

```
projects.open → pipeline.get(确认 aw_kp_* 可选)
→ empty_scene + seed_control
→ instantiateTemplate AddBaseGrid
→ AddBaseGrid.out_2 → tree_merge → tree_flatten → scene_merge_subtrees → scene_output
→ pipeline.execute → 读摘要（completed + 格数）
```

- 第一组汇总用 `AddBaseGrid.out_2`(RootScene) 接 `tree_merge`，不是 `out_1`
- `tree_merge` **建组时**必带 `{"inferredAccess":"tree","inferredType":"scene","portCount":N}`，N = 这一步已接入的主产物数（通常 M0 阶段就是 1）
- **M0 完成 = execute `status: completed` + 摘要里底图格数（如 24×24=576）**
- **M1+ 每加一个模板时**，只把该模板的 **Scene 汇总口**交给 `appendMergeItem`（见 [session_operation.md](session_operation.md)）；领域口用于细化、Rest 用于串链，二者禁止接 merge

---

## 验收方式（禁止截图弯路）

**Sino 没有可用的截图工具**（`scene:screenshot.capture` 已退役；`capture_frame` 是游戏引擎预览，与场景图无关）。

| 手段 | 能否用于 M0/M1+ 验收 |
|------|----------------------|
| `pipeline.execute` 摘要（status、outputs 格数/名） | ✅ **唯一机器验收** |
| 用户在 Studio Preview 亲眼看 | ✅ 像素级（agent 不负责） |
| `scene:renderer.setViewMode` / `renderer.info` | ❌ 调视角，读不到像素 |
| `capture_frame` | ❌ 引擎帧，不是 wb 场景图 |
| `scene:screenshot.capture` | ❌ 未注册给 AI |

**M0 播报示例**：`M0 OK · completed · 576格(24×24) · 底图=石质地砖` → **立刻** instantiate 下一组。

---

## M1+：可分步批量（允许一拍连多组，依赖处分步）

M0 出 Preview 后，**不再强制一组一 execute**。按下面的粒度推进：

**一拍可以连多组**——把**参数已经确定**的相邻几组合并成一次推进：

```
instantiateTemplate(组A) + instantiateTemplate(组B) + …
→ pipeline.get(确认各 groupId)
→ applyBatch(一次连完 A、B… 的 Rest 链 + panels)
→ pipeline.execute
→ 读摘要
→ 下一拍
```

**但必须逻辑分步**——POI 依赖 footprint、装饰 keypoint 依赖建筑、高差在道路之后、资产导入在 Mira 之后：先 execute 看真值再连下一段。

---

## Rest 是什么

**Rest = 当前模板组切走主产物之后，剩下的可继续布置的区域。**

- 下一组的 Scene 输入应接这条 **Rest**，才能**不重叠**地继续叠内容

---

## Rest 链接规则（防区域重叠）

| 场景 | 正确接法 | 错误（会重叠/空跑） |
|------|----------|---------------------|
| 第二组起布局/装饰/道路 | 上一组 **Rest** → 本组 Scene in | 两组都接 `AddBaseGrid.out_1` 全图 BaseNode |
| **AreaPartition 链式** | 上一组 **某一子区 scene** → 下一组 `in_0` | 两个 AreaPartition 都接 BaseNode |
| 子岛分区 | 父 **`IslandRegions.out_1`(Island 陆地)** → 子 `in_0` | 子岛接 `AddBaseGrid.out_1` |
| 第二栋建筑（同区） | 上一栋 **`PickOneBuilding.out_2` Rest** → 下一栋 `in_1` | 两栋都接同一 BaseNode |
| **城镇补充散布** | **每条** scatter 一条 **PickOneBuilding**；Rest 串 `out_2→in_1` | **暂禁 PickMultiBuildings** |
| 道路 | **`in_2` 同源 Rest** ← 上一组 Rest | 拍脑袋 POI / 未提门 |
| 装饰链 | 组1 Rest → 组2 `in_1` → …；有尺寸落点优先 PlaceOne；Local/Natural 只挂简单物件 | 并联 fan-out / 复杂物件丢进 Natural |

> **装饰链首组的 Scene 输入接哪里**：装饰链**第一组**的 `in_1` 接的是"进入装饰阶段前、最后一次产出可放置区域的那个节点的主产物"（通常是同层 `IslandRegions.out_1`/`AreaPartition` 某子区/`PathConnection.out_2` 等——链路里排在装饰之前的最后一个结构性 Rest 或主产物），**不是**该结构节点更早期的祖先节点、也不是随意换成 `out_0`(整树 root)。换 Scene 源前先用 `pipeline.get` 摘要确认该节点 `subtreeCellCount` 是否真的覆盖预期落点坐标，而不是靠猜"根节点数据更全"去换端口——`out_0` 只是同一份数据从根 focus 看的视图，并不会让原本为空的子树变得有 cell。若装饰模板持续空输出，先怀疑 **in_1 悬空 / 坐标落在区域外 / footprint 太大**（见 [PlaceOneDecoration.md](pipelines/PlaceOneDecoration.md) 「已验证」案例），不要在没有实测坐标覆盖范围前就切换 Scene 输入源或删组重建。

---

## 常见出口速查

| 模板组 | Scene 汇总口（唯一可 merge） | 领域细化口 | Rest（→ 下一组 Scene in） |
|--------|------------------------------|------------|---------------------------|
| AddBaseGrid | `out_2` RootScene（M0 首次建 `tree_merge` 用） | `out_1` BaseNode（仅首接） | — |
| **AreaPartition** | `out_0` Scene | `out_1` Zones | — |
| IslandRegions | `out_0` Scene | `out_1` Island | `out_2` Rest(水域) |
| PickOneBuilding | `out_0` Scene | `out_1` Building → BuildingStructures | `out_2` Rest |
| PathConnectionLink / RW | `out_0` Scene | `out_1` Path | `out_2` Rest → 下一组（**禁止** fan-out） |
| MountainContourGenerate | `out_0` Scene | `out_2` Mountain | `out_1` Rest |
| HillContourGenerate | `out_0` Scene | `out_1` Hill | `out_2` Rest |
| NaturalDecorationDistribution 等 | `out_0` Scene | `out_1` Decoration | `out_2` Rest |

> 上表所有「禁止 fan-out」的地方，`pipeline.execute` 现在会自动检测同一上游 Rest/Scene 端口并行接给 ≥2 个组、以及非根节点的局部 `tree_merge` 汇总 ≥2 份内容，命中会在 `verification.topologyIssues` 里直接抛错并给出 `suggestedOps`——不用等到自己顺着报错排查半天才发现，也不用靠这张表死记硬背。

---

## graph.json SSOT — 禁止磁盘直改

**`state/graph.json` 带 sha256 hash。** shell/python 直改文件 → hash 失步 → `projects.open` 500。

| 场景 | 正确 | 禁止 |
|------|------|------|
| 删重复边 / 修 Rest 口 | `applyBatch` + `disconnect`（`deleteEdge` 是等价别名）/ `connect` | Python 脚本改 graph.json |
| execute 验证失败 | `pipeline.get(groupId)` → applyBatch 补线 → 再 execute | `pipeline.import({})` 或 import 刷盘 |
| 整图替换（极少） | `pipeline.import` + `file: { path: "templates/下文件名.json" }` | `file` 传字符串路径；指向 `state/graph.json` |
| 项目「打不开」 | 报告 orchestrator 修 hash / restart backend | `projects.remove` 删项目 |

详见 aw-support 注入的 **graph SSOT** 段 · lesson `memory/lessons.md` §2026-07-02。

---

## 与 session_operation 的关系

- op schema、instantiateTemplate、execute 摘要：见 [session_operation.md](session_operation.md)
- 各组端口细节：422 时才读 [pipelines/](pipelines/) 下对应 `<Name>.md`
