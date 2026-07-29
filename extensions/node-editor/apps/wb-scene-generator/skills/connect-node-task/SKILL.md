---
name: connect-node-task
description: >-
  sino-constructor 专用：aw-support 逐节点派单时，把**单个节点单个任务**在 wb-scene-generator 里接线落地的操作手册。
  当 aw-support 派发来一份 ConstructionTaskSpec（含坐标、子节点、模板候选白名单）时使用。
  不做长任务规划、不读 checklist/keypoint 历史。
---

# 单节点任务接线手册（sino-constructor）

> aw-support 已在任务书里给齐坐标、子节点清单与模板候选。**直接用，不要重新规划。**

## 效率：少空转、续作接着干

`sino-constructor` 单轮预算约 **500 turn**（够做完多数容器任务）。仍不要浪费在读大文件/反复核对上：
- 端口语义**先看 `instantiateTemplate` 返回的 `exposedInputs`/`exposedOutputs` 里每个端口自带的 `label`**（如 `IslandName`/`Rest`/`Scene`）——这是模板作者标注的语义名，多数情况下不需要再翻文档。只有 `label` 缺失、或需要接线配方/防呆点/数值参考时，才查「模板端口文档速查」的 `pipelines/*.md`（30~120 行）。**不要**读原始 battery JSON、**不要** glob/grep `batteries/` 目录、**不要**对同一个 groupId 反复 `pipeline.get`（一次 `summarized` 通常够用，改完再查一次即可）。
- 能合并进同一次 `applyBatch`/`instantiateTemplate` 调用的操作尽量合并，减少往返。
- 消息标题带**「· 续作（同 session 接着干）」** = **同一条会话接着上一段工具进度做**，不是新任务：一次轻量 `pipeline.get` 只核对断点 → 接着接线/execute/写报告。禁止重新 open、禁止重读完整任务书、禁止重新选型/重规划、禁止重复 `instantiateTemplate` 已存在的组。

## ⚠️ 起点锚点 —— 全程最重要的一条纪律

**根节点基建（`AddBaseGrid` + `tree_merge(aw_m0_merge)` + flatten + merge + output）已经由 aw-support 提前搭好，且全场景只有一份。**

每份任务书都会给出一个 `sceneAnchor: { nodeId, port, label }`，代表你这次任务**唯一合法的 Scene 输入来源**——可能是根节点的 `AddBaseGrid` 出口（第一个任务），也可能是上一个任务在某个 IslandRegions/PickOneBuilding 分组上产出的某个具体子岛/建筑口（后续任务）。

- **禁止** `createNode` `empty_scene`——不需要新场景源，任务书给的锚点就是你的 Scene 输入。
- **禁止** `instantiateTemplate` `AddBaseGrid`——根节点基建全场景只建一次，已经存在。
- 开工先 `pipeline.get` 确认 `sceneAnchor.nodeId` 存在、`sceneAnchor.port` 未被占用，再把它接到你要用的模板组的 Scene 输入口（视模板而定，通常是 `in_0`/`in_1`/`in_2` 中的某一个——优先直接用 `{ "label": "Scene" }` 寻址，不用先查表心算成具体的 `in_N`）。
- 如果任务书没给出 `sceneAnchor`（说明上游任务还没交出锚点），**不要**自己发挥创建场景源——回报 aw-support，让它先核验/重派上游任务。

## 双通道纪律

| 通道 | 工具 | 用途 |
|------|------|------|
| **A** | `scene:pipeline.instantiateTemplate` | 落地整组模板电池（IslandRegions/建筑/道路/装饰…）——**不含 AddBaseGrid** |
| **B** | `scene:pipeline.applyBatch` | **仅** connect + 工具电池（text_panel、number_const、tree_merge、manual_points…）——**不含 empty_scene** |

- **禁止** `scene:templates.get` 预读组内 JSON — 端口序号**和语义**都以 `instantiateTemplate` 返回的 `exposedInputs`/`exposedOutputs` 为准：每一项形如 `{ portName: "in_3", portType: "string", label: "IslandName" }`，`label` 就是这个口的语义名，模板作者标注、不是猜的。
- **禁止挖组内**：`instantiateTemplate` 之后**不要**为接线去查组内 `scene_focus_path` / `manual_points` / 核心算子的节点 id——那些是模板私有实现，summarized/raw/`opIdIn`/`graph.json` grep 都找不到或不该找。接线**只连组壳暴露口**（`{ label:"Point"|"Scene"|"Rest"|… }`）。需要 Point/名字/宽高时，在**组外** `createNode` `manual_points`/`text_panel`/`number_const`，再 `connect` 到该组对应 `in_*`。
- **端口语义（哪个 in_N 是什么参数）严禁自己读原始 battery JSON 反推**——不准 `read_file`/`glob`/`grep` 任何 `batteries/**` 路径下的 `.json`/`README.md`。这些文件又大又容易读错（历史上已经因为这样把 `IslandRegions.out_2`(Rest) 当成主产物接错过——现在这种情况 `out_2` 的 `label` 会直接显示 `"Rest"`，`out_1` 显示 `"Island"`，一眼能分清）。**语义的一手来源是返回值里的 `label`**；如果某个口没有 `label`（模板作者没标，多是内部/高级口）、或你需要接线配方、防呆点、数值参考，才查下面「模板端口文档速查」链接的 `pipelines/*.md`——每份只有 30~120 行，已给出验证过的端口映射、可照抄的 applyBatch 片段、防呆点，直接照着抄。
- **禁止** 在 applyBatch 顶层 createNode 模板组内的算子（`alg_*`/`rect_grid` 等）。

### ⚡ 2026-07-15 新增：`connect` 直接按 `label` 寻址，不用自己心算 in_N/out_N

拿到 `label` 之后**不需要再对照回 `portName` 才拼 `connect`**——`applyBatch` 的 `connect` op 的 `source.port`/`target.port` 可以直接写 `{ "label": "Island" }`，aw-support 自动施工任务书会给出 `{ "label": "Island", "portName": "out_1" }` 联合引用（必须一致，否则 applyBatch 拒绝）。后端会去查该节点当前的 `exposedInputs`/`exposedOutputs`，自动解出真正的 `in_N`/`out_N`：

```json
{ "type": "connect", "edgeId": "e_island_to_scene", "source": { "nodeId": "g_island", "port": { "label": "Island" } }, "target": { "nodeId": "g_next", "port": { "label": "Scene" } } }
```

`label` 打错字/该组没这个口时，会显式报错并列出这个组**当前全部**可用 label（不是文档里可能过时的清单），照着报错改一次名字重试即可，不用去读文档或猜编号。

## 四拍验证节拍（每个任务必做）

```
instantiateTemplate(A) → applyBatch 连线(B) → pipeline.get 核对 → execute → 读 verification
```

- `applyBatch` 必带 `opts.actor:"ai:sino-constructor"`。
- `connect` 的 `source.port`/`target.port` 优先写 `{ "label": "..." }`（见上面「2026-07-15 新增」）；`edgeId` 字段名固定（不是 `id`），但**可选**——不写会自动生成，写了必须全图唯一。
- `execute` 返回 `completed` ≠ 每组都成功 — 必看 `verification.hints` 和 `verification.topologyIssues`（2026-07-15 新增，见下文「execute 报错怎么排查」）。
- 忘了某个模板组的 `groupId`、只记得个大概名字？`pipeline.get({ nameContains: "关键字" })` 或 `pipeline.get({ opIdIn: ["tree_merge"] })` 直接模糊查（2026-07-15 新增），不用整图 `raw:true` 肉眼翻找。

### execute 报错/校验不过怎么办 —— 修一处、重跑，不要停手

- `verification.hints` / `locationNameAlignment.missing[].reason` 会**直接告诉你哪个端口该接什么**（例如"地点名找不到 → 用 BaseName/IslandName/... 端口喂入"）。照着提示补一条 `connect` 或改一个参数，再 `execute` 一次——**这通常只需要 1~2 次 applyBatch，不需要重新规划整个任务**。
- 只有下面这两种情况才停下回报 aw-support，其余一律自己修完再 execute：
  1. `sceneAnchor` 给出的端口已被占用（结构性冲突，你改不了）；
  2. 报错指向的模板不在任务书白名单里（说明候选给错了）。
- **禁止**一次 execute 报错就直接收尾/写总结走人——报错说明活没干完，不是任务结束。

## 坐标方位约定

- 原点 `(0,0)` 在左上角；**右 = 东 = +x，下 = 南 = +y**。
- 任务书给的 `gridPosition` 直接使用，经 `manual_points` 或 `number_const` 喂入模板。

### ⚠️ `manual_points` 的 x/y 不填会静默变成 (0,0)，execute 不会报错

`manual_points` 这颗电池的 `x`/`y` 输入**各自默认值都是 0**——如果 `createNode` 时忘了在 `params` 里显式写 `x`/`y`（或者写漏了其中一个），它不会报错、不会悬空报警，就是**悄悄**产出 `(0,0)`，模板会把内容摆到画布左上角原点，而不是任务书给的位置。这是真实翻车过的坑：任务书明明给了 `gridPosition: {x:57,y:57}`，图里最终的 `manual_points` 节点 `params` 却是空对象 `{}`，`execute` 依然报 `completed`/`verification.ok:true`——因为对电池来说这是完全合法的输入，只是坐标错了。

**防呆做法**：
1. `createNode` 一个 `manual_points` 节点时，`params` 必须显式带 `{ "x": <gridPosition.x>, "y": <gridPosition.y> }`，直接抄任务书对应子节点的 `gridPosition`，不要留空等走默认值。
2. 接完线后的 `pipeline.get({ raw: true })` 核对时，顺手看一眼这个 `manual_points` 节点的 `params`，确认不是 `{}`、也不是意外的 `{x:0,y:0}`。
3. aw-support 的「检查并下一步」现在会自动核验：只要任务书里有非零 `gridPosition`，但图里连了线的 `manual_points` 节点 `x`/`y` 都是 0，会直接在 `verification.reasons` 里点出节点 id——看到这类报错，直接 `updateNode` 把 `params.x`/`params.y` 改成任务书给的坐标，不用怀疑是端口接错。

### ⚠️ 尺寸/半径类参数不要抄模板文档的示例值，要用任务书算好的数字

某些模板存在"绝对尺寸/半径"语义的输入口（例如 `IslandRegions.in_2` IslandSizes——各岛膨胀半径）。这类端口对应的 `pipelines/*.md` 文档里通常会给一个**通用套餐参考区间**（比如"小岛 6~9、大岛 12~18"）——那只是给你一个"数量级感觉"的illustration，**不是**本任务的真实场地尺度。真实翻车过：任务书子节点算出来的 `radiusMeters` 是 35（一个"大型区域"容器的真实半径），agent 没有把这个数直接抄过去，而是照着文档示例区间随手填了个 `10`，导致岛屿区域比设计尺寸小了 3 倍多，`execute` 依然 `completed`（对电池来说 10 是完全合法的输入）。

**防呆做法**：任务书 dispatch 消息如果带了「尺寸/半径类参数必须用下面算好的值」这一节，**直接抄那节给出的整数**（`radiusMeters` 四舍五入），不要因为这个数字看起来比文档示例区间大很多就自己打折抄一个文档区间内的小数字——任务书给的是这次任务的真实计算值，文档区间只是教你怎么用这个口，不代表取值范围。

## Rest 串链纪律 —— 一个任务里有多个模板时怎么接

**核心原则：「上游空间」在任务内部按 Rest 链**串行**穿过每一个模板；每个模板只有 **Scene 汇总口**可独立接入 `aw_m0_merge`（不要拿领域产物口或 Rest 口接 merge，也不要建局部 `tree_merge`）。**

- 第 1 个模板组吃掉任务书给的 `sceneAnchor`；它产出「内容」（Island/Building/Path/Decoration…主产物）+「Rest」（剩余可用空间）。
- 第 2 个模板组的 Scene 输入**直接**接第 1 个组壳的 **`{ label:"Rest" }` 出口**（通常 `out_2`）→ 本组 `{ label:"Scene" }`（PickOne/PlaceOne 多为 `in_1`）。**不要**在中间再插一层组外/组内 `scene_focus_path`——Rest 口已经是可消费的 Scene 子树。
- 以此类推——**同一个 Rest 只能被下一个模板消费一次**，不能同时接给两个平行模板（fan-out 禁止），也不能回头再接给前面已经用过的 Rest。
- 每个模板的 **Scene 汇总口**（`{ label:"Scene", portName:"out_N" }`）各自做一次 `appendMergeItem`（见下节）。Island/Building/Path/Decoration/Rooms/Zones 等领域口用于细化，Rest 口用于串链，二者都禁止接 merge。
- `BuildingStructures.in_0` 只接 Building（`PickOneBuilding.out_1`），**不接 Rest**——它是建筑内构，不参与外部 Rest 链。
- 本任务做完，若还有子节点需要**后续任务**接续施工（任务书 `requiredChildAnchors` 列出的 id），必须在施工报告里给出它们各自的产出锚点（见下文「收尾必做」），下一个任务会直接拿这个锚点续接——**不会**重新扫描全图猜测。

### ❌ 真实翻车案例——5 个模板全部从同一个端口扇出

有一次任务要接 5 个模板（1 结构 + 4 装饰），实际连线连成了这样，**execute 报 `merge_output has no output`，agent 在参数上转了几十个 turn 都没找到真正原因**：

> **真实生产记录**：场景 `scene-fa20e6d5-qrh7et` 的 `001-京畿南境驿道-report.json` 就记了这一类真实修复——「非法局部 merge(`tm_deco_all`) 已删除并修复为各模板各自独立接入 `aw_m0_merge`(`item_3~11`)」，涉及 `IslandRegions` 子岛 + `PathConnectionLink` + `PlaceOneDecoration`×4 + `LocalPreciseDecoration` + `NaturalDecorationDistribution`×2 共 9 份产物。下面示例做了简化，但根因和修复方式与真实记录一致。

```
❌ 错误：全部平行扇出（fan-out），谁都不吃前一个的 Rest
aw_m0_abg.out_1 ──┬──→ IslandRegions.in_0
                  ├──→ PlaceOneDecoration.in_1
                  ├──→ LocalPreciseDecoration.in_1
                  ├──→ NaturalDecorationDistribution#1.in_1
                  └──→ NaturalDecorationDistribution#2.in_1
                          （5 组各自独立算出一份"从零开始"的内容，互相不知道对方占了哪里）

❌ 错误：5 份内容先塞进一个自建的局部 merge_output，再整体接一次
IslandRegions.out_1 ─┐
PlaceOneDecoration.out_1 ─┤
LocalPreciseDecoration.out_1 ─┼→ merge_output(tree_merge, portCount 5) ──→ aw_m0_merge.item_1
NaturalDecoration#1.out_1 ─┤
NaturalDecoration#2.out_1 ─┘
```

**真正的技术原因**：`tree_merge` 是"全部 item 都必须有值才产出"的语义。上面 5 组里有 2 组（两个 `NaturalDecorationDistribution`）由于是从同一个 pristine 底图各自平行算的、彼此没有真实的 Rest 依赖关系，其中一路的 `out_1` 端口在 execute 摘要里根本不存在——只要 `merge_output` 的某个 `item_N` 拿到的是 undefined，**整个 `merge_output` 就完全没有输出**，进而连累 `aw_m0_merge`、`tree_flatten` 全部显示"无输出"。而 `tree_merge` 自己的 `inferredAccess`/`inferredType`/`portCount` 参数其实一直是对的——**改这几个参数改不出错，因为错的不是参数，是拓扑**。

**正确接法**（见下面完整 worked example）：多个模板串成一条 Rest 链，只有第 1 个模板吃 `sceneAnchor`，后面每个模板都吃**前一个模板的 Rest**；每组只把自己的 **Scene 汇总口**用 `appendMergeItem` 接入 `aw_m0_merge`，**不把领域口接 merge，也不建 `merge_output` 这种局部汇总节点**。

**装饰阶段尤其别纠结深度**：装饰组多时按顺序一路串下去即可——能接就接，某组 Rest 空了或放不下就**跳过剩余装饰收工**；禁止为「链太深 / Rest 耗尽」反复 redesign。合理铺满优先于完美拓扑推演。

> aw-support 的「检查并下一步」会跑这两项拓扑核验（同一上游端口 fan-out 给 ≥2 个模板 / 局部 tree_merge 汇总 ≥2 份模板内容），错了会在 `verification.reasons` 里直接点出具体节点 id。**2026-07-15 起同样的两项检查已经提前搬进了 `pipeline.execute` 本身**——不用等到 aw-support 下一轮续作消息才发现，本次 `execute` 调用报错时就会在 `verification.topologyIssues` 里给出（且大多数情况下 execute 会直接抛错中断，逼你先处理这个再往下走），`illegal-local-merge` 那一类甚至自带算好的 `suggestedOps`（`deleteNode` + `updateNode(portCount)` + 每份内容各自的 `connect`），**原样作为下一次 `applyBatch` 的 `ops` 提交即可，不用自己重新推导 item 编号**。**如果看到这类报错，直接照着改（或直接抄 `suggestedOps`），不要再去猜 `tree_merge` 参数**。

### 全局固定 Seed（必接）

基建节点 **`aw_m0_seed`**（`seed_control`，固定非 0）是全图随机源。凡带 Seed 口的模板组**必须**接上，禁止悬空或 `seed:0`（0 = 每次 execute 重抽）：

| 模板 | Seed 口 |
|------|---------|
| `IslandRegions` / `AreaPartition` | `in_5` |
| `PickOneBuilding` | `in_14` |
| `BuildingStructures` | `in_24` |
| `LocalPreciseDecoration` / `NaturalDecorationDistribution` | `in_3` |

`AddBaseGrid.in_8` 是 fillValue，**不要**接 seed。可把 `aw_m0_seed.seed` 扇出到多个模板组。

### 装饰选型（先选型，再按上面串 Rest）

| 模板 | 何时用 | 可挂资产 |
|------|--------|----------|
| `PlaceOneDecoration` | **少量**、有明确位置和/或底面尺寸（唯一可控 footprint） | 地标、石灯、特定大树等需占格贴合的物件 |
| `LocalPreciseDecoration` | 兴趣点旁一簇/一环 | **仅**底面简单、结构简单的小物件 |
| `NaturalDecorationDistribution` | 大片 Rest 防空白 | 同上——简单植被/石块 |

有宽深 + 落点 → **优先 PlaceOne**；Local/Natural **无**单颗 footprint 口，禁止塞复杂体量。装饰很少且全是精准物件 → **可以只用 PlaceOne**，不必硬凑三种。

### worked example：1 个区域 + N 个装饰（最常见的容器展开场景）

任务书给了 `sceneAnchor = aw_m0_abg.out_1`，子节点为「1 个叙事区域（IslandRegions）+ 3 个装饰（PlaceOneDecoration ×2、LocalPreciseDecoration ×1）」：

```
sceneAnchor(aw_m0_abg.out_1)
  → IslandRegions.in_0 / {label:"Scene"}            [第 1 组：吃 sceneAnchor]
      IslandRegions.out_0 {label:"Scene"} ──→ appendMergeItem(aw_m0_merge)
      IslandRegions.out_2 {label:"Rest"}  ──┐
                                            ▼
  → PlaceOneDecoration#1.in_1 {label:"Scene"}       [第 2 组：直接吃上一组 Rest 口]
      #1.out_0 {label:"Scene"} ──→ appendMergeItem
      #1.out_2 {label:"Rest"}  ──┐
                                 ▼
  → PlaceOneDecoration#2.in_1 {label:"Scene"}
      #2.out_0 {label:"Scene"} ──→ appendMergeItem
      #2.out_2 {label:"Rest"}  ──┐
                                 ▼
  → LocalPreciseDecoration.in_1 {label:"Scene"}
      .out_0 {label:"Scene"} ──→ appendMergeItem
      .out_2 {label:"Rest"} → 用不到可不接

多栋 PickOneBuilding 同理（组外自建 manual_points/text_panel/number_const → 各组 in_*）：
  sceneAnchor → pob_A.in_1(Scene);  pob_A.out_2(Rest) → pob_B.in_1;  pob_B.out_2 → pob_C.in_1
  每栋 out_0(Scene) → appendMergeItem；禁止打开 pob_* 组内找 scene_focus_path。
```

对应 4 个 `appendMergeItem` op（可以和各自的 `instantiateTemplate`/`connect` 混在同一批 `applyBatch` 里，也可以最后统一补一批）：

```json
{ "type": "appendMergeItem", "mergeNodeId": "aw_m0_merge", "source": { "nodeId": "<G_ISLAND>", "port": { "label": "Scene", "portName": "out_0" } } }
{ "type": "appendMergeItem", "mergeNodeId": "aw_m0_merge", "source": { "nodeId": "<G_DECO1>",   "port": { "label": "Scene", "portName": "out_0" } } }
{ "type": "appendMergeItem", "mergeNodeId": "aw_m0_merge", "source": { "nodeId": "<G_DECO2>",   "port": { "label": "Scene", "portName": "out_0" } } }
{ "type": "appendMergeItem", "mergeNodeId": "aw_m0_merge", "source": { "nodeId": "<G_LOCAL>",   "port": { "label": "Scene", "portName": "out_0" } } }
```

四组模板 = 四次「instantiateTemplate → 接上一组 Rest → 本组 Scene 汇总口 `appendMergeItem` 接入 aw_m0_merge」，**没有领域口直连 merge，没有局部 `ch_merge`，没有 `empty_scene`**。这是本 skill 覆盖率最高的场景，遇到"1 结构 + 多装饰"直接照抄这个顺序。

## tree_merge params 契约

```json
// scene 汇总
{ "inferredAccess": "tree", "inferredType": "scene", "portCount": N }
// point2d/number/string list
{ "inferredAccess": "item", "inferredType": "point2d", "portCount": N }
```

## 接入根节点 aw_m0_merge（每个任务收尾必做，只接 Scene 汇总口）

基建已由 aw-support 搭好：`AddBaseGrid` → `tree_merge(aw_m0_merge)` → flatten → merge → output。**这是最终产物汇总口，不是你的 Scene 输入口**——你的 Scene 输入永远是任务书给的 `sceneAnchor`。

### ⚡ 2026-07-15 起优先用 `appendMergeItem`，不用再手动数 `portCount`

`applyBatch` 现在有一个复合 op `appendMergeItem`，一次调用就顶原来手动的「查 portCount → updateNode+1 → connect」三步，而且**同一批 `ops` 里连续写几个也会正确地依次递增**，不会重复用同一个 `item_N`：

```json
{ "type": "appendMergeItem", "mergeNodeId": "aw_m0_merge", "source": { "nodeId": "g_island", "port": { "label": "Scene", "portName": "out_0" } } }
```

**本任务每实例化一个需要汇总的模板，就为它的 Scene 汇总口写一个这样的 op**。`source.port` 必须是 `{ label:"Scene", portName:"out_N" }`，**不是** Island/Building/Rest/Decoration 等领域口。可以放进同一个 `applyBatch` 调用，不用自己算 `item_N` 编号。

**禁止**覆盖已有 `item_*` 连接；**禁止**为了少调用几次而把多份内容先局部 `tree_merge` 再整体接一次——`appendMergeItem` 已经比那样更省事，没有理由还去搭局部 merge（见下面「Rest 串链纪律」的真实翻车案例）。

<details>
<summary>旧写法（仍然合法，`appendMergeItem` 内部展开出来的就是这三步；只有在你确实需要分两次 execute 之间插入别的操作时才手动拆开）</summary>

1. `pipeline.get` 查看 `aw_m0_merge` 当前 `params.portCount` 与已占用的 `item_*` 边。
2. `applyBatch` 里 `updateNode` 把 `aw_m0_merge.params.portCount` +1。
3. `connect` 这一份内容 → `aw_m0_merge.item_{N-1}`（N = 新 portCount）。

</details>

## execute 报 "Node X has no output" 怎么排查——按顺序查，不要先猜参数

某个 `tree_merge`/`tree_flatten`/`scene_merge_subtrees` 节点在 execute 摘要里完全没有输出时，**按下面顺序排查，第 1、2 步命中率最高，且都不需要动任何参数**：

1. **查 fan-out**：这个节点的上游（或更上游的某个 Scene 端口）是不是被**同时**接给了 ≥2 个模板组的 Scene 输入？——2026-07-15 起 `execute` 会自动跑这项检查并在 `verification.topologyIssues`（`kind: "rest-fan-out"`）里直接点名，不用再自己去 `pipeline.get({ raw: true })` 数出边条数；命中就得改成 Rest 串链（见上面「Rest 串链纪律」）。
2. **查局部 merge / 领域口直连 merge**：是不是自己建了一个非 `aw_m0_merge` 的 `tree_merge`，或把 Island/Building/Rest/Decoration 等领域口接进了 merge？命中就删掉非法局部节点，并把各模板的 **Scene 汇总口**分别 `appendMergeItem` 到 `aw_m0_merge`。
3. 前两项都没问题，才排查`portCount`是否和实际接入的 `item_*` 条数一致、有没有 `item_N` 悬空未接。
4. 最后才考虑 `inferredAccess`/`inferredType` 是否写对——这两个参数出错的概率最低，**不要一上来就改它们再重跑，那样只是在瞎猜**。

**为什么第 1、2 步优先**：`tree_merge`/`tree_flatten` 是"全部输入都有值才产出"的语义，只要上游因为拓扑错误（fan-out 后某条支路根本没算出内容、或局部 merge 里混进了一份空值）导致某个 `item_*` 是 undefined，**整个节点就完全没有输出**——这是目前实际遇到过的唯一一类"看起来是 merge 参数问题，其实是接线拓扑问题"的报错，参数本身几乎不会错。

## 收尾必做：写施工报告（下一个任务靠它续接，不写等于阻塞后续任务）

任务书会给出报告文件的**绝对路径**（`reportPath` 字段），任务完成、execute 通过后，**必须**用文件写入工具把如下 JSON 写到那个绝对路径——**照抄任务书给的完整路径，不要自己再拼一个相对路径**（例如 `construction-tasks/xxx-report.json`）。真实翻车过：agent 自己拼了个相对路径，被文件工具解析成了相对 **ForgeaX 项目根目录**（而不是这个任务实际所在的 `.forgeax/games/<slug>/pipeline/` 目录）解析，报告写到了完全不相关的地方，aw-support 永远读不到，判定"没写完"，同一个任务被反复续作了好几轮——而 agent 其实早就做完了，只是报告放错了地方。任务书给的路径已经是解析好的绝对路径，直接用就不会有这个问题：

```json
{
  "_source": "construction-task-report-v1",
  "seq": 0,
  "nodeId": "<本任务 nodeId>",
  "usedAnchor": { "nodeId": "...", "port": "..." },
  "childAnchors": {
    "<子节点id>": { "nodeId": "<你创建的分组/节点id>", "port": "<对应输出口>", "note": "可选" }
  },
  "note": "一句话说明做了什么"
}
```

- `childAnchors` 必须覆盖任务书 `requiredChildAnchors` 列出的**每一个**子节点 id——通常是 IslandRegions 的 Island/Rest 暴露口，或 PickOneBuilding 分组的 `out_1`（Building）——都写**组壳** nodeId+port，不要写组内节点。
- 若某个子节点没能顺利产出，仍要给出条目并在 `note` 里写明原因，不要整体漏掉字段——漏字段会导致后续任务无法解析连接点而被阻塞。
- `usedAnchor` 用于审计，应与任务书给的 `sceneAnchor` 一致。
- **报告里的 anchor `port` 一律写物理端口字符串**（如 `"out_1"`）。`{ "label":"Island", "portName":"out_1" }` 只用于 `applyBatch` 接线，禁止写进 `usedAnchor` / `childAnchors` / `restAnchor`，否则核验会把它判为不匹配。

### ⚠️ `note`/`说明`字段里禁止写裸英文双引号——会把整份 JSON 写坏

真实翻车过：`note` 字段里写了类似 `text_panel("驿道")` 这种描述（想说明"给 text_panel 传了驿道这个字符串"），但 JSON 字符串内部的英文双引号 `"` 必须转义成 `\"` 才合法——裸写进去会导致这份 report JSON **整体解析失败**。后果比看起来严重：aw-support 读不到有效报告，会一直判定"没写完"，同一个任务被反复要求续作，而 agent 每次续作都以为自己"报告已经写过了"，检查一下文件确实存在就收工，从不会用 JSON.parse 校验自己写出来的内容——于是这个坏 JSON 会被反复留在原地，卡住整条流水线，直到人工发现。

**防呆做法**：
1. `note`/`childAnchors[].note` 等字符串字段里如果要提到"往某个口传了字符串 X"，**不要**用英文双引号包住 X——改用不加引号的写法（`text_panel(驿道)`）或中文书名号/引号（`text_panel「驿道」`）。
2. 如果确实需要英文双引号，必须写成 `\"`（反斜杠+双引号），不能是裸的 `"`。
3. 写完 `write_file` 之后，如果手头有办法（比如 `read_file` 读回来看一眼），扫一眼有没有孤零零的裸 `"` 出现在本该是纯说明文字的地方——这是本 skill 目前唯一一类"文件确实写了、但格式非法"的翻车模式。

## 模板端口文档速查（label 之外的补充来源 —— 不要读 battery 原始 JSON）

**端口语义的一手来源永远是 `instantiateTemplate` 返回值里每个端口的 `label`**（见上面「双通道纪律」）。下面这些 `pipelines/*.md` 文档是**第二来源**，用于 `label` 缺失的口、接线配方（哪个口接哪个口）、数值参考区间、防呆点——这些是 `label` 一个词给不出来的信息。

**任务书/dispatch 消息里的「端口文档直达路径」一节已经给出了本任务候选模板对应文档的绝对路径——直接 `read_file` 那个路径，不要自己 `glob`/`grep` 去找。** 真实翻车过：agent 的 `glob` 搜索根不一定覆盖这个 marketplace 插件目录，`glob('pipelines/**/*.md')`/`glob('**/*connect-node-task*')` 这类尝试全部落空，白白烧掉小半个任务的 turn 预算，最后甚至去读了一个完全无关模板的原始 JSON。任务书已经把路径喂到嘴边了，不需要再自己找。

如果任务书这次没给这一节（旧格式续作消息），才退而查下表（相对 `wb-scene-generator/` 目录），30~120 行，已给出验证过的端口映射 + 可照抄 applyBatch 片段：

| 模板 | 文档路径 |
|------|---------|
| `IslandRegions` | `skills/compose-sino-scene/instructions/pipelines/IslandRegions.md` |
| `PickOneBuilding` | `skills/compose-sino-scene/instructions/pipelines/PickOneBuilding.md` |
| `BuildingStructures` | `skills/compose-sino-scene/instructions/pipelines/BuildingStructures.md` |
| `PathConnectionLink` / `PathConnectionRandomWalk` | `skills/compose-sino-scene/instructions/pipelines/PathConnectionLink.md`（两者端口完全一致；随机路网选 RandomWalk，规整主街选 Link） |
| `PlaceOneDecoration` | `skills/compose-sino-scene/instructions/pipelines/PlaceOneDecoration.md` |
| `LocalPreciseDecoration` | `skills/compose-sino-scene/instructions/pipelines/LocalPreciseDecoration.md` |
| `NaturalDecorationDistribution` | `skills/compose-sino-scene/instructions/pipelines/NaturalDecorationDistribution.md` |

- 只读**本任务实际会用到**的那几份，不要通读全部。
- 每份文档开头都标了「权威详情」README 链接——**默认不用点进去**，pipelines/*.md 已经够用；只有当它本身写"详情见 README"且你确实卡在一个它没覆盖的细节时才追加读。
- 这些文档给了 `label` 之外的接线配方和防呆点（`IslandRegions.out_1`=Island 主产物、`out_2`=Rest，`label` 会分别显示 `"Island"`/`"Rest"`，两边应该一致——如果不一致，以返回值 `label` 为准，回来更新这份文档）。

## 命名对齐自检 —— Name 口速查

execute 时传任务书给的 `narrativeLocationNames`，确认 `verification.locationNameAlignment.ok === true`。每种模板往哪个口喂地点名字符串（**原样出现，不能用泛化名替换**）。下表的 Name 口应该和 `instantiateTemplate` 返回值里该端口的 `label` 一致——**接线前可以直接在返回值里找 `label` 等于这些名字的那个 `portName`，不用死记 in_N 编号**：

| 模板 | Name 口 | label |
|------|--------|-------|
| `IslandRegions` | `in_3` | `IslandName` |
| `PickOneBuilding` | `in_0`（**不是** `in_2`） | `BuildingName` |
| `PlaceOneDecoration` | `in_0` | `DecorationName` |
| `LocalPreciseDecoration` | `in_0` | `NamePrefix` |
| `NaturalDecorationDistribution` | `in_0` | `NamePrefix` |
| `PathConnectionLink` / `RandomWalk` | `in_0` | `RoadName` |

漏接 Name 口 = execute 时 `locationNameAlignment` 必不过，务必在第一次 applyBatch 就接上，不要等 execute 报错才回头补。

## 工具电池白名单

`text_panel`, `number_const`, `toggle`, `seed_control`, `string_concat`, `scene_focus_path`, `scene_focus_children`, `node_explode`, `building_footprint_mask`, `manual_points`, `tree_merge`, `tree_flatten`, `scene_merge_subtrees`, `scene_output`

> **`scene_focus_path` / `scene_focus_children` 白名单 ≠ 默认要用。** Rest→Scene 串链、给 PickOne/PlaceOne 喂 Point/名字/宽高时**不要**建它们。仅任务明确要求按路径提门/提命名子区时，在**组外**创建并接到下游暴露口。

**明确禁止**：`empty_scene`、`AddBaseGrid`（根节点基建已就绪，全场景只有一份）。

## 你不读什么

- 不读 `executions/` 历史归档
- 不写 `scene-composition-checklist.json`
- 不读 `keypoint-layout-estimate.json` / `keypoint-layout-solved.json`（坐标已在任务书）
- **不读** `batteries/**` 下任何原始 `.json`/`README.md`（端口序号和语义都先看 `instantiateTemplate` 返回值里的 `portName`/`label`；`label` 缺失或需要接线配方才查上面「模板端口文档速查」的 `pipelines/*.md`）
- **不 `glob`/`grep` 整个 `batteries/` 目录**——这是本 skill 历史上拖垮上下文预算的头号原因
- **不 `glob`/`grep` 去找 `pipelines/*.md`/`connect-node-task` skill 本身在哪**——任务书「端口文档直达路径」一节已经给了绝对路径，直接 `read_file`；自己找大概率因为搜索根覆盖不到而落空，白烧 turn
- 本轮不处理地形（Mountain/Hill）
