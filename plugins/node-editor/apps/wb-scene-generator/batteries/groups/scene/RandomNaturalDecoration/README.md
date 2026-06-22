# RandomNaturalDecoration（自然随机装饰）

> templateId（传给 `scene:pipeline.instantiateTemplate`）：`group_1781239444306_uz0oe`，也可用 basename `RandomNaturalDecoration`。
> 内部 29 个节点、2 个嵌套子组。实例化后返回全新运行时 `groupId`，后续连线一律用返回值。

## 功能说明

在**剩余空地上随机撒自然植被 / 装饰**（树木、石头等点状/对象类装饰物）。它把空地填上散落的自然元素，让场景更生动。

**典型位置：链路最后一环。** 通常吃前面所有组留下的最终 Rest（如 `PathConnection.out_1` / `FarmlandRegions.out_1`），在最后剩下的空地上铺满植被。

## ⚠️ 防呆铁律：`in_0`（上游场景）必接，且上游不能来自一个空跑的组 ⚠️

> **`in_0`（上游剩余空地）必接**——它是要被撒装饰的空地，悬空则本组无处可撒，**整组静默空跑**（无 `outputs/<本组>/` 目录、最终 `names` 无你传入的装饰名如"行道树"），且**整图 `execute` 仍报 `completed` 不报错**（`tree_merge`/`scene_output` 不校验各 item 非空）。
>
> **更隐蔽的连带坑**：`in_0` 即使"接上了边"，若上游来自一个**本身就空跑的组**（最典型：`PathConnection` 因 `in_0`=POI 悬空而空跑，它的 `out_1` Non-Path 为空），那本组拿到的是空场景，**照样静默空跑**——边连上了 ≠ 上游有内容。
>
> 因此本组验证不能只看"connected"，**必须单独确认本组 `outputs/<G_DECO>/` 目录存在、`out_0` 子节点非空、最终 `names` 里出现装饰名**（见文末「验证要点」）。若发现本组空，先回头查上游那组（尤其 PathConnection 的 `in_0` POI）是否空跑。

## 输入端口（IN）

可见（非 hidden）端口（"怎么喂"= 用哪个上游电池经 `node connect` / `connect` op 接上）：

| portName | portType | 语义 | 是否必接 | 怎么喂（来源电池 → 本端口） | 数据格式（DataTree.items） |
|---|---|---|---|---|---|
| `in_0` | scene | 上游场景 / 剩余空地 | **必接** | 上游最终 Rest（如 `PathConnection.out_1` 或 `FarmlandRegions.out_1`） → `in_0` | scene 树 |
| `in_1` | string | NaturalAssetName 植被/装饰资产名 | 建议接 | `text_panel.output` → `in_1` | 字符串，如 `"树"` |
| `in_2` | number | Seed 随机种子 | 建议接 | `seed_control.seed` → `in_2` | 数值，如 `42` |
| `in_3` | number | Density 密度 | 建议接 | `number_const.value` → `in_3` | 数值，如 `0.05` |

> 隐藏高级端口：`in_4`..`in_15`（fillValue / z / schema / token / zRange / edge / mode / count / step / prefix 等分布/排布调参）。**默认即可，日常不接。**
>
> **数据格式总则**：端口值是 **DataTree** = `[{path,items}]`；`portType` 决定 `items` 形态：`scene`→`{tree:{name,children,...}}`、`number`→数值、`string`→字符串、`grid`→二维数组。

## 输出端口（OUT）

| portName | 类型 | 语义 | 典型去向 |
|---|---|---|---|
| **`out_0`** | scene | **完整 scene 树**（本组处理后的全树 = 上游 + 本组散布结果） | → **`tree_merge.item_N`（汇总完整场景时接这个）** |
| `out_1` | string | NaturalDecPath（路径句柄） | 一般不接 |
| **`out_2`** | scene | **NaturalDec** — 仅本组**新撒**的植被子树（增量片段） | ❌ **不要**用于 merge 完整可视化 |
| **`out_3`** | scene | **Rest** 剩余空地 | → 下一组 `in_0`（多品种链式散布） |
| `out_4` | string | RestPath（剩余路径句柄） | 一般不接 |

> ⚠️ **常见弯路（2026-06-16 固化）**：
> - **merge / scene_output 必须接 `out_0`（完整 scene）**，不是 `out_2`（NaturalDec）。接 `out_2` 会缺前面几组累积的植被。
> - **多品种植被**：每品种**独立实例化一组**，`in_1` 只喂**一个**资产名 + **独立** density；`out_3` 链式接下一组 `in_0`。❌ 禁止多名共用一个 density。
> - **仅草坪+植被**时，第一组 `in_0` ← **`AddBaseGrid.out_1`（BaseNode）**，不是 `out_0`（裸 grid）或 `out_2`（RootScene）。
> - 实例路径固定前缀 **`tree_N`** 正常；渲染器按 **`asset_name` 属性**（= `in_1` 写入的语义名）匹配贴图，不是按路径名。

## 推荐参数与设置考虑要素

- **Density（`in_3`）**：装饰密度，**直接控制撒多少棵/多少个**。实证 Example1=`0.05`（树）、verified-town=`0.05`（出 73 棵树）。**密度越大，棵数越多。**
  - 稀疏点缀：`0.02~0.05`
  - 茂密森林 / 满地植被：`0.1~0.3`
- **NaturalAssetName（`in_1`）**：植被/装饰资产名，**就是渲染出来的对象图层名**。实测传中文 `"树"` 时图层名即 `树`。按语义命名（`"树"` / `"石头"` / `"tree"` / `"bush"`）。
- **Seed（`in_2`）**：接全局 `seed_control.seed` 保证可复现。改 seed 换一套撒布位置。

## 使用示例（applyBatch ops，可照抄）

前置：链路里已有上游最终剩余场景（如 `<G_PATH>.out_1`）。先实例化拿回 `<G_DECO>`：

```json
{ "toolId":"scene:pipeline.instantiateTemplate","caller":{"kind":"ai"},
  "args":{ "templateId":"RandomNaturalDecoration", "position":{"x":-500,"y":1000},
           "opts":{"actor":"ai:sino","label":"实例化 RandomNaturalDecoration"} } }
```

把返回 groupId 替换进 `<G_DECO>`，提交 applyBatch（`<UPSTREAM_REST>` 改成实际上游，如 `<G_PATH>.out_1`）：

```jsonc
{ "type":"createNode","nodeId":"tree_name",   "opId":"text_panel",  "position":{"x":-900,"y":1000},"params":{"text":"树"} },   // NaturalAssetName = 装饰图层名
{ "type":"createNode","nodeId":"deco_density","opId":"number_const","position":{"x":-900,"y":1120},"params":{"value":0.05} }, // Density 密度
// in_0=上游剩余 接 PathConnection.out_1；in_1=植被名；in_2=seed；in_3=密度
{ "type":"connect","edgeId":"e_dec_rest","source":{"nodeId":"<G_PATH>","port":"out_1"},     "target":{"nodeId":"<G_DECO>","port":"in_0"} },
{ "type":"connect","edgeId":"e_dec_name","source":{"nodeId":"tree_name","port":"output"},   "target":{"nodeId":"<G_DECO>","port":"in_1"} },
{ "type":"connect","edgeId":"e_dec_seed","source":{"nodeId":"seed_main","port":"seed"},     "target":{"nodeId":"<G_DECO>","port":"in_2"} },
{ "type":"connect","edgeId":"e_dec_dens","source":{"nodeId":"deco_density","port":"value"}, "target":{"nodeId":"<G_DECO>","port":"in_3"} },
{ "type":"connect","edgeId":"e_dec_out0","source":{"nodeId":"<G_DECO>","port":"out_0"},    "target":{"nodeId":"merge_all","port":"item_3"} }  // ★ 汇总接 out_0（完整 scene），不是 out_2
```

### 多品种植被 + 独立 density（现生成贴图常用）

4 种现生成 object（如 `grass_tuft` / `bush` / `tree_small` / `tree_big`）时：

1. **实例化 4 组** RandomNaturalDecoration，每组 `in_1` ← **单个** `text_panel`，`in_3` ← **独立** `number_const`。
2. **链式 Rest**：`<G_BASE>.out_1` → 组1.in_0；组1.out_3 → 组2.in_0 → …
3. **汇总**：四组 **`out_0`** → `tree_merge` → `tree_flatten` → `scene_merge_subtrees` → `scene_output`。

详见 `/compose-sino-scene` Step 4b、`/texture-pipeline` §3.1。

### 等价 CLI 写法（forgeax，headless）

三条通路底层同一套 op、落到同一张 `graph.json`。CLI 版（`<G>`/`$BATT`/`$TMPL` 含义见 `ArchitectureRegions/README.md`；上游 `path` 句柄来自实例化 PathConnection 时的 `--group-id`）：

```bash
forgeax node create-template --group-file $TMPL/RandomNaturalDecoration/RandomNaturalDecoration.json --group-id deco --x -500 --y 1000 $G
forgeax node create --node-id tree_name    --op text_panel   --params '{"text":"树"}'  --x -900 --y 1000 $G --batteries $BATT
forgeax node create --node-id deco_density --op number_const --params '{"value":0.05}' --x -900 --y 1120 $G --batteries $BATT
forgeax node connect --edge-id e_dec_rest --from path:out_1         --to deco:in_0 $G
forgeax node connect --edge-id e_dec_name --from tree_name:output   --to deco:in_1 $G
forgeax node connect --edge-id e_dec_seed --from seed_main:seed     --to deco:in_2 $G
forgeax node connect --edge-id e_dec_dens --from deco_density:value --to deco:in_3 $G
forgeax node connect --edge-id e_dec_out0 --from deco:out_0         --to merge_all:item_2 $G   # ★ out_0 完整 scene
```

> 或 `forgeax pipeline apply --ops '<JSON array>'` 一次提交（同 applyBatch schema）。

## 多品种植被 + 独立 density

见上文「多品种植被 + 独立 density（现生成贴图常用）」与 `/compose-sino-scene` Step 4b。

## 使用场合

- **几乎所有自然/乡村场景的收尾层**——给场景撒上树木、灌木、石头等点缀，是最常用、最后接的一组。
- 接在链路末端任意产出 Rest 的组之后（道路 Non-Path / 农田 Rest / 湖 Rest）。
- 可重复实例化多次（不同 `NaturalAssetName` + 不同 Rest）来铺多种植被层。
- **不该用的情况**：纯硬质场景（全是建筑道路、不要任何植被）可跳过。

## 验证要点

> **务必逐组验证本组真的撒了装饰**——`execute` 报 `completed` 不代表本组成功；尤其当上游来自 `PathConnection.out_1` 时，要先确保 PathConnection 没空跑（它的 `in_0`=POI 必须接上，否则 `out_1` 为空 → 本组连带空）。

`pipeline.get` 核对 `<G_DECO>` 的 `in_0`（上游剩余）、`in_1`/`in_2`/`in_3`（名/种子/密度）真的接上，`out_0` 进了汇总。

**单独确认本组非空（关键，别只看 connected）**：

```bash
# 本组目录必须存在（in_0 悬空或上游空 → 此目录不生成 / out_0 为空）
ls outputs/<G_DECO>/ 2>/dev/null || echo "❌ 本组无输出 = 空跑(查 in_0 及其上游组是否空跑)"
# 数一数撒了几个装饰对象（应 > 0，且名字=你传入的 NaturalAssetName 如 行道树）
forgeax pipeline execute --batteries $BATT $G \
  | jq '[.result.outputs["<G_DECO>"]["out_0"][].items[0].tree.children[]] | length'
# 最终 names 里应出现装饰名
jq -r '.data[0].items[0][] | "\(.type)\t\(.name)"' outputs/out/names.json | sort | uniq -c | grep 行道树 \
  || echo "❌ names 里没有装饰名 = 没撒成(回头查上游 PathConnection.in_0 是否悬空)"
```

`pipeline.execute` 应 `status:completed`，`out.layers` 应**多出多个 `type:object` 图层，名字 = 你传入的 NaturalAssetName 文本**（如 `树`），数量随 `Density` 变化（密度越大棵数越多）。

- 实证基线（verified-town +植被）：节点 18 / 边 22，密度 `0.05` 出 `树` object×73（共 82 层，每层都有 cells）。
- 反例（crowded-block 修复前）：上游 `PathConnection` 因 `in_0`=POI 悬空而空跑，本组 `in_0 <- paths.out_1` 拿到空场景 → `outputs/natdec/` 不存在、`names` 无"行道树"，但整图仍 `completed`。

截图里剩余空地铺上了散布的植被，即说明本层正确。

### 读回端口内容验证（像 grep 一样查某端口）

`execute` 后用 jq 把 `result.outputs` 投影到 `节点.端口`（`outputs` 按 nodeId 键控，DataTree = `[{path,items}]`）：

```bash
# 查装饰产物 out_0 的子节点名（树/装饰），并数一数有多少棵
forgeax pipeline execute --batteries $BATT $G \
  | jq '.result.outputs["<G_DECO>"]["out_0"][].items[0].tree.children[].name'
forgeax pipeline execute --batteries $BATT $G \
  | jq '[.result.outputs["<G_DECO>"]["out_0"][].items[0].tree.children[]] | length'
```

工具通路同理对 `scene:pipeline.execute` 返回投影。预期：`out_0` 树里出现多个名为 NaturalAssetName 文本（如 `树`）的对象子节点，数量随 `Density` 变化（密度 `0.05` 实测约 73 个）。

> ⚠️ **绝不要整体打印 `outputs`**（整图可达约 28MB 含全 voxel 网格）；**必须 jq 投影到具体 `nodeId.portName`**，scene 端口只取 `.[].items[0].tree.children[].name` 或对其取 `length` 计数等摘要。
