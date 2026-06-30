# 场景模板组总览索引（TEMPLATES_INDEX）

> **这是 sino agent 用模板电池的第一步入口。** 工作流程：
> **① 先查这张总表**——根据需求定位要用哪几个 template 电池；
> **② 再去读对应电池的 `<Name>/README.md` 详细文档**；
> **③ 按 README 实例化 + 连线；④ 连线后立即 `pipeline.get` + `execute` 验证**。
>
> 若要理解「模板**内部**反复出现的固定子流程」（输入规范化、主/Rest 拆分、Path 句柄、嵌套子组等），见 **[TEMPLATE_PATTERNS.md](./TEMPLATE_PATTERNS.md)**。
>
> 端口语义以 `scene:templates.get` / 各 `README.md` 为准。实例化用 `scene:pipeline.instantiateTemplate`，返回**全新运行时 groupId**，连线一律用返回值，不要硬编下表的库 id。
>
> **当前发布版模板（以下 8 个）** 由 `batteries/groups/scene/` 同步而来；旧版 `ArchitectureRegions` / `ArchitectureStructures` / `FarmlandRegions` / `PointSampleBuilding` / `RandomNaturalDecoration` 已移除。

## 总表

| 模板组 | templateId | 一句话功能 | 主要可见 IN | 主要 OUT | 典型管线位置 | 详细文档 |
|---|---|---|---|---|---|---|
| **AddBaseGrid**<br>基础网格 | `group_1781266146700_dm7xl` | 场景起点：加基础网格区域 | `in_0`RootScene / `in_1`BaseName / `in_2`Width / `in_3`Height / `in_4`BaseAsset | `out_1`BaseNode / `out_2`RootScene | **最起点** | [README](./AddBaseGrid/README.md) |
| **PickOneBuilding**<br>单点建筑 | `group_1781806910509_ac8a1` | 在指定坐标放**一栋**建筑 | `in_3`Point / `in_1`Scene / `in_5`Width / `in_6`Height / `in_4`BuildingAsset | `out_1`Building / `out_3`BuildingPath / `out_2`Rest | 建筑层（单栋） | [README](./PickOneBuilding/README.md) |
| **PickMultiBuildings**<br>多点建筑 | `group_1781857569273_sw86m` | 一次放**多栋**建筑 | `in_6`Scene / `in_5`points / `in_0`Widths / `in_1`Heights / `in_4`Assets | `out_2`Buildings / `out_1`Rest | 建筑层（多栋/村庄） | [README](./PickMultiBuildings/README.md) |
| **BuildingStructures**<br>建筑结构 | `group_1781831816652_3k380` | 在建筑区域上盖墙/房间（含门） | `in_0`Scene / `in_23`WallAsset / `in_24`Seed | `out_0`Scene / `out_1`Rooms | 建筑层（结构细化） | [README](./BuildingStructures/README.md) |
| **PathConnection**<br>道路连接 | `group_1781857907971_zblc6` | POI 点集一次连通道路 | `in_3`POI列表 / `in_2`Scene / `in_1`RoadAsset | `out_1`Path / `out_2`Rest | 道路层 | [README](./PathConnection/README.md) |
| **NaturalDecorationDistribution**<br>自然装饰 | `group_1782117984754_5oqi1` | 在空地撒植被/装饰 | `in_1`Scene / `in_5`AssetName / `in_2`Density / `in_3`seed | `out_1`Decoration / `out_2`Rest | 自然地物层（随机散布） | [README](./NaturalDecorationDistribution/README.md) |
| **PlaceOneDecoration**<br>单点装饰 | `group_1783000010000_p1dec` | 在参考点附近**精准**放单个装饰物 | `in_1`Scene / `in_3`Point / `in_5`FootprintW / `in_6`FootprintH / `in_2`Height / `in_4`Asset | `out_1`Decoration / `out_2`Rest / `out_3`DecorationPath | 自然地物层（精准点位） | [README](./PlaceOneDecoration/README.md) |
| **LakeRegions**<br>湖泊 | `group_1782133925585_686y2` | 在剩余空地挖湖 | `in_1`Scene / `in_2`Points / `in_14`AssetName / `in_17`seed | `out_4`Lake / `out_0`Rest | 自然地物层 | [README](./LakeRegions/README.md) |

> 所有模板组其余 `in_*` 多为 `[hidden]` 高级调参，默认即可；细节见各 README 或 `scene:templates.get`。

> ⚠️ **必接 scene 端口悬空会「静默空跑」**：该组不产输出、`execute` 仍 `completed`。典型：`PathConnection` 的 POI(`in_3`) 或 `NaturalDecorationDistribution.in_1` 未接有效上游 scene。

## 链式串联范式（速记）

- **起手**：`empty_scene` → **`AddBaseGrid`** → `out_1`(BaseNode) 作为后续 `in_0`/`in_1` Scene 起点。
- **建筑**：`PickOneBuilding`（单栋）或 `PickMultiBuildings`（多栋）；多栋用 **`out_1`(Rest) → 下一组 `in_6`(Scene)** 串联。
- **结构（可选）**：`Building.out_*` → **`BuildingStructures.in_0`** → `out_0` 供道路 POI / 门路径聚焦。
- **道路**：**单个** `PathConnection` — 上一组 **Rest** → `in_2`；多个 `manual_points` → `tree_merge`(`inferredAccess:"item"`) → `in_3`(POI 列表)。
- **装饰 / 湖**：上一组 **Rest** → `NaturalDecorationDistribution.in_1`（随机散布）或 **`PlaceOneDecoration.in_1`**（精准单点，可 `out_2`→下一实例串联）→ `LakeRegions.in_1`（顺序可按需求调整）。
- **汇总**：各组主产物 `out_*` → `tree_merge` → `tree_flatten` → `scene_merge_subtrees` → `scene_output`。
- **统一种子**：`seed_control.seed` 扇出到各组 Seed 输入。

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

> ⚠️ **绝不要整体打印 `outputs`**：整图 execute 的 outputs 可能极大，会刷屏 / 爆上下文。**必须用 jq 投影到具体 `nodeId.portName`**。

## 参考项目（只读，不要在里面改图）

- **verified-town** `p_mqasqhsf_cmb7xe`：草地+建筑+道路+植被全跑通。
- **Example1** `p_mq6me0yg_0ewgrl`：完整休闲乡村（旧模板 id，读图时注意与上表 templateId 可能不同）。
- 读图：先 `scene:projects.open` 对应 id，再 `scene:pipeline.get`。
