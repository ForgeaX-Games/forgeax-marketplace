# ArchitectureStructures（建筑结构）

> templateId（传给 `scene:pipeline.instantiateTemplate`）：`group_1781235844604_rzrp9`，也可用 basename `ArchitectureStructures`。
> 内部 45 个节点、3 个嵌套子组。实例化后返回全新运行时 `groupId`，后续连线一律用返回值。

## 功能说明

接在 `ArchitectureRegions` 的建筑区域之后，**在建筑区域里进一步生成墙体 / 房间结构**——把"一块建筑用地"细化成"有墙、有房间分隔的结构化建筑"。

**典型位置：建筑层的第二级**（`ArchitectureRegions.out_0` → 本组 `in_0`）。它是可选的精细化步骤：只想要建筑体块时可跳过，想要带房间结构的建筑时加上。

## ⚠️ 头号接线铁律：`in_0` 接 **Buildings(`ArchitectureRegions.out_0`)**，**绝不接 Rest(`out_2`)**

> 建筑结构是**在"建筑区域(Buildings)"上盖楼/起墙**，不是在剩余空地上建——所以 `in_0` 必须接 `ArchitectureRegions.out_0`（Buildings 建筑区域），**绝不能接 `out_2`(Rest 剩余空地)**。接成 Rest 是生产里踩过的真实错连（楼盖到空地上、本该有结构的建筑区域反而没结构）。
>
> **一行接线示例（照抄）**：
>
> ```jsonc
> { "type":"connect","edgeId":"e_as_scene","source":{"nodeId":"<G_ARCH>","port":"out_0"},"target":{"nodeId":"<G_STRU>","port":"in_0"} }  // in_0 ← out_0(Buildings)，不是 out_2(Rest)
> ```
>
> 别把"上一组的 Rest → 本组 in_0"这条通用链式话术套到本组——那条只适用于"在空地上铺新东西"的组（道路/湖/田/装饰）；ArchitectureStructures 是"在已有建筑产物上加工"，接主产物 Buildings。

## 输入端口（IN）

可见（非 hidden）端口（"怎么喂"= 用哪个上游电池经 `node connect` / `connect` op 接上）：

| portName | portType | 语义 | 是否必接 | 怎么喂（来源电池 → 本端口） | 数据格式（DataTree.items） |
|---|---|---|---|---|---|
| `in_0` | scene | 建筑区域场景 | **必接** | `ArchitectureRegions.out_0` → `in_0` | scene 树 |
| `in_1` | string | WallAsset 墙体资产名 | 建议接 | `text_panel.output` → `in_1` | 字符串，如 `"wall"` |
| `in_2` | number | Seed 随机种子 | 建议接 | `seed_control.seed` → `in_2` | 数值，如 `42` |

> 隐藏高级端口：`in_3`..`in_29`（thickness 墙厚 / density / count / width 门窗数量宽度 / random / schema / token / zRange / step / prefix 等墙体门窗层高调参）。**默认即可，日常不接。** 这是 6 组里隐藏端口最多的（结构最复杂）。
>
> **数据格式总则**：端口值是 **DataTree** = `[{path,items}]`；`portType` 决定 `items` 形态：`number`→数值、`string`→字符串、`grid`→二维数组、`scene`→`{tree:{name,children,...}}`。

### 怎么用 CLI 喂这些参数

每个可见参数端口都由一个上游 panel 电池经 `forgeax node connect --from <node>:<port> --to <G>:<in_N>` 接进来（`<G>` = 实例化本组返回的 groupId / 你给的 `--group-id` 句柄）。命令骨架：

```bash
# in_0 建筑区域：直接连上游 ArchitectureRegions 的 out_0（无需 panel）
forgeax node connect --edge-id e_as_scene --from <G_ARCH>:out_0 --to <G_STRU>:in_0 $G
# in_1 WallAsset（string）：text_panel.output → in_1
forgeax node create  --node-id wall_name --op text_panel --params '{"text":"wall"}' --x -900 --y -400 $G --batteries $BATT
forgeax node connect --edge-id e_as_wall --from wall_name:output --to <G_STRU>:in_1 $G
# in_2 Seed（number）：seed_control.seed → in_2
forgeax node connect --edge-id e_as_seed --from seed_main:seed --to <G_STRU>:in_2 $G
```

每个端口期望的数据格式由 portType 决定：`in_0`(scene)=场景树、`in_1`(string)=字符串、`in_2`(number)=数值。

## 输出端口（OUT）

| portName | 类型 | 语义 | 典型去向 |
|---|---|---|---|
| `out_0` | scene | 结构化建筑（主产物） | → `tree_merge.item_N`（汇总） |
| `out_1` | scene | **Rooms** 房间 | 一般不接（需要房间细分时再用） |
| `out_2` | string | RoomsPath（房间路径句柄） | 一般不接 |

> 注意：本组**没有 Rest 输出**。剩余空地的链式传递仍由上游 `ArchitectureRegions.out_2` 负责——`ArchitectureStructures` 只细化建筑本身，不消费空地。

## 推荐参数与设置考虑要素

- **WallAsset（`in_1`）**：墙体资产名，**就是渲染出来的墙体图层名**。按语义命名，中文如 `"墙"`、英文如 `"wall"`。
- **Seed（`in_2`）**：接全局 `seed_control.seed`，与其它组共用同一种子保证可复现。改 seed 会换一套房间分隔。
- **墙厚 / 门窗（隐藏 `in_5`..`in_11` 等）**：默认即可，除非用户明确要求调墙厚或门窗密度。
- **何时加这一层**：默认乡村/休闲场景**可以不加**（Example1 的休闲乡村主链路里建筑用 `ArchitectureRegions` 即可）；当用户要"室内可进入 / 有房间分隔 / 建筑更精细"时再加。

## 使用示例（applyBatch ops，可照抄）

前置：已实例化 `ArchitectureRegions` 并拿到 `<G_ARCH>`。先实例化本组：

```json
{ "toolId":"scene:pipeline.instantiateTemplate","caller":{"kind":"ai"},
  "args":{ "templateId":"ArchitectureStructures", "position":{"x":-500,"y":-400},
           "opts":{"actor":"ai:sino","label":"实例化 ArchitectureStructures"} } }
```

把返回 groupId 替换进 `<G_STRU>`，提交 applyBatch：

```jsonc
{ "type":"createNode","nodeId":"wall_name","opId":"text_panel","position":{"x":-900,"y":-400},"params":{"text":"wall"} },  // WallAsset = 墙体图层名
// in_0=建筑区域（接 ArchitectureRegions.out_0）；in_1=墙体名；in_2=seed
{ "type":"connect","edgeId":"e_as_scene","source":{"nodeId":"<G_ARCH>","port":"out_0"},   "target":{"nodeId":"<G_STRU>","port":"in_0"} },
{ "type":"connect","edgeId":"e_as_wall", "source":{"nodeId":"wall_name","port":"output"}, "target":{"nodeId":"<G_STRU>","port":"in_1"} },
{ "type":"connect","edgeId":"e_as_seed", "source":{"nodeId":"seed_main","port":"seed"},   "target":{"nodeId":"<G_STRU>","port":"in_2"} },
{ "type":"connect","edgeId":"e_as_out0", "source":{"nodeId":"<G_STRU>","port":"out_0"},   "target":{"nodeId":"merge_all","port":"item_N"} }  // 换一个未占用的 item 口
```

> 若同时接了 `ArchitectureStructures`，汇总时通常用**结构化建筑 `out_0`** 进 `tree_merge`（而非建筑区域的 `out_0`，避免两层建筑叠加重复）。是否还把 `ArchitectureRegions.out_0` 也汇总，按需求定。

### 等价 CLI 写法（forgeax，headless）

三条通路底层同一套 op、落到同一张 `graph.json`。CLI 版（`<G>`/`$BATT`/`$TMPL` 含义见 `ArchitectureRegions/README.md`）：

```bash
forgeax node create-template --group-file $TMPL/ArchitectureStructures/ArchitectureStructures.json --group-id stru --x -500 --y -400 $G
forgeax node create --node-id wall_name --op text_panel --params '{"text":"wall"}' --x -900 --y -400 $G --batteries $BATT
forgeax node connect --edge-id e_as_scene --from arch:out_0       --to stru:in_0     $G
forgeax node connect --edge-id e_as_wall  --from wall_name:output --to stru:in_1     $G
forgeax node connect --edge-id e_as_seed  --from seed_main:seed   --to stru:in_2     $G
forgeax node connect --edge-id e_as_out0  --from stru:out_0       --to merge_all:item_N $G
```

> 或 `forgeax pipeline apply --ops '<JSON array>'` 一次提交（同 applyBatch schema）。

## 使用场合

- 需要**带房间/墙体结构的建筑**（室内可进入、建筑更精细）时加这一层。
- 必须接在 `ArchitectureRegions` 之后（吃它的 `out_0` 建筑区域）。
- **不该用的情况**：只要建筑外观体块、不需要室内结构的场景（多数休闲乡村）可跳过，直接用 `ArchitectureRegions.out_0` 汇总即可。

## 验证要点

`pipeline.get` 核对 `<G_STRU>.in_0` 真的接到了 `<G_ARCH>.out_0`，且 `out_0` 接进了汇总。

`pipeline.execute` 应 `status:completed`，`out.layers` 中建筑相关图层应**比只用 ArchitectureRegions 时更细**——多出墙体（名为 `WallAsset` 文本，如 `wall`）相关的 tile/voxel 图层。对照前一层（仅建筑区域）的截图，建筑应出现墙体分隔即说明本层正确。

### 读回端口内容验证（像 grep 一样查某端口）

`execute` 后用 jq 把 `result.outputs` 投影到 `节点.端口`（`outputs` 按 nodeId 键控，每节点是 `{ <portName>: DataTree }`，DataTree = `[{path,items}]`）：

```bash
# 查结构化建筑 out_0 的场景树子节点名（用真实 groupId 替换 <G_STRU>）
forgeax pipeline execute --batteries $BATT $G \
  | jq '.result.outputs["<G_STRU>"]["out_0"][].items[0].tree.children[].name'
```

工具通路同理对 `scene:pipeline.execute` 返回投影。预期：`out_0` 树里出现墙体/房间相关子节点（名含 WallAsset 文本，如 `wall`）。

> ⚠️ **绝不要整体打印 `outputs`**（整图可达约 28MB，含全 voxel 网格会爆上下文）；**必须 jq 投影到具体 `nodeId.portName`**，scene 端口只取 `.[].items[0].tree.children[].name` 摘要。
