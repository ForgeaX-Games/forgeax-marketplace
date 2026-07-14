# PathConnectionLink（道路连接·连连看）

> templateId（传给 `scene:pipeline.instantiateTemplate`）：`group_1782300000000_pclnk`，也可用 basename `PathConnectionLink`。
> 实例化后返回全新运行时 `groupId`，后续连线一律用返回值。

## 这是什么

`PathConnection` 系列的**连连看（link）变体**。骨架、输入/输出端口与 `PathConnectionRandomWalk` **完全一致**，唯一区别是中间的连点算子：

| 模板 | 核心算子 | 路网风格 |
|---|---|---|
| **PathConnectionRandomWalk** | `alg_topology_connect_points` | Prim MST + 正交 A* 寻路，路线更自然 |
| **PathConnectionLink**（本组） | `road_connect_link` | Prim MST + 连连看折线（最多 2 次转弯，0=直线/1=L形/2=Z/S形），障碍过密时降级 A* 兜底，路线更规整整洁 |

两者输入同一套 POI 点集 + 上游可铺路空间，输出同样的 Path / Rest 两块。需要规整、转弯清晰的棋盘格/田园路网时用本组；要更自然随机的走向时用 RandomWalk 版。

## 输入端口（IN）

| portName | 类型 | 语义 | 必接 | 怎么喂 |
|---|---|---|---|---|
| `in_2` | scene | 上游可铺路空间 | **是** | 上一组 **Rest** |
| `in_3` | point2d (list) | POI 点列表（要被道路连接的点） | **是** | `tree_merge`(item) ← 多个点 |
| `in_0` | string | RoadName（道路图层名） | 建议 | `text_panel` |
| `in_1` | string | RoadAsset（道路资产名，如 `石路`） | 建议 | `text_panel` |
| `in_15` | scene (tree) | **Obstacles** 道路需绕开的障碍场景 | 否 | 任意 Scene（建筑/水体等）→ `in_15`；不接时与原行为一致 |

> 隐藏高级端口：`roadWidth`(in_4)/`roadValue`(in_5) 等默认即可。
> `in_15`(Obstacles) 可选：接入的场景切片成障碍网格后与内部"非可铺路区"求并喂给寻路，道路据此绕行；悬空则无额外障碍。`coverPoi` 由内置 toggle 控制（默认覆盖 POI）。
> `road_connect_link` 另有 `maxTurns`（连连看最大转弯次数，默认 2）参数，模板内取默认值。

## 输出端口（OUT）

| portName | 语义 | 典型去向 |
|---|---|---|
| `out_1` | **Path** 道路（主产物） | → `tree_merge` 汇总 |
| `out_2` | **Rest** 非道路/剩余区域 | → 下一组 `in_2`（链式给湖/田/植被） |
| `out_0` | 附加场景输出 | 一般不接 |
| `out_3`/`out_4` | PathPath / RestPath 路径句柄 | 一般不接 |

## 与 RandomWalk 版互换

因为 `road_connect_link` 已重写为与 `alg_topology_connect_points` 完全一致的 datatree/item I/O（`poiGrid`/`obstacle` 进、`topology` 出、含 `coverPoi`），两个模板可直接互换：把图里的 PathConnectionRandomWalk 换成本组即可得到连连看风格路网，连线无需改动。
