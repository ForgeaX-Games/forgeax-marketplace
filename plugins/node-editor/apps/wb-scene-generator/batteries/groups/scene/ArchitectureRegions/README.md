# ArchitectureRegions（建筑区域）

> templateId（传给 `scene:pipeline.instantiateTemplate`）：`group_1781234452470_mzjv4`，也可用 basename `ArchitectureRegions`。
> 内部 26 个节点、2 个嵌套子组。实例化后返回全新运行时 `groupId`，后续连线一律用返回值。

## 功能说明

在一片上游场景（草地 / 空地）里**划分出建筑用地区域**，并为这些区域打上语义（地面 / 楼层资产名）。它产出两类东西：

- **建筑区域**（`out_0`）——后续可交给 `ArchitectureStructures` 生成墙体房间，或直接作为 `PathConnection` 的 POI 焦点。
- **剩余空地 Rest**（`out_2`）——没被建筑占用的地，链式传给下一组（道路 / 湖 / 田 / 植被）继续布置。

**典型位置：管线第一环**（紧接初始草地场景之后）。它是整张场景的"骨架第一层"——先确定建筑落在哪，其余地物再围绕建筑布置。

## 输入端口（IN）

可见（非 hidden）端口（"怎么喂"= 用哪个上游电池经 `node connect` / `connect` op 接上；portType 决定喂进去的数据格式）：

| portName | portType | 语义 | 是否必接 | 怎么喂（来源电池 → 本端口） | 数据格式（DataTree.items） |
|---|---|---|---|---|---|
| `in_0` | scene | 上游场景（初始草地 / 空地） | **必接** | `grid2node.scene` 或上一组 Rest → `in_0` | scene 树 `{tree:{name,children,...}}` |
| `in_1` | number | Seed 随机种子 | 建议接 | `seed_control.seed` → `in_1` | 数值，如 `42` |
| `in_2` | number | ExpectedBuildings 期望建筑数 | 建议接 | `number_const.value` → `in_2` | 数值，如 `8` |
| `in_3` | string | GroundAsset 地面/楼层资产名 | 建议接 | `text_panel.output` → `in_3` | 字符串，如 `"floor"` |

> 隐藏高级端口：`in_4`..`in_16`（fillValue / z / minSize / maxSize / minDistance / dispersion / schema / token / zRange 等建筑尺寸/形状/分布调参）。**默认即可，日常不接。**
>
> **数据格式总则**：每个端口值是 **DataTree** = `[{ "path":[...], "items":[...] }]`。`portType` 决定 `items` 形态：`number`→数值、`string`→字符串、`grid`→二维数组、`scene`→`{tree:{name,path,children,...}}`。要确认"这个端口预期喂/吐什么格式"，看它的 portType 即可。

## 输出端口（OUT）

| portName | 类型 | 语义 | 典型去向 |
|---|---|---|---|
| `out_0` | scene | **Buildings** 建筑区域 | → `tree_merge.item_N`（汇总）；或 → `ArchitectureStructures.in_0`；或作 `PathConnection.in_0`（POI 焦点） |
| `out_1` | string | BuildingPath（建筑层路径句柄） | 一般不接 |
| `out_2` | scene | **Rest** 剩余空地 | → 下一组 `in_0`（链式 Rest），或 → `PathConnection.in_1` |
| `out_3` | scene | 附加场景输出 | 一般不接 |
| `out_4` | string | RestPath（剩余层路径句柄） | 一般不接 |

## 推荐参数与设置考虑要素

- **ExpectedBuildings（`in_2`）**：期望建筑数。实证 Example1=`8`、verified-town=`8`。这是"目标值"而非精确值，实际数量受地图大小/最小间距影响。
  - 安静村落 / 小聚落：`6~8`
  - 热闹街区 / 城镇：`12~18`
  - 地图越大（`rect_grid` width/height 越大）能容纳越多建筑。
- **Seed（`in_1`）**：用全局唯一的 `seed_control.seed` 扇出到本组及所有其它组，保证整张图可复现（verified-town seed=`42`）。改 seed 会换一套建筑布局。
- **GroundAsset（`in_3`）**：地面/楼层资产名。**关键语义：它就是最终渲染出来的图层名。** 想要哪种语义直接写文本（中文如 `"楼板"`、英文如 `"floor"` 都可）。实测会渲染成 `floor` tile + voxel-mass。
- **地图尺寸**：上游 `rect_grid` width/height，verified-town=`50`、Example1=`73`。

## 使用示例（applyBatch ops，可照抄）

前置：已有初始草地骨架（`ground` 节点输出 `scene`、`seed_main` 输出 `seed`、汇总 `merge_all`）。先 `instantiateTemplate` 拿回 `<G_ARCH>`：

```json
{ "toolId":"scene:pipeline.instantiateTemplate","caller":{"kind":"ai"},
  "args":{ "templateId":"ArchitectureRegions", "position":{"x":-500,"y":0},
           "opts":{"actor":"ai:sino","label":"实例化 ArchitectureRegions"} } }
```

再把返回的 groupId 替换进 `<G_ARCH>`，提交一条 applyBatch：

```jsonc
{ "type":"createNode","nodeId":"bld_count", "opId":"number_const","position":{"x":-900,"y":300},"params":{"value":8} },        // ExpectedBuildings
{ "type":"createNode","nodeId":"floor_name","opId":"text_panel",  "position":{"x":-900,"y":420},"params":{"text":"floor"} },  // GroundAsset = 渲染图层名
{ "type":"connect","edgeId":"e_ar_scene","source":{"nodeId":"ground","port":"scene"},     "target":{"nodeId":"<G_ARCH>","port":"in_0"} },
{ "type":"connect","edgeId":"e_ar_seed", "source":{"nodeId":"seed_main","port":"seed"},   "target":{"nodeId":"<G_ARCH>","port":"in_1"} },
{ "type":"connect","edgeId":"e_ar_cnt",  "source":{"nodeId":"bld_count","port":"value"},  "target":{"nodeId":"<G_ARCH>","port":"in_2"} },
{ "type":"connect","edgeId":"e_ar_floor","source":{"nodeId":"floor_name","port":"output"},"target":{"nodeId":"<G_ARCH>","port":"in_3"} },
{ "type":"connect","edgeId":"e_ar_out0", "source":{"nodeId":"<G_ARCH>","port":"out_0"},   "target":{"nodeId":"merge_all","port":"item_0"} }
```

> 若后续要接道路，记得保留 `<G_ARCH>.out_0`（焦点）与 `<G_ARCH>.out_2`（剩余）给 `PathConnection`。

### 等价 CLI 写法（forgeax，headless）

三条通路（UI 拖拽 / CLI / `scene:*` 工具）底层是**同一套 op**，落到同一张 `graph.json`，效果等价、可互相验证。CLI 版（`<G>` = 定位参数，如 `--project-id <pid> --project-root <ws>`；`$BATT` = batteries 目录；`$TMPL` = `apps/wb-scene-generator/batteries/templates/scene`）：

```bash
# 1) 一步实例化模板组（--group-id 给稳定句柄；省略则自动生成）
forgeax node create-template --group-file $TMPL/ArchitectureRegions/ArchitectureRegions.json --group-id arch --x -500 --y 0 $G
# 2) 建 panel 输入电池
forgeax node create --node-id bld_count  --op number_const --params '{"value":8}'      --x -900 --y 300 $G --batteries $BATT
forgeax node create --node-id floor_name --op text_panel   --params '{"text":"floor"}' --x -900 --y 420 $G --batteries $BATT
# 3) 连线（--from/--to 用 node:port）
forgeax node connect --edge-id e_ar_scene --from ground:scene      --to arch:in_0 $G
forgeax node connect --edge-id e_ar_seed  --from seed_main:seed    --to arch:in_1 $G
forgeax node connect --edge-id e_ar_cnt   --from bld_count:value   --to arch:in_2 $G
forgeax node connect --edge-id e_ar_floor --from floor_name:output --to arch:in_3 $G
forgeax node connect --edge-id e_ar_out0  --from arch:out_0        --to merge_all:item_0 $G
```

> 也可用 `forgeax pipeline apply --ops '<JSON array>'` 一次提交多条 op（与上面 applyBatch 的 ops 完全同一套 schema）。

## 使用场合

- **几乎所有有建筑的场景都用它，且通常是第一个实例化的模板组。** 城镇、村落、街区、有房子的乡村都从这里起步。
- 与 `ArchitectureStructures` 配合：把 `out_0` 接进结构组生成墙体/房间。
- 与 `PathConnection` 配合：`out_0`→POI 焦点、`out_2`→剩余，自动在建筑间连路。
- 链式 Rest：`out_2` 作为后续湖/田/植被的起点空地。
- **不该用的情况**：纯自然场景（只有森林/湖泊、没有任何建筑）可跳过它，直接从初始草地接 LakeRegions / RandomNaturalDecoration。

## 验证要点

接好后 `pipeline.get` 核对：`<G_ARCH>` 的 `in_0/in_1/in_2/in_3` 与 `out_0` 真的接上了边（防"ok 却空"）。

`pipeline.execute` 应 `status:completed` 零错误，`out.layers` 中应**多出建筑相关图层**：

- 名为你传入 `GroundAsset` 文本（如 `floor`）的 **tile** 图层；
- 对应的 **voxel-mass**（建筑体块）。
- 实证基线（verified-town 骨架+建筑）：节点 13 / 边 13，`out.layers` 含 `floor` tile×4 + voxel-mass×4。

看到这些图层即说明本层正确，可进行下一个电池。

### 读回端口内容验证（像 grep 一样查某端口）

没有专门的"读端口"命令；标准做法是 **`execute` 后用 jq 把 `result.outputs` 投影到 `节点.端口`**。`outputs` 按 **nodeId** 键控，每个节点是 `{ <portName>: <DataTree> }`，DataTree = `[{path,items}]`。

```bash
# CLI 通路：查本组建筑产物 out_0（用实例化返回的真实 groupId 替换 <G_ARCH>）
forgeax pipeline execute --batteries $BATT $G \
  | jq '.result.outputs["<G_ARCH>"]["out_0"]'
# 只看场景树里的子节点名（避免打印整棵树）
forgeax pipeline execute --batteries $BATT $G \
  | jq '.result.outputs["<G_ARCH>"]["out_0"][].items[0].tree.children[].name'
```

工具通路同理：对 `scene:pipeline.execute` 返回做 `jq '.result.outputs["<G_ARCH>"]["out_0"]'`。

预期：`out_0`（scene）的树里**新增建筑相关子节点**（如 `architecture_*` / 名为 GroundAsset 文本的图层）；`out_2`（Rest）是剩下的空地场景树。

> ⚠️ **绝不要整体打印 `outputs`**：整图 execute 的 outputs 可能极大（verified-town 实测约 28MB，因含全 voxel 网格），会刷屏 / 爆上下文。**必须用 jq 投影到具体 `nodeId.portName`**，scene 端口只取 `.[].items[0].tree.children[].name` 之类摘要。
