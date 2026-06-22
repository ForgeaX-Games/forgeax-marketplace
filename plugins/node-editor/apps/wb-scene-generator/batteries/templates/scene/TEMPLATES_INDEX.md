# 场景模板组总览索引（TEMPLATES_INDEX）

> **这是 sino agent 用模板电池的第一步入口。** 工作流程：
> **① 先查这张总表**——根据需求（要建筑 / 道路 / 湖 / 田 / 植被）定位要用哪几个 template 电池；
> **② 再去读对应电池的 `<Name>/README.md` 详细文档**（输入输出端口、推荐参数、可照抄示例、使用场合、验证要点）；
> **③ 按 README 示例实例化 + 连线；④ 连线后立即 `pipeline.get` + `execute` 验证**，对照该 README 的"验证要点"确认这一层对了，再做下一个电池。
>
> 端口语义已用 `scene:templates.get` 复核（JSON 真相源）。实例化用 `scene:pipeline.instantiateTemplate`，返回**全新运行时 groupId**，连线一律用返回值，不要硬编下表的库 id。
>
> **两条等价通路 + 读回验证**：每个 template 的 README 都同时给出 **`scene:*` 工具通路（applyBatch / instantiateTemplate）与 CLI 通路（`forgeax node create-template` / `node create` / `node connect`）两种等价写法**（底层同一套 op、落到同一张 graph.json，效果可互验）；并在「验证要点」里给出如何用 **`pipeline execute | jq '.result.outputs["<G>"]["out_N"]...'`** 像 grep 一样读回某个输出端口的内容来核对该层（⚠️ 整图 outputs 可达约 28MB，**务必 jq 投影到具体端口、勿整体打印**）。详见各 README 的「等价 CLI 写法」与「读回端口内容验证」小节。

## 总表

| 模板组 | templateId | 一句话功能 | 主要可见 IN | 主要 OUT | 典型管线位置 | 详细文档 |
|---|---|---|---|---|---|---|
| **AddBaseGrid**<br>基础网格区域 | `group_1781266146700_dm7xl` | **场景起点：加基础网格区域**（确立尺寸/底图） | `in_0`RootScene / `in_1`BaseName / `in_2`Width / `in_3`Height / `in_4`BaseAsset | `out_1`BaseNode / `out_2`RootScene | **最起点（空场景 `empty_scene` 之后）** | [README](./AddBaseGrid/README.md) |
| **ArchitectureRegions**<br>建筑区域 | `group_1781234452470_mzjv4` | 在场景里划建筑用地 | `in_0`场景 / `in_1`Seed / `in_2`期望建筑数 / `in_3`地面资产名 | `out_0`建筑 / `out_2`Rest | 第 1 环（紧接 AddBaseGrid 的 BaseNode） | [README](./ArchitectureRegions/README.md) |
| **ArchitectureStructures**<br>建筑结构 | `group_1781235844604_rzrp9` | 在建筑区域里生成墙体/房间 | `in_0`建筑区域 / `in_1`墙体资产名 / `in_2`Seed | `out_0`结构化建筑 / `out_1`房间 | 建筑层第 2 级（可选） | [README](./ArchitectureStructures/README.md) |
| **PathConnection**<br>道路连接 | `group_1781236103740_crshq` | 在 POI(建筑)间连通道路 | `in_0`POI焦点 / `in_1`上游空间 / `in_2`道路资产名（无Seed） | `out_0`道路 / `out_1`Non-Path(剩余) | 建筑之后、自然地物之前 | [README](./PathConnection/README.md) |
| **LakeRegions**<br>湖泊区域 | `group_1781238394903_rz71v` | 在剩余空地挖湖 | `in_0`场景 / `in_1`期望湖数 / `in_2`湖资产名 / `in_3`Seed | `out_0`湖 / `out_1`Rest | 自然地物层 | [README](./LakeRegions/README.md) |
| **FarmlandRegions**<br>农田区域 | `group_1781239001217_9be7r` | 在剩余空地生成农田+作物 | `in_0`场景 / `in_1`期望农田数 / `in_2`田资产名 / `in_3`作物资产名 / `in_4`Seed / `in_5`作物密度 | `out_0`农田 / `out_1`Rest | 自然地物层 | [README](./FarmlandRegions/README.md) |
| **RandomNaturalDecoration**<br>自然随机装饰 | `group_1781239444306_uz0oe` | 在剩余空地撒树木/装饰 | `in_0`场景 / `in_1`植被资产名 / `in_2`Seed / `in_3`密度 | `out_0`装饰 / `out_3`Rest | 链路最后一环 | [README](./RandomNaturalDecoration/README.md) |

> 所有模板组其余 `in_X` 端口都是 `[hidden]` 高级调参（尺寸/密度/门窗/田埂等），**默认即可、日常不接**；细节见各 README。

> ⚠️ **每个组的必接 `in_0` / POI 端口若悬空会"静默空跑"**：该组不产任何输出（`outputs/` 下连本组目录都没有）、其资产名也不出现在最终 `names`/`layers` 里，**但整图 `execute` 仍报 `completed`、不报任何错**（`tree_merge`/`scene_output` 不校验各 item 非空）。**所以 `completed` ≠ 每个组都成功。** 最易踩：**PathConnection 的 `in_0`（POI 焦点，必接 `ArchitectureRegions.out_0` 建筑）**——悬空则道路整组空跑，且把下游（接它 `out_1` 的装饰/湖/田组）连带带空。每加一组后必须**逐组**确认本组 `outputs/<组>/` 目录存在、输出端口非空、资产名出现在 `names` 里（见各 README「验证要点」）。

## 链式串联范式（速记）

- **强制起手式（场景起点）**：**`empty_scene` → `AddBaseGrid`**。从空场景电池出发，第一步用 `AddBaseGrid` 加一个基础网格区域（给 BaseName + Width/Height + 可选 BaseAsset），确立场景尺寸与底图；拿到 **`AddBaseGrid.out_1`（BaseNode，focus 已聚焦）作为后续所有模板组的上游起点**。
  - `empty_scene.scene` → `AddBaseGrid.in_0`（RootScene）
  - `AddBaseGrid.out_1`（BaseNode） → 第一个后续组（如 ArchitectureRegions）的 `in_0`——**后续不再用空根，一律从 BaseNode 出发**。
  - **多区域拼接**：用多个 `AddBaseGrid`，前一块 `out_2`（RootScene） → 下一块 `AddBaseGrid.in_0`，各块各产一个 BaseNode 作为不同区域的挂接点；最后一块的 `out_2` 承载整棵根，作最终汇总根场景。
- **Rest 链式**：起手之后，把上一组的"剩余/Rest/Non-Path"场景输出接到下一组 `in_0`，每层在前一步留下的空地上继续布置，互不覆盖。
  - `ArchitectureRegions.out_0`(Buildings) →（道路）`PathConnection.in_0`（**POI 焦点，必接！悬空则道路整组空跑**）。**简化档**连建筑轮廓够用但糙；**进阶档**（Example1 实证）用 `scene_focus_path` 把 POI 精确聚焦到每栋楼的 `outer_door`（门）子节点再接 `in_0`，道路从门口自然连出——见 `PathConnection/README.md`「POI 的进阶用法（连门而非连楼）」。
  - `ArchitectureRegions.out_2` →（道路）`PathConnection.in_1`（上游空间）
  - `PathConnection.out_1`(Non-Path) →（湖）`LakeRegions.in_0`
  - `LakeRegions.out_1` →（农田）`FarmlandRegions.in_0`
  - `FarmlandRegions.out_1` →（植被）`RandomNaturalDecoration.in_0`
- **统一种子**：单个 `seed_control.seed` 扇出到每组的 Seed 输入（verified-town seed=42）。PathConnection 无 Seed。
- **资产名 = 图层名**：每组的资产名 `text_panel` 文本**就是最终渲染图层的语义名**（实测 road 层名是中文 `石路`、植被是 `树`）。想要哪种语义直接写文本。
- **汇总输出**：每组主产物 `out_0` → `tree_merge.item_N`（`tree_merge` 必带 `params {inferredAccess:"tree",inferredType:"scene",portCount:6}`）→ `tree_flatten.tree` → `scene_merge_subtrees.scenes` → `scene_output.scene`。
- **精确操作子区域（别只会整组传递）**：模板组负责**批量生成**，要"只对某栋建筑 / 某个门 / 某类子节点"操作时，用白名单里的**查询/分析电池**先精确定位再单独处理——`scene_focus_path`（按已知路径聚焦单点）、`scene_focus_children`（遍历某节点的所有子区域）、`node_explode`（检视节点内部子节点/体素）、`scene_get_attribute`（读节点属性），配合 `string_concat` 拼路径、`ArchitectureRegions.out_1`(BuildingPath)/`out_4`(RestPath) 等路径句柄。范式：**拿父节点路径句柄 → `string_concat` 拼子区域名（如 `/outer_door`）→ `scene_focus_path` 聚焦 → 对该子区域操作**（Example1 的"门→道路"即此范式）。详见 `skills/compose-sino-scene/SKILL.md`「善用场景查询/分析节点，精确操作子区域」。

## 实证推荐值速查（来自 Example1 / verified-town，可直接采用）

| 参数 | 推荐值 | 来源 |
|---|---|---|
| AddBaseGrid 基础网格 Width/Height | 50（verified-town）/ 73（Example1） | 实证 |
| AddBaseGrid BaseName / BaseAsset | `ground` / `grassland`（按区域语义命名） | 推荐 |
| ArchitectureRegions 期望建筑数 | 8（安静）/ 12~18（热闹街区） | Example1=8, verified=8 |
| LakeRegions 期望湖泊数 | 3 | Example1 |
| FarmlandRegions 期望农田数 | 2 | Example1 |
| FarmlandRegions 作物密度 | 0.9 | Example1 |
| RandomNaturalDecoration 密度 | 0.05（约 73 棵树）；茂密 0.1~0.3 | Example1 / verified |
| 统一 seed | 42 | verified-town |

## 三通路等价 + CLI 命令 + 读回端口内容

> **内核等价性**：UI 拖拽 / CLI（`forgeax`）/ `scene:*` 工具三条通路，底层都归一为**同一套基本 op**（`createNode`/`connect`/`updateNode`/…）经 applyBatch 落到同一张 `graph.json`。所以 AI 用 CLI 或工具做的任何放置/连线/改参，都会**精确、确定地反映到画布**（人在 UI 看到的就是 AI 操作的结果），读回也一致。这保证 AI 行为可被人在画布验证、可被 jq 精确审查。

### CLI 已实现命令（forgeax，权威，以 `node-runtime-cli/src/index.ts` 为准）

定位参数（三选一）：`--project-id <id> --project-root <ws>` ｜ `--graph-file <path>` ｜ `--pipeline-id <id> --project-root <ws>`；运行 op 类命令再加 `--batteries <dir>`。输出默认 JSON，加 `--ndjson` 出流式。

| 操作 | CLI 命令 | 等价 op |
|---|---|---|
| 放置普通电池 | `forgeax node create --node-id <id> --op <opId> --params '<json>' --x <n> --y <n>` | `createNode` |
| 放置模板组（成组电池） | `forgeax node create-template --group-file <NodeGroup.json> --group-id <id> --x --y` | 一步实例化整组 |
| 连线 | `forgeax node connect --edge-id <id> --from <node:port> --to <node:port>` | `connect` |
| 改参数/位置 | `forgeax node update --node-id <id> --params '<json>' [--x --y]` | `updateNode`（只合并 params） |
| 删节点 / 删边 | `forgeax node delete --node-id <id>` / `forgeax node disconnect --edge-id <id>` | `deleteNode` / `disconnect` |
| 批量 op | `forgeax pipeline apply --ops '<JSON array of ops>'` | 同 `scene:pipeline.applyBatch` schema |
| 读图结构 | `forgeax pipeline get` | 返回顶层 nodes/edges + groups（可断言 `__group__`/嵌套组/exposed 连边） |
| 执行 | `forgeax pipeline execute [--node <id>]` | 省略 `--node` 跑整图；带 `--node` 只跑该节点上游闭包 |
| 导入整图 | `forgeax pipeline import --file <path> [--mode replace\|merge] [--remap] [--execute none\|downstream\|full]` | — |
| 项目 | `forgeax project list\|create\|open\|delete`（create 需 `--name`） | — |

> **未实现（会抛错，勿用）**：`pipeline list`、`node list`、`asset *`、`path-slot *`、`history *`。CLI README 里的 `node list --type` 等是 stub 阶段画饼，实际未实现。

### 像 grep 一样查"某节点某输出端口的内容"（标准做法）

**没有专门的"读端口"命令**；标准做法是 **`execute` 后用 jq 把 `result.outputs` 投影到 `节点.端口`**：

- `pipeline execute` 返回 `{ executionId, status, outputs }`；`outputs` 按 **nodeId** 键控，每节点是 `{ <portName>: <DataTree> }`，DataTree = `[{ "path":[...], "items":[...] }]`。
- `portType` 决定 `items` 形态：`number`→数值、`string`→字符串、`grid`→二维数组、`scene`→`{tree:{name,path,children,...}}`。要看"某端口预期什么格式"，查该端口的 portType 即可。

```bash
# CLI 通路：execute → jq 投影到 节点.端口
forgeax pipeline execute --batteries <BATT> <G> | jq '.result.outputs["<nodeId>"]["<portName>"]'
# 工具通路：同理对 scene:pipeline.execute 的返回投影
curl ... scene:pipeline.execute | jq '.result.outputs["<nodeId>"]["<portName>"]'
# scene 端口只取子节点名摘要（避免打印整棵树）
... | jq '.result.outputs["<groupId>"]["out_0"][].items[0].tree.children[].name'
```

实测样例（verified-town）：`outputs.name_panel.output` = `[{"path":[0],"items":["grassland"]}]`；`outputs.road_name.output` = `[{"path":[0],"items":["石路"]}]`；`outputs.grid.grid` = `[{"path":[0],"items":[[[1,1,…50×50…]]]}]`；`outputs.<groupId>.out_0` = scene 类型 DataTree。

> ⚠️ **绝不要整体打印 `outputs`**：整图 execute 的 outputs 可能极大（verified-town 实测约 **28MB**，含全 voxel 网格），会刷屏 / 爆上下文。**必须用 jq 投影到具体 `nodeId.portName`**，scene 端口只取 `.[].items[0].tree.children[].name` 之类摘要。

## 参考项目（只读，不要在里面改图）

- **verified-town** `p_mqasqhsf_cmb7xe`：草地+建筑+道路+植被全跑通，三层 execute 全 `completed` 零错误。
- **Example1** `p_mq6me0yg_0ewgrl`：完整休闲乡村，6 组全用。
- 读图：先 `scene:projects.open` 对应 id，再 `scene:pipeline.get`。
