# 道路 - PathConnectionRandomWalk / PathConnectionLink

> **旧名 `PathConnection` 已废弃** — 请用：
> - **`PathConnectionRandomWalk`** — 自然随机路网（`alg_topology_connect_points`）
> - **`PathConnectionLink`** — 连连看规整路网（`road_connect_link`）— 城镇主街默认推荐
>
> RandomWalk 权威：[../../../../batteries/templates/structures/path/PathConnection/README.md](../../../../batteries/templates/structures/path/PathConnection/README.md)
> Link 权威：[../../../../batteries/templates/structures/path/PathConnectionLink/README.md](../../../../batteries/templates/structures/path/PathConnectionLink/README.md)
> Link 速查：[PathConnectionLink.md](PathConnectionLink.md)
> **instantiate 用 basename `PathConnection`**（RandomWalk）；Link 用 `PathConnectionLink`。两者 **in/out 端口一致**。

> **已验证单链 M4**：`VERIFY_FRESH=1 node aw-support/scripts/verify-battery-templates.mjs --step=path` → `aw-support/battery-verify/<projectId>/step-m4-pathconnection.json`。**POI 从 rest cells 推理，禁止抄固定坐标。**

## 1. 管线电池的基本介绍

管线所属层级：**道路层级**

在 **POI 点集** 与 **可铺路的上游 Scene** 约束下，用 MST + 寻路/连连看生成连通道路，输出 Path + Rest。

**整图通常只需一个道路组**——多个连接点先经 `tree_merge`（item 档）合成 **point2d 列表**，再接入 `in_3`。

> ### 📍 POI 点位约束（接 `in_3` 前必读）
>
> **`in_3` 的每个 POI 必须是「可铺路区域」内的合法格，或区域边缘的合理锚点**——禁止凭直觉填坐标。
>
> **当前无坡道**：POI 若落在区域外、建筑体内、水域/障碍内，或「不贴边却悬空在无效格」，寻路会失败或道路畸形，且 **`execute` 仍可能 `completed`**。
>
> #### 必须遵守
>
> 1. **先导出再选点**：从上游 **`in_2` 同源 Rest 场景**（或 BaseNode）导出体素/区域信息，**推理筛选** POI，再 `manual_points`。
> 2. **合法 POI 定义**（满足其一）：
>    - **区域内**：`(x,y)` 落在可铺路 footprint 上（Rest 切片中该格 **非 0**）；
>    - **区域边缘**：该格在 footprint **边界上**，且邻格一侧通向可铺路内部或地图外缘（如港口、四向出图的边界锚点）。
> 3. **禁止**：
>    - POI **完全在区域外**（`region[y][x]==0` 且非刻意边缘锚点）；
>    - POI 落在**建筑占地内部**（非门洞）——路会穿楼或空跑；
>    - 未验证就使用「建筑几何中心」——中心常在 footprint **内部**，不是合法 POI。
>
> #### 推荐工作流（导出 → 推理 → 校验 → 接线）
>
> **Sino 白名单已开放顶层 POI 工具**：`scene_focus_path`、`node_explode`、`building_footprint_mask`、`string_concat`（仅用于 POI 推导，禁止手搓 M0）。
>
> #### A. 有 BuildingStructures + outer_door（**默认首选**）
>
> ```
> PickOne.out_3(BuildingPath) ──┐
> text_panel("/outer_door") ────┼→ string_concat → doorFullPath
> BuildingStructures.out_0 ─────→ scene_focus_path(scene, path=doorFullPath)
>                               → node_explode → 2dPoints → POI 候选
> ```
>
> 1. **`string_concat`**：`a` = 上游 **BuildingPath**（`PickOneBuilding.out_3` 或同链路 Path 口），`b` = `"/outer_door"`
> 2. **`scene_focus_path`**：`scene` ← `BuildingStructures.out_0`，`path` ← concat 结果
> 3. **`node_explode`**：读 **`2dPoints`** — 门洞平面坐标，直接作 `in_3` POI（或取质心）
> 4. 多栋建筑：每栋重复 focus+explode，POI 合并进 `tree_merge(item)`
>
> #### B. 无结构层（兜底）
>
> | 场景 | 怎么导出 | 怎么推理 POI |
> |------|---------|-------------|
> | **仅 PickOneBuilding / PickMulti** | `building_footprint_mask` 或 Point+Footprint | 长边中点**外一格**；门格 value=2 + origin 换算 |
> | **地图边界锚点** | 对 `in_2` 同源 Rest execute 摘要 | footprint **边界行/列**中点，须 region 非 0 |
> | **地标/装饰旁路口** | PlaceOne Point + footprint | 装饰 footprint **外侧**最近可铺路格 |
>
> **坐标**：`point2d` 一律 **x→列、y→行**（与 `manual_points` 一致）。
>
> #### 接入前自检清单（每个 POI 逐条过）
>
> ```
> □ 0 <= x < 网格宽 且 0 <= y < 网格高
> □ region[y][x] != 0  （在可铺路 Rest 内）或确认为「边缘锚点」且至少一侧邻接可铺路/地图外
> □ 不在任何建筑 footprint 内部（门格 value=2 除外）
> □ 与 in_2 将要接入的 Rest 场景同源、同一 z 切片
> □ 多点 POI 已 tree_merge(item) 后整体接 in_3
> ```
>
> 任一 POI 不通过 → **改坐标或改导出推理**，不要先 execute 碰运气。
>
> **execute 后必查**：`{zone}/rest/{roadName}` 的 cell 数 **>0 且远小于 rest cell 数**；为 0 → POI 全无效；为 宽×高 → 满图 bug。详见 `aw-support/src/orchestration/path-battery-agent-contract.ts`。

## 2. 输入端口

| portName | 类型 | access | 语义 | 必接 | 怎么喂 |
|----------|------|--------|------|------|--------|
| `in_2` | scene | tree | 上游可铺路空间 | **是** | 上一组 **Rest**（与 POI 校验用的 region **同源**） |
| `in_3` | point2d | **list** | POI 点列表 | **是** | 经 **导出+校验** 的 `manual_points` → `tree_merge`(item) |
| `in_0` | string | item | RoadName | 建议 | `text_panel` |
| `in_1` | string | tree | RoadAsset | 建议 | `text_panel`，如 `石路` |

## 3. POI 列表合并（标准写法）

```jsonc
{ "type":"createNode", "nodeId":"poi_merge", "opId":"tree_merge",
  "params":{"inferredAccess":"item", "inferredType":"point2d", "portCount":4} }
// pt_n.point → poi_merge.item_0 …（每个 pt 坐标已通过 region 校验）
// poi_merge.tree → PathConnectionRandomWalk.in_3  （或 PathConnectionLink.in_3）
```

`portCount` = POI 个数；**不要用 `inferredAccess:"tree"`**（那是 scene 汇总档）。

## 4. 输出端口

| portName | 语义 | 典型去向 |
|----------|------|---------|
| `out_1` | Path 道路 | `tree_merge` |
| `out_2` | Rest | 下一组 Scene |
| `out_3` | PathPath | 可选 |

## 5. 防呆

- **`in_2` + `in_3` 必接**；悬空静默空跑。
- **POI 必须先校验再接线**（见 §1）；区域外/建筑内/不贴边的点是最常见失败原因。
- **不要**每个方向各放一个道路组；**一个实例 + POI 列表**。
- 验证：`execute` 后 `out_1` 非空且图层出现道路资产名；若空 → 回头查 POI 是否在 region 内。

## 6. 示例：中心向四向连到边界

8 个 POI 一次接入：四侧 **建筑外侧/路口** (30,21)(30,39)(39,30)(21,30) + **经 region 校验的**边界 (30,2)(30,57)(57,30)(2,30) → `poi_merge.portCount:8` → 单个 `PathConnection`。

> 反例：把 POI 设在建筑中心 `(30,30)` 而 footprint 为 12×12 → 点在建筑内部，道路异常或空跑。
