---
name: compose-sino-scene
description: >-
  Compose a full Scene Generator scene for the Sino agent using ONLY the 6
  prebuilt scene template groups plus a small whitelist of utility batteries.
  Use when Sino is asked to lay out / build / iterate a scene (buildings, roads,
  lakes, farmland, natural decoration) in wb-scene-generator. Sino must never
  introduce batteries outside the whitelist below.
---

# Compose Sino Scene

Sino 的成体系构图向导。Sino 是**场景构图师**：只用 6 个预制场景模板组 + 少量白名单工具电池，把一张完整场景拼出来、跑出来、截图迭代。

> 两条等价构图通路：**`scene:*` 工具通路（applyBatch / instantiateTemplate）**（运行时 / 在画布上实时构图，本文主线）与 **CLI 通路（`forgeax` 命令）**（headless / 脚本化构图，见末尾「CLI 通路」一节）。两者最终写的是同一张图，端口契约一致。实例化模板组时**首选 `scene:pipeline.instantiateTemplate`（工具通路）/ `node create-template`（CLI 通路）**，一步到位、自动重映射，比手工 createNode+connect+createGroup 展开更省事、更稳。

## ⚠️ 强制铁律（动手前必读，违反必踩坑）

> **下面每一条都是已在生产里付出过血泪代价、并已为你验证过的硬规则。动手前先把这一节扫一遍、背下来。**
> **严禁在生产会话里靠反复试错去"重新发现"这些规则——文档已经替你试过了，照做即可，不要再在现场现学现卖、不要再臆测别的"限制"。**

1. **connect 必带唯一 `edgeId`**（字段名就是 `edgeId`，**不是** `id`）。每条 `connect` op 都**必须**带一个**全图唯一**的 `edgeId`。
   - ✅ 正例：`{"type":"connect","edgeId":"e_unique","source":{"nodeId":"a","port":"out_0"},"target":{"nodeId":"b","port":"in_0"}}`
   - ❌ 反例：漏 `edgeId` ／ 写成 `"id":"e1"`（`id` 会被忽略）→ 边以 key=`undefined` 落盘，第二条边立刻报 **`edge undefined already exists`**。
   - **这不是"一批不能连多条边"、也不是"一个节点只能收一条边"——纯粹是你漏了 `edgeId`。** 一批里连任意多条边、任意多条边连进同一个节点都没问题，**只要每条 `edgeId` 唯一**。（示例见下文第 67、107-116 行，每条 connect 都带了 `edgeId`。）

2. **applyBatch 之后必 `pipeline.get` 核对**。`applyBatch` 返回 ok / hash 变化**都可能是"ok 却空"**：整批因某个 op 失败被原子回滚、或某 op 的 `type`/字段拼错被内核静默忽略，节点根本没进图。**必须**紧跟 `scene:pipeline.get` 确认 nodes/edges 真的进图了，再往下做。（详见「op schema 速查」「分批增量构图」。）

3. **`scene:pipeline.execute` 现在默认就返回轻量摘要,可放心整图 execute 看摘要验证每组是否产出**。工具适配层已把全量 `ExecutionResult` 投影成 KB 级摘要再返回给 AI（实测 ~28MB 全量 → ~27KB 摘要）：顶层保留 `status`/`error`/`durationMs` 原样，`outputs[nodeId][portId]` 投影成 `{branchCount, itemCount, totalCellCount, items:[{focus, tree:{childNames, descendantNames, cellCount, subtreeCellCount, ...}}]}`——**保留各端口的 children 名/descendant 资产名 + cell 计数**（sino 验证"某组是否产出、资产名对不对"的关键），但**不含全量 voxel cells**。所以**整图 `execute`（不带 nodeId）看摘要就能逐组验证**，不会再爆上下文。仅在**极少数**确需看原始 cells 时才传 `{ raw: true }` 拿全量（体积巨大，谨慎）。后端 REST 路由 `/api/v1/execute` 仍返回全量不变（供 UI / jq 投影等非 agent 调用方）。

4. **PathConnection 的 `in_0`（POI 焦点）必接，默认走进阶档（提取门）**。`in_0`=POI 是 PathConnection 的**必接**输入，**悬空会让道路静默不生成**（`execute` 仍返回 `completed`，极具欺骗性，还会连带把下游组带空）。
   - **默认（进阶档，还原 Example1）**：先加 ArchitectureStructures，再用 `BuildingPath` + `string_concat` 拼 `/outer_door` → `scene_focus_path` 提取门 → 作 POI 接 `in_0`，道路从门口自然连出。`in_1`（上游空间）另接 `ArchitectureRegions.out_2`(Rest)——**`in_0` 与 `in_1` 是两个不同来源，绝不能都接同一个 `out_0`。**（写法见 Step 3、`PathConnection/README.md`「POI 的进阶用法」与下文「善用场景查询/分析节点」「链式串联范式」。）
   - **简化档（最低限度兜底）**：仅当管线里**没有 ArchitectureStructures、没有门可提取**时，才退回把建筑 `ArchitectureRegions.out_0`(Buildings) 直接接 `in_0`（道路贴楼边走，糙）。不要因为它"省事"就默认用它。

5. **🚫 门路径前缀必须来自 `ArchitectureRegions.out_1`(BuildingPath) 运行时句柄，绝对禁止用 AddBaseGrid 的 BaseName 去猜路径**。拼门路径时，`string_concat.a` 必须接 `ArchitectureRegions.out_1`(BuildingPath)——这是个**运行时动态字符串句柄**（值形如 `/architecture_0`），**不是** BaseName、**不可凭 BaseName 推**。**严禁**用 AddBaseGrid 的 BaseName（如 `"block"`/`"ground"`）去拼/猜门路径。写死 `/block/outer_door` 这类绝对路径 **100% 会 focus 失败**（tree 里根本没有这条路径），随后 POI 链报错——而**正确反应是修路径写法（改用 BuildingPath 句柄），不是放弃 focus、把整张结构场景直接当 POI**（那是粗糙降级，会让 explode 范围错、门口提取失真，违背 Example1 范式）。
   - ❌ **错**：`string_concat.b="/block/outer_door"`（用 BaseName "block" 猜的绝对路径），或 `scene_focus_path.path="/block/outer_door"`（写死整条路径）。
   - ✅ **对**：`string_concat.a ← ArchitectureRegions.out_1`(BuildingPath 句柄)、`string_concat.b="/outer_door"`、`string_concat.result → scene_focus_path.path`、`scene_focus_path.scene ← ArchitectureStructures.out_0`（带门的结构场景）。
   - **focus 这步不能省**：focus 失败 99% 是路径写法错（用了 BaseName 猜的绝对路径），修路径而不是绕过。坚持走 `BuildingPath → string_concat → scene_focus_path` 的进阶链。
   - **不确定门子节点名时不要猜**：用 `scene_focus_children` / `scene_get_attribute`（或 `node_explode`）在结构产物（`ArchitectureStructures.out_0`）上**探查真实子节点名**，拿到真名再 `string_concat` 拼路径——而不是凭印象写 `/outer_door` 之外的猜测段。

6. **合法 `op.type` 白名单**：只有 `createNode` / `updateNode` / `deleteNode` / `connect` / `disconnect` / `createGroup` / `updateGroup` / `deleteGroup` / `ungroup` / `setMetadata`。**没有 `addNode`、没有 `addEdge`。** type 写错会被内核静默忽略（→ 铁律2 的"ok 却空"）。

7. **instantiateTemplate 返回的真实 `groupId` 必须用回**：每次实例化模板组都返回一个**全新的运行时 `groupId`**，后续所有连线一律用**返回的那个真实 id**，不要用库 templateId、也不要用记忆里的旧 id 硬编。**一批只实例化/接入一个模板组**（见「分批增量构图」），不要一批塞多个。

> 以上每条都**不要在生产时重新试探验证**——文档已为你验证过。把它们当 checklist：连图前默背 → connect 带唯一 `edgeId` → applyBatch 后 `pipeline.get` → `execute` 默认看摘要逐组验证（`status` + 各端口 children/资产名/cell 数） → PathConnection `in_0` 接上 → **门路径用 `ArchitectureRegions.out_1`(BuildingPath) 句柄拼，绝不用 BaseName 猜**。下面正文是这些铁律的展开与背景，需要细节时再查对应章节。

## 验证场景输出：只用 CLI/jq 提取关键信息，绝不读整棵场景（最高优先级铁律）

**验证一个输出场景节点时，绝不直接看整张场景图、也绝不回读整棵场景 DataTree——voxel cell 会瞬间撑满上下文（单个端口落盘就可达 1.7MB，整图 `execute` 输出可达 ~28MB）。必须用 CLI/jq 只投影出关键信息来判断。** 实测可用的三条标准提取手法（先 `execute`，再对 `result.outputs` 或落盘的 `outputs/<节点>/<端口>.json` 投影）：

```bash
# 1) 这个节点/端口产出了哪些子节点？（只取名字，不取 cell）——判断"这组到底生成了什么"的主手段
jq '[.. | objects | select(has("name") and has("path")) | .name] | unique' <端口>.json
#   预期：名字数组，如 ["block_ground","architecture_0","architecture_1","rest"]
# 2) cell 数量（只计数，绝不打印 cell 本身）——确认非空 / 规模量级
jq '[.. | objects | select(has("cells")) | .cells | length] | add' <端口>.json
#   预期：一个整数，如 1600
# 3) 最终场景的资产名清单——最干净的"每个模板组是否成功"判据
jq -r '.data[0].items[0][] | "\(.type)\t\(.name)"' outputs/out/names.json | sort | uniq -c
#   预期：type+name 计数表。某模板组成功 = 它的资产名真的出现在表里（道路成功→有"石路"，装饰成功→有"行道树"）
# 工具通路同理：execute 返回值用 jq 投影到具体节点/端口，再取 .[].items[0].tree.children[].name；绝不整体打印 outputs
... scene:pipeline.execute | jq '.result.outputs["<节点>"]["<端口>"][].items[0].tree.children[].name'
```

> ⚠️⚠️ **铁律：`execute` 返回 `completed` ≠ 每个模板组都成功** ⚠️⚠️
> `tree_merge`/`scene_output` **不校验**各 item 端口是否非空，某模板组若**必接端口悬空**（最典型：**PathConnection 的 `in_0`=POI 焦点没接建筑**），该组会**静默空跑**：不产任何输出（`outputs/` 下连本组目录都没有）、其资产名也不出现在最终 `names`/`layers` 里、且会把接它输出的下游组（如装饰/湖/田）**连带带空**——但整图照样返回 `status:completed`、不报任何错。**只看 status / 只看"applyBatch ok"会被彻底骗过。**
>
> 因此**每加一个模板组后，必须逐组验证该组真的产出了内容**，三步缺一不可：
>
> ```bash
> # ① pipeline.get 确认该组所有必接 in 端口都连上（尤其 PathConnection.in_0=POI）
> #    列出本组所有入边，逐一核对 in_0/in_1/... 都有 source（in_0 缺失 = POI 悬空）
> ... scene:pipeline.get | jq '.edges[]? | select(.target.nodeId=="<G>") | "\(.target.port) <- \(.source.nodeId):\(.source.port)"'
> #    PathConnection 预期必须看到 in_0 有入边：进阶档 in_0 <- <focus_door>:scene（POI=门）；简化档 in_0 <- <G_ARCH>:out_0（POI=建筑）。in_1 <- <G_ARCH>:out_2（上游空间，与 in_0 不同源）、in_2 <- 道路名panel
>
> # ② execute 后读该组自己的输出端口，确认非空（不是空树）
> ... scene:pipeline.execute | jq '.result.outputs["<G>"]["out_0"][].items[0].tree.children[].name'
> #    落盘核对同理：本组目录必须存在（空跑时根本不生成）
> ls outputs/<G>/ 2>/dev/null || echo "❌ 本组无输出 = 空跑(查必接 in 端口/POI)"
>
> # ③ 最终 names 表里该组的资产名真的出现了（最干净判据：道路→"石路"、装饰→"行道树"）
> jq -r '.data[0].items[0][] | "\(.type)\t\(.name)"' outputs/out/names.json | sort | uniq -c
> ```
>
> 三者齐了（in 端口都接上 + 本组 out 非空 + names 里有该组资产名）才算这组成功。**反例**：crowded-block（`p_mqax7pj3_eaa3by`）的 PathConnection `in_0`(POI) 悬空 → `outputs/paths/` 不存在、`names` 无"石路"、下游 natdec 连带无"行道树"，但整图仍 `completed`——典型"completed 却空跑"。

## op schema 速查（动手前必读，最高优先级）

`applyBatch` 的每个 op 的字段格式是**固定的**，写错内核会**静默忽略**——`applyBatch` 照样返回 ok、hash 也会变，但节点根本没进图（"ok 却空"）。**不要凭直觉猜字段名。** 常见致命错误：用 `{"op":"addNode","type":...,"id":...}` ❌（这是错的，内核完全不认）。

正确格式（判别字段是 `type`，节点 id 字段是 `nodeId`，电池类型字段是 `opId`）：

```jsonc
// 建节点：type=createNode，nodeId=你起的唯一 id，opId=电池类型，position 必带
{ "type":"createNode", "nodeId":"seed", "opId":"seed_control", "position":{"x":0,"y":0}, "params":{} }
// 连边：type=connect，source/target 都是 {nodeId, port}
{ "type":"connect", "edgeId":"e1", "source":{"nodeId":"seed","port":"seed"}, "target":{"nodeId":"merge","port":"item_0"} }
// 改参数：type=updateNode（只合并 params）
{ "type":"updateNode", "nodeId":"seed", "params":{"seed":12345} }
// 其余：deleteNode/disconnect/createGroup/updateGroup/deleteGroup/ungroup/setMetadata
```

合法 `type` 取值：`createNode`/`updateNode`/`deleteNode`/`connect`/`disconnect`/`createGroup`/`updateGroup`/`deleteGroup`/`ungroup`/`setMetadata`。**没有 `addNode`/`addEdge` 这种动词。** 每次 `applyBatch` 后**必须** `pipeline.get` 核对 nodes 真的多了——只看返回 ok 或 hash 变化会被骗。

> ⚠️ 提交大 JSON（含 `applyBatch.ops`）务必**先写进临时文件再 `curl --data @file`**，别把整段 JSON 塞进命令行 —— shell 转义会把 `nodeId`、数字等吃坏（实测踩过：`nodeId` 被转成 `0`）。

## 零试错确定性照抄序列（最高优先级 · 直接照抄填参数）

> 本节给一条**已实证可跑通**（verified-town `p_mqasqhsf_cmb7xe`，三层 execute 全部 `status:completed` 零错误）的严格 step 序列。**AI 只需：①填占位符参数 ②把每次 `instantiateTemplate` 返回的真实 `groupId` 替换进后续连边。不需要自己推导端口、不需要自己猜 op 写法。** 每个 step 后都 `pipeline.get` 核对节点/边数真的变了，再 `pipeline.execute` 验证 `status:completed`。
>
> 占位符约定：`<PID>`=项目 id；`<SEED>`=种子整数；`<GROUND>`/`<PATH>`/`<TREE>`=资产/语义名字符串；`<G_ARCH>`/`<G_PATH>`/`<G_DECO>`=各模板组 `instantiateTemplate` 返回的真实 groupId。

**强制顺序：先用 `empty_scene` → `AddBaseGrid` 建场景起点 → 再 `instantiateTemplate` 后续模板组 → 再连线。** 起点缺了，后续模板组拿不到上游会输出空。`instantiateTemplate` **不删**已有节点。

### Step 1 — 场景起点：empty_scene → AddBaseGrid（基础网格区域）

**新强制起手式**：从空场景电池 `empty_scene` 出发，第一步用 **AddBaseGrid 模板组**加一个基础网格区域（确立场景尺寸与底图），拿到它的 **`out_1`（BaseNode，focus 已聚焦）作为后续所有模板组的上游起点**。AddBaseGrid 是**模板组**，要走 `scene:pipeline.instantiateTemplate` / `node create-template` 实例化（同其它模板组），**不要手摆内部基础电池**（`rect_grid`/`grid2node` 等已封装在组内）。

1. `instantiateTemplate` `AddBaseGrid`（templateId `group_1781266146700_dm7xl`，也可用 basename）→ 拿回 `<G_BASE>`（`position` 如 `{"x":-900,"y":0}`）。
2. 建空场景源 + Width/Height/BaseName/BaseAsset 的 panel/const，连线（把 `<G_BASE>` 替换为返回的真实 groupId）：

```jsonc
// AddBaseGrid 模板组先用 instantiateTemplate 单独实例化（拿回 groupId=<G_BASE>），本 batch 建起点电池并连到它
{ "type":"createNode","nodeId":"empty",      "opId":"empty_scene", "position":{"x":-1300,"y":0},  "params":{} },                         // 空场景起点（无输入）
{ "type":"createNode","nodeId":"base_name",  "opId":"text_panel",  "position":{"x":-1300,"y":120},"params":{"text":"<BASE_NAME>"} },     // BaseName，如 "ground"
{ "type":"createNode","nodeId":"base_w",     "opId":"number_const","position":{"x":-1300,"y":240},"params":{"value":<W>} },              // Width，如 50
{ "type":"createNode","nodeId":"base_h",     "opId":"number_const","position":{"x":-1300,"y":360},"params":{"value":<H>} },              // Height，如 50
{ "type":"createNode","nodeId":"base_asset", "opId":"text_panel",  "position":{"x":-1300,"y":480},"params":{"text":"<BASE_ASSET>"} },    // BaseAsset 底图，如 "grassland"
// 汇总输出骨架 + 统一种子
{ "type":"createNode","nodeId":"seed_val",  "opId":"number_const","position":{"x":-1300,"y":600},"params":{"value":<SEED>} },
{ "type":"createNode","nodeId":"seed_main", "opId":"seed_control", "position":{"x":-1050,"y":600},"params":{} },
{ "type":"createNode","nodeId":"merge_all", "opId":"tree_merge",   "position":{"x":200,"y":0},   "params":{"inferredAccess":"tree","inferredType":"scene","portCount":6} },
{ "type":"createNode","nodeId":"flatten_all","opId":"tree_flatten","position":{"x":450,"y":0},  "params":{} },
{ "type":"createNode","nodeId":"merge_sub", "opId":"scene_merge_subtrees","position":{"x":700,"y":0},"params":{} },
{ "type":"createNode","nodeId":"out",       "opId":"scene_output", "position":{"x":950,"y":0},   "params":{} },
// 空场景 → AddBaseGrid：in_0=RootScene；in_1=BaseName；in_2/in_3=Width/Height；in_4=BaseAsset
{ "type":"connect","edgeId":"e_bg_scene","source":{"nodeId":"empty","port":"scene"},       "target":{"nodeId":"<G_BASE>","port":"in_0"} },
{ "type":"connect","edgeId":"e_bg_name", "source":{"nodeId":"base_name","port":"output"},  "target":{"nodeId":"<G_BASE>","port":"in_1"} },
{ "type":"connect","edgeId":"e_bg_w",    "source":{"nodeId":"base_w","port":"value"},      "target":{"nodeId":"<G_BASE>","port":"in_2"} },
{ "type":"connect","edgeId":"e_bg_h",    "source":{"nodeId":"base_h","port":"value"},      "target":{"nodeId":"<G_BASE>","port":"in_3"} },
{ "type":"connect","edgeId":"e_bg_asset","source":{"nodeId":"base_asset","port":"output"},"target":{"nodeId":"<G_BASE>","port":"in_4"} },
{ "type":"connect","edgeId":"e_seedval", "source":{"nodeId":"seed_val","port":"value"},    "target":{"nodeId":"seed_main","port":"seed"} },
// 汇总输出链
{ "type":"connect","edgeId":"e_merge_flat","source":{"nodeId":"merge_all","port":"tree"}, "target":{"nodeId":"flatten_all","port":"tree"} },
{ "type":"connect","edgeId":"e_flat_sub",  "source":{"nodeId":"flatten_all","port":"tree"},"target":{"nodeId":"merge_sub","port":"scenes"} },
{ "type":"connect","edgeId":"e_sub_out",   "source":{"nodeId":"merge_sub","port":"scene"},"target":{"nodeId":"out","port":"scene"} }
```

> **`<G_BASE>.out_1`（BaseNode，focus 已聚焦的基础网格节点）即所有后续模板组的最初上游**——后续组的 `in_0` 一律接它（而非空根）。整棵根场景的最终汇总用 `<G_BASE>.out_2`（RootScene） → `merge_all.item_N`。多区域拼接时用多个 AddBaseGrid，前一块 `out_2` 接下一块 `in_0`。`text_panel` 输出端口名是 **`output`**，`number_const` 是 **`value`**，`seed_control` 是 **`seed`**，`empty_scene` 是 **`scene`**。提交后 `pipeline.get` 核对节点/边数；`execute` 应 `completed`，BaseNode 子树里出现以 BaseName 命名、带 BaseAsset tile 的基础网格节点。
>
> ### 等价 CLI 起手写法（forgeax，headless）
>
> ```bash
> # 实例化 AddBaseGrid 模板组
> forgeax node create-template --group-file $TMPL/AddBaseGrid/AddBaseGrid.json --group-id base --x -900 --y 0 $G
> # 建空场景源 + panel/const
> forgeax node create --node-id empty      --op empty_scene  --params '{}'                    --x -1300 --y 0   $G --batteries $BATT
> forgeax node create --node-id base_name  --op text_panel   --params '{"text":"ground"}'     --x -1300 --y 120 $G --batteries $BATT
> forgeax node create --node-id base_w     --op number_const --params '{"value":50}'          --x -1300 --y 240 $G --batteries $BATT
> forgeax node create --node-id base_h     --op number_const --params '{"value":50}'          --x -1300 --y 360 $G --batteries $BATT
> forgeax node create --node-id base_asset --op text_panel   --params '{"text":"grassland"}'  --x -1300 --y 480 $G --batteries $BATT
> # 连线：空场景 → AddBaseGrid
> forgeax node connect --edge-id e_bg_scene --from empty:scene       --to base:in_0 $G
> forgeax node connect --edge-id e_bg_name  --from base_name:output  --to base:in_1 $G
> forgeax node connect --edge-id e_bg_w     --from base_w:value      --to base:in_2 $G
> forgeax node connect --edge-id e_bg_h     --from base_h:value      --to base:in_3 $G
> forgeax node connect --edge-id e_bg_asset --from base_asset:output --to base:in_4 $G
> ```

### Step 2 — 建筑层 ArchitectureRegions

1. `instantiateTemplate` → 拿回 `<G_ARCH>`：

```json
{ "toolId":"scene:pipeline.instantiateTemplate","caller":{"kind":"user"},
  "args":{ "projectId":"<PID>", "templateId":"group_1781234452470_mzjv4", "position":{"x":-500,"y":0} } }
```

2. 建 panel + 连线（把 `<G_ARCH>` 替换为返回的真实 groupId）：

```jsonc
{ "type":"createNode","nodeId":"bld_count", "opId":"number_const","position":{"x":-900,"y":300},"params":{"value":<N_BUILDINGS>} },  // 如 8
{ "type":"createNode","nodeId":"floor_name","opId":"text_panel",  "position":{"x":-900,"y":420},"params":{"text":"<FLOOR>"} },        // 如 "floor"
// in_0 接基础网格起点 <G_BASE>.out_1（BaseNode），不再用空根
{ "type":"connect","edgeId":"e_ar_scene","source":{"nodeId":"<G_BASE>","port":"out_1"}, "target":{"nodeId":"<G_ARCH>","port":"in_0"} },
{ "type":"connect","edgeId":"e_ar_seed", "source":{"nodeId":"seed_main","port":"seed"},  "target":{"nodeId":"<G_ARCH>","port":"in_1"} },
{ "type":"connect","edgeId":"e_ar_cnt",  "source":{"nodeId":"bld_count","port":"value"},"target":{"nodeId":"<G_ARCH>","port":"in_2"} },
{ "type":"connect","edgeId":"e_ar_floor","source":{"nodeId":"floor_name","port":"output"},"target":{"nodeId":"<G_ARCH>","port":"in_3"} },
{ "type":"connect","edgeId":"e_ar_out0", "source":{"nodeId":"<G_ARCH>","port":"out_0"},  "target":{"nodeId":"merge_all","port":"item_0"} }
```

→ `pipeline.get`（应 13 节点 13 边）→ `execute`（`completed`，out.layers 含建筑 `floor` tiles + voxel-mass）。

### Step 2.5 — 建筑结构层 ArchitectureStructures（在 Buildings 上盖楼/起墙，**接 `out_0` 不接 Rest**）

> **要不要加这一层**：想要"道路从门口自然连出"的进阶 POI（提取 `outer_door` 门）就**必须**先加它（门子节点由本组生成）；纯体块建筑可跳过。**默认推荐加上**——它既细化建筑，又是进阶 POI 的前置。

1. `instantiateTemplate` `ArchitectureStructures`（templateId `group_1781235844604_rzrp9`）→ 拿回 `<G_STRU>`（`position` 如 `{"x":-500,"y":-400}`）。
2. 建 panel + 连线（把 `<G_STRU>` 替换为返回的真实 groupId）：

```jsonc
{ "type":"createNode","nodeId":"wall_name","opId":"text_panel","position":{"x":-900,"y":-400},"params":{"text":"<WALL>"} },  // 墙体资产名，如 "墙"
// ⚠️ in_0=【建筑区域 Buildings】接 ArchitectureRegions.out_0（绝不接 out_2(Rest)！建筑结构是在"建筑区域"上盖楼起墙，不是在剩余空地上）；in_1=WallAsset；in_2=Seed
{ "type":"connect","edgeId":"e_as_scene","source":{"nodeId":"<G_ARCH>","port":"out_0"},   "target":{"nodeId":"<G_STRU>","port":"in_0"} },
{ "type":"connect","edgeId":"e_as_wall", "source":{"nodeId":"wall_name","port":"output"}, "target":{"nodeId":"<G_STRU>","port":"in_1"} },
{ "type":"connect","edgeId":"e_as_seed", "source":{"nodeId":"seed_main","port":"seed"},   "target":{"nodeId":"<G_STRU>","port":"in_2"} },
{ "type":"connect","edgeId":"e_as_out0", "source":{"nodeId":"<G_STRU>","port":"out_0"},   "target":{"nodeId":"merge_all","port":"item_1"} }  // 主产物进汇总；后续 item 口顺延
```

> **接对象**：`in_0` ← `ArchitectureRegions.out_0`（**Buildings 建筑区域**），不是 `out_2`(Rest)。本组**没有 Rest 输出**，不消费空地——剩余空地的链式仍由 `ArchitectureRegions.out_2` 负责往下传。汇总时通常用结构化建筑 `out_0`（而非建筑区域 `out_0`，避免两层建筑叠加）。详见 `ArchitectureStructures/README.md`。
>
> → `pipeline.get`（确认 `in_0 <- <G_ARCH>:out_0`）→ `execute`（`completed`，建筑出现墙体分隔、内部生成 `outer_door` 门子节点）。

### Step 3 — 道路层 PathConnection（默认走进阶档：提取门作 POI）

1. `instantiateTemplate` `group_1781236103740_crshq` → 拿回 `<G_PATH>`（`position` 如 `{"x":-500,"y":600}`）。
2. 建 panel + 连线。

> **默认走进阶档（提取 `outer_door` 门作 POI）**：前置是已加 Step 2.5 的 ArchitectureStructures（门子节点由它生成）。`in_0`=POI 接"门"、`in_1`=上游空间接建筑 `out_2`(Rest)——**注意 `in_0` 与 `in_1` 是两个不同来源，绝不能都接同一个 `out_0`**。可直接照抄：

```jsonc
{ "type":"createNode","nodeId":"road_name", "opId":"text_panel",     "position":{"x":-900,"y":600},"params":{"text":"<PATH>"} },        // 道路资产名，如 "石路"
{ "type":"createNode","nodeId":"door_seg",  "opId":"text_panel",     "position":{"x":-900,"y":720},"params":{"text":"/outer_door"} },  // 门子节点名（带前导斜杠）
{ "type":"createNode","nodeId":"door_path", "opId":"string_concat",  "position":{"x":-650,"y":660},"params":{} },                      // 拼 BuildingPath + /outer_door
{ "type":"createNode","nodeId":"focus_door","opId":"scene_focus_path","position":{"x":-400,"y":660},"params":{} },                     // 在建筑结构场景里聚焦到门
// 拼门完整路径：a=BuildingPath(ArchitectureRegions.out_1 运行时句柄，值形如 /architecture_0)、b="/outer_door"，result=门路径
// 🚫 a 必须接 out_1(BuildingPath)；绝不能写死 a="/block/outer_door" 之类用 BaseName 猜的绝对路径——focus 必失败
{ "type":"connect","edgeId":"e_dp_a",    "source":{"nodeId":"<G_ARCH>","port":"out_1"},   "target":{"nodeId":"door_path","port":"a"} },
{ "type":"connect","edgeId":"e_dp_b",    "source":{"nodeId":"door_seg","port":"output"},  "target":{"nodeId":"door_path","port":"b"} },
// 在【建筑结构】场景(<G_STRU>.out_0，含 outer_door)里按门路径聚焦
{ "type":"connect","edgeId":"e_fd_scene","source":{"nodeId":"<G_STRU>","port":"out_0"},   "target":{"nodeId":"focus_door","port":"scene"} },
{ "type":"connect","edgeId":"e_fd_path", "source":{"nodeId":"door_path","port":"result"}, "target":{"nodeId":"focus_door","port":"path"} },
// in_0=POI【必接】= 聚焦到门的 scene（道路从门口连出）；in_1=上游空间接建筑剩余 out_2；in_2=道路名
{ "type":"connect","edgeId":"e_pc_focus","source":{"nodeId":"focus_door","port":"scene"}, "target":{"nodeId":"<G_PATH>","port":"in_0"} },
{ "type":"connect","edgeId":"e_pc_rest", "source":{"nodeId":"<G_ARCH>","port":"out_2"},   "target":{"nodeId":"<G_PATH>","port":"in_1"} },
{ "type":"connect","edgeId":"e_pc_name", "source":{"nodeId":"road_name","port":"output"}, "target":{"nodeId":"<G_PATH>","port":"in_2"} },
{ "type":"connect","edgeId":"e_pc_out0", "source":{"nodeId":"<G_PATH>","port":"out_0"},   "target":{"nodeId":"merge_all","port":"item_2"} }  // 后续 item 口顺延
```

→ `pipeline.get`（**务必确认 `in_0` 有入边**，且 `in_0` 接的是 `focus_door:scene` 而非建筑 `out_0`）→ `execute`（`completed`，out.layers 多出 1 个 `type:tile` 图层，名字 = `<PATH>`；**并确认 names 里真的出现 `<PATH>`，否则就是 in_0 漏接的空跑**）。
> **简化档（最低限度兜底，仅在没有建筑结构门时退而求其次）**：若管线里**没接 ArchitectureStructures**（没有 `outer_door` 门可提取），才退回直接把建筑 `out_0`(Buildings) 接 `in_0`(POI)、`out_2`(Rest) 接 `in_1`：
>
> ```jsonc
> { "type":"connect","edgeId":"e_pc_focus","source":{"nodeId":"<G_ARCH>","port":"out_0"}, "target":{"nodeId":"<G_PATH>","port":"in_0"} },  // POI=整栋建筑轮廓（糙）
> { "type":"connect","edgeId":"e_pc_rest", "source":{"nodeId":"<G_ARCH>","port":"out_2"}, "target":{"nodeId":"<G_PATH>","port":"in_1"} },  // 上游空间=建筑剩余
> ```
>
> 这只是兜底：道路贴楼边走、不从门口出。**`in_0`(POI) 这条边无论哪档都绝不能省**——悬空 = 道路整组静默空跑（且整图仍 `completed` 不报错）。**且 `in_0` 与 `in_1` 必须是不同来源（POI 门/建筑 vs 剩余空间），不要图省事把两口都接到同一个 `out_0`。**

### Step 4 — 植被层 RandomNaturalDecoration

1. `instantiateTemplate` `group_1781239444306_uz0oe` → 拿回 `<G_DECO>`（`position` 如 `{"x":-500,"y":1000}`）。
2. 建 panel + 连线：

```jsonc
{ "type":"createNode","nodeId":"tree_name",   "opId":"text_panel",  "position":{"x":-900,"y":1000},"params":{"text":"<TREE>"} },     // 如 "树"
{ "type":"createNode","nodeId":"deco_density","opId":"number_const","position":{"x":-900,"y":1120},"params":{"value":<DENSITY>} },  // 如 0.05
// in_0=剩余scene 接道路 out_1；in_1=植被资产名；in_2=seed；in_3=密度
{ "type":"connect","edgeId":"e_dec_name","source":{"nodeId":"tree_name","port":"output"},  "target":{"nodeId":"<G_DECO>","port":"in_1"} },
{ "type":"connect","edgeId":"e_dec_seed","source":{"nodeId":"seed_main","port":"seed"},    "target":{"nodeId":"<G_DECO>","port":"in_2"} },
{ "type":"connect","edgeId":"e_dec_dens","source":{"nodeId":"deco_density","port":"value"},"target":{"nodeId":"<G_DECO>","port":"in_3"} },
{ "type":"connect","edgeId":"e_dec_rest","source":{"nodeId":"<G_PATH>","port":"out_1"},    "target":{"nodeId":"<G_DECO>","port":"in_0"} },
{ "type":"connect","edgeId":"e_dec_out0","source":{"nodeId":"<G_DECO>","port":"out_0"},    "target":{"nodeId":"merge_all","port":"item_3"} }  // item 口接着 Path 顺延
```

→ `pipeline.get`（应 18 节点 22 边）→ `execute`（`completed`，out.layers 多出多个 `type:object` 图层，名字 = `<TREE>`，密度越大棵数越多）。

### Step 4b — 多品种植被链式散布（现生成贴图 + 独立 density · 2026-06-16 弯路固化）

> **适用**：草坪（AddBaseGrid + 现生成 tile）已铺好，要在上面撒 **多种** 现生成 object 植被，且**每种密度单独可调**。
> **不适用**：整镇构图里只有一种 `"树"` 点缀——继续用 Step 4 单组即可。

**铁律（违反必踩坑）**：

0. **贴图先于散布验收**：`in_1` 填的语义名（`grass_tuft`/`bush`/…）必须在 **`library.list` 已 published** 后再报场景完成。走 `/texture-pipeline` §0.2–§0.3 **批量 PART A 出图发布**；**禁止**只搭散布链等用户说「没有图」。
1. **`AddBaseGrid.out_1`（BaseNode）→ 第一组 `in_0`**。❌ 不是 `out_0`（裸 grid2node）、❌ 不是 `out_2`（RootScene/tree）。「在 base 上继续操作」= BaseNode。
2. **每品种一组**：每组 `in_1` 只接一个资产名；每组独立 `number_const` → `in_3`（density）。❌ 禁止 4 个名塞进一组 `in_1` 共用一个 density。
3. **链式 Rest**：`Dec_A.out_3` → `Dec_B.in_0` → …；后一种只往前面没占的格子上撒。
4. **汇总必须接 `out_0`（完整 scene）**：四组 **`out_0`** → `tree_merge` → `tree_flatten` → `scene_merge_subtrees` → `scene_output`。❌ **禁止**接 `out_2`（NaturalDec = 仅本组新撒的子树，merge 会缺累积层）。
5. **路径 `tree_N` 无害**：渲染匹配 **`asset_name` 属性**（ObjectAssetName 子组写入 = 契约/`publishToGame.assetName`），不是节点路径名。

占位：`<G_BASE>`=AddBaseGrid 组 id；`<G_GRASS>`/`<G_BUSH>`/…=各装饰组 id；密度示例 grass 0.15 / bush 0.12 / treeS 0.06 / treeB 0.03。

```jsonc
// 实例化 4 次 RandomNaturalDecoration → <G_GRASS> <G_BUSH> <G_TREES> <G_TREEB>
// 各建 name panel + density panel；seed_main 扇出 4 组 in_2

// 链：BaseNode → 第一组；Rest 串 Rest
{ "type":"connect","edgeId":"e_gr_in0",  "source":{"nodeId":"<G_BASE>","port":"out_1"}, "target":{"nodeId":"<G_GRASS>","port":"in_0"} },
{ "type":"connect","edgeId":"e_bu_in0",  "source":{"nodeId":"<G_GRASS>","port":"out_3"}, "target":{"nodeId":"<G_BUSH>","port":"in_0"} },
{ "type":"connect","edgeId":"e_ts_in0",  "source":{"nodeId":"<G_BUSH>","port":"out_3"},  "target":{"nodeId":"<G_TREES>","port":"in_0"} },
{ "type":"connect","edgeId":"e_tb_in0",  "source":{"nodeId":"<G_TREES>","port":"out_3"}, "target":{"nodeId":"<G_TREEB>","port":"in_0"} },

// 汇总：四路 out_0（完整 scene），不是 out_2
{ "type":"connect","edgeId":"e_mg0","source":{"nodeId":"<G_GRASS>","port":"out_0"},"target":{"nodeId":"merge_all","port":"item_0"} },
{ "type":"connect","edgeId":"e_mg1","source":{"nodeId":"<G_BUSH>","port":"out_0"}, "target":{"nodeId":"merge_all","port":"item_1"} },
{ "type":"connect","edgeId":"e_mg2","source":{"nodeId":"<G_TREES>","port":"out_0"},"target":{"nodeId":"merge_all","port":"item_2"} },
{ "type":"connect","edgeId":"e_mg3","source":{"nodeId":"<G_TREEB>","port":"out_0"}, "target":{"nodeId":"merge_all","port":"item_3"} }
// merge_all.tree → flatten_all → merge_sub → out（scene_output）
```

**execute 验证**：四组 `out_0` 的 `totalCellCount` 应**单调递增**（如 512→711→891→1059）；`scene_output` 层数 = 底图 + 全部植被实例。截图关时如实请用户在 Preview 确认贴图。

### 实证结果（verified-town，权威基线）

| 阶段 | 节点 | 边 | execute | out.layers 新增 |
|---|---|---|---|---|
| 骨架+建筑 | 13 | 13 | `completed` 零错误 | `floor` tile×4 + voxel-mass×4 |
| +道路 | 15 | 17 | `completed` 零错误 | `石路` tile×1 |
| +植被 | 18 | 22 | `completed` 零错误 | `树` object×73（共 82 层，每层都有 cells） |

> **关键发现：out 图层名 = 你传给该模板组资产名 panel 的文本**（实测 road 层名是 `石路`、植被层名是 `树`，而非英文 `road`/`tree`）。想要哪种语义名直接写进对应的 `text_panel`。继续加层（结构/湖泊/农田）照「6 个场景模板组」「链式串联范式」两节同法：实例化 → 建 panel → 主产物接 `merge_all.item_N`、剩余 Rest 接下一组 `in_0` → execute。

## 模板电池工作流程：查表 → 读文档 → 连线 → 验证（强制）

> 上面的「零试错确定性照抄序列」覆盖了"草地+建筑+道路+植被"这条已实证主链路，能照抄就照抄。**但凡需求超出它**（要加湖泊 / 农田 / 建筑结构、要调参数、要换组合），**不要凭记忆瞎接**——按下面四步走，理解成本与试错成本最低：

1. **先查汇总表**：读 `batteries/templates/scene/TEMPLATES_INDEX.md`。这是模板电池的总入口，一张表列出 6 个模板组的功能、templateId、主要可见 IN/OUT、典型管线位置。**根据需求（要建筑 / 道路 / 湖 / 田 / 植被）先在这里定位要用哪几个电池、各放在管线哪一环。**
2. **读该电池的详细文档**：对每个选中的电池，读它的 `batteries/templates/scene/<Name>/README.md`——里面有**输入/输出端口表、推荐参数与设置考虑要素、可照抄的 applyBatch 使用示例、使用场合、验证要点**。推荐参数已结合语义和 Example1 / verified-town 实证给出，直接采用。
3. **按文档示例实例化 + 连线**：用 `scene:pipeline.instantiateTemplate` 拿回真实 `groupId`，照该 README 的「使用示例」建 panel、连上游/Seed/资产名、接汇总 `tree_merge.item_N`、把 Rest 接给下一组 `in_0`。**一批只加一个模板组**（见「分批增量构图」）。
4. **连线后立即验证连接结果**：
   - `scene:pipeline.get` 核对该组的可见 `in_N`/`out_N` **真的接上了边**（防"ok 却空"陷阱）；
   - `scene:pipeline.execute` 跑整图，应 `status:completed`；
   - 看 `out.layers`，**对照该 README 的「验证要点」**确认本层应有的图层（类型/名字）真的出现了（如建筑 `floor` tile+voxel、道路 tile 名= PathAsset、植被 object 名= NaturalAssetName）；必要时截图。
   - **确认这一层对了，再进行下一个电池。** 不对就就地修（`updateNode` 改参 / `disconnect`+`connect` 改线）再继续。

> 一句话：**TEMPLATES_INDEX.md 查表定位 → 对应 README 读端口/参数/示例 → 实例化连线 → get+execute 对照 README 验证要点核对 → 过了再下一个。** 细节都下沉在 README 里，本 skill 不重复展开。
>
> CLI 与工具通路对照、命令清单、像 grep 一样读回端口内容（`execute | jq`）、三通路等价性等细节，见末尾「CLI 通路」一节的「命令清单 / 读回端口内容 / 三通路等价」子节。

## 官方工具通路

所有图操作都走 ToolRegistry 工具（代理到插件后端 `/api/v1/*`）。不要直接改 `state/graph.json`，不要点 UI。

调用 `scene:pipeline.applyBatch` 时**必须**带 `opts.actor`：

```json
{
  "toolId": "scene:pipeline.applyBatch",
  "args": { "ops": [], "opts": { "actor": "ai:sino", "label": "compose sino scene" } },
  "caller": { "kind": "ai" }
}
```

`opts.actor` 以 `ai:sino` 开头是 sino 的身份标记：后端据此对 `/api/v1/batch` 启用 **opId 白名单硬门**（见下文「op 白名单」）。非 sino 调用方不受此门影响。

可用工具：

- 项目：`scene:projects.list` / `projects.create` / `projects.open` / `projects.close` / `projects.remove`
- 目录：`scene:batteries.list` / `scene:batteries.get`（查**静态 op 电池**，如 `tree_merge`/`scene_output`；**查不到模板组**）
- 模板组：`scene:templates.list` / `scene:templates.get`（**发现/核对 6 个模板组及其 exposed in_N/out_N 端口的真相源**）
- 实例化模板组：`scene:pipeline.instantiateTemplate`（**一步把一个模板组落进当前图，首选**）
- 流水线：`scene:pipeline.get` / `scene:pipeline.applyBatch` / `scene:pipeline.execute`
- 预览：`scene:renderer.*` / `scene:screenshot.capture` / `scene:screenshot.latest` / `scene:assets.list`

## 工作流（渐进式，禁止一次性全连）

**核心原则：绝不一次性把整图想完、整图连完。** 先搭好最小可跑骨架并验证可视化正确，再分批一步步往里加，每次 applyBatch 后暂停几秒看效果。详见下节「分批增量构图（强制）」。

1. **新建项目（每次新任务必做）**：新任务开始时，用 `scene:projects.create` 建一个**全新的空项目**，然后 `scene:projects.open` 打开它。**禁止在已有项目里折腾**——不要 open 然后改别人的项目，尤其不要碰参考项目（如 Example1）；那些是只读参照，不是你的工作画布。一个 agent 同一时刻只持有一个项目锁，建完即在自己的新项目里从零开始。只有当用户明确要求"继续上次那个项目"时，才用 `scene:projects.list` 找回并 open。
2. **查模板组（关键）**：用 `scene:templates.list` 列出可用的场景模板组、`scene:templates.get` 读某个模板组的 `exposedInputs` / `exposedOutputs` 真实端口名（`in_0`/`out_0`…）与模板 id。**不要用 `scene:batteries.get` 查模板组**——那查的是静态 op 电池，查不到模板组。实例化用 `scene:pipeline.instantiateTemplate`（见「实例化模板组」节），它会返回新 groupId 与端口，以返回值为准、不要硬编。
3. **先搭骨架 + 场景起点**：第一批建 `tree_merge → tree_flatten → scene_merge_subtrees → scene_output` 这套汇总+输出架构（外加一个 `seed_control`），并完成强制起手式 **`empty_scene` → `AddBaseGrid`**（实例化 AddBaseGrid 拿到 BaseNode 作上游起点）。`applyBatch` 提交 → `pipeline.get` 确认 → `pipeline.execute` 跑整图 → **暂停几秒** → 截图看是否出基础网格场景/不报错。起点对了才往下走。
4. **分批补内容**：每批只加**一个**模板组——用 `scene:pipeline.instantiateTemplate`（`templateId` = 模板组 id/basename，可带 `position`/`groupId`/`opts.actor`）一步实例化它，拿回返回的 `groupId` 与 `in_N/out_N` 端口清单；再建它的 panel 输入（`text_panel`/`number_const`），用返回的 groupId/端口把它接到骨架（主产物 → `tree_merge.item_n`）和上游。**`in_0` 接谁要分情况**（见「各模板组 `in_0` 到底该接谁」对照表）：第一个后续组接 `AddBaseGrid.out_1`(BaseNode)；**「在空地上铺新东西」的组（道路/湖/田/装饰）接上一组的 Rest/剩余 → 本组 `in_0`**；**「在已有产物上加工」的组（ArchitectureStructures 在 Buildings 上盖楼起墙）接对应主产物 `ArchitectureRegions.out_0`，不是 Rest**。每批 `applyBatch` → `pipeline.get` 校验 → `pipeline.execute` → **暂停几秒** → 截图核对该层效果，确认无误再加下一组。
5. **逐步迭代**：重复第 4 步，按「链式串联范式」把模板组一个个挂上去（建筑→结构→道路→湖泊→农田→自然装饰），每加一层都验证。
6. **收尾验证**：全部接好后再整体 `pipeline.execute` + 截图，对照需求评估。

每次 `applyBatch` 后都要 `scene:pipeline.get` 确认节点真的多了（防"ok 却空"陷阱），并在 `pipeline.execute` 后**暂停几秒**等渲染稳定再截图。

## 分批增量构图（强制）

**反模式（禁止）**：一次性把整张图（6 个模板组 + 全部 panel + 全部连线，几十上百个 op）塞进一个 `applyBatch` 提交。一旦出错很难定位是哪一层、哪根线的问题，且中间过程不可见、结果无法逐层验证。

**正确做法——骨架优先，分批补充，每步可视化验证：**

1. **第一批 = 可视化骨架 + 场景起点**：建汇总+输出架构 `tree_merge → tree_flatten → scene_merge_subtrees → scene_output`（外加一个 `seed_control`），并完成**强制起手式 `empty_scene` → `AddBaseGrid`**（实例化 AddBaseGrid 模板组 + 空场景源 + Width/Height/BaseName/BaseAsset panel）拿到 BaseNode。先让这套骨架 + 基础网格能正确跑出基础场景、不报错——这是后续所有内容的承载结构与上游起点，必须先稳。
2. **之后每批只加一个模板组**：用 `scene:pipeline.instantiateTemplate` 一步实例化一个模板组（返回 groupId + 端口）+ 它的 panel 输入（`text_panel`/`number_const`）+ 用返回的 groupId/端口把它接到骨架（主产物 → `tree_merge.item_n`）和上游。**`in_0` 接谁分情况，别一律套"接 Rest"**（见「各模板组 `in_0` 到底该接谁」对照表）：第一个后续组的 `in_0` 接 `AddBaseGrid.out_1`(BaseNode)；**「在空地上铺新东西」的组（道路/湖/田/装饰）才接上一组的 Rest/剩余 → 本组 `in_0`**；**「在已有产物上加工」的组（ArchitectureStructures）接对应主产物（`ArchitectureRegions.out_0` Buildings），不是 Rest**。**一批一个模板组，不要一批塞多个。**
3. **每批之后三步走**：`pipeline.get`（确认结构）→ `pipeline.execute`（跑整图）→ **暂停几秒**（等渲染稳定）→ `screenshot.capture` 看效果。**确认这一层对了，再提交下一批。**
4. **出错就地修**：某一层截图不对，先把这一层修对（`updateNode` 改 params / `disconnect`+`connect` 改线）再继续，不要带着错误往下叠。

> 为什么要"暂停几秒"：`execute` 是异步渲染，立刻截图可能拿到上一帧或半成品。`screenshot.capture` 给足 `timeout`（如 20000ms），并在 execute 与 capture 之间留出渲染时间，才能拿到真实结果用于判断。

> **截图结果即图片，必须真的看图判断对错——严禁口称"读不了图片"。** `scene:screenshot.capture` / `scene:screenshot.latest` **截图功能已修复**：成功时返回的就是**可直接观看的图片内容块**（image_file，渲染器画面已直接呈现给你）+ 一行元信息（分辨率 / captureId / 路径）。**你直接观察这张图判断布局对错即可，无需再 `read_file` 那个路径。**
>
> 🚫 **严禁再以"当前模型读不了图片／不支持把图片读进来／不支持图片输入"为由跳过视觉验证**——这是已被修复前的旧认知，现在完全不成立。`capture` 成功返回的图片块就是给你看的。**每加一层模板组后，必须截图并真的看图**判断这一层对不对（区域比例、道路是否连通、湖/田/植被分布），不要只凭 `execute` 的 `completed` 或 jq 就下结论。
>
> ✅ **唯一合法的"没看到图"情形**：`capture` 返回 `capture timeout (no renderer connected?)` 之类**错误**时，说明确实没截到图（通常是没有活的渲染器前端连接）——这时如实上报"截不到图"，**不要**把它当成"截图成功/画面正常"，也**不要**反过来当借口说"模型读不了图"。

这条原则对 **`scene:*` 工具通路和 CLI 通路同样适用**：CLI 下就是「先 `create` 骨架节点 + `connect` → `pipeline execute` → 看结果 → 再 `node create-template` 逐个加模板组」，不要一个超长 batch 脚本一次拉满。

## 6 个场景模板组：作用与端口

> **详情看文档，别只看这里的概要。** 选用哪个模板组、各组的完整端口表 / 推荐参数 / 可照抄示例 / 使用场合 / 验证要点，都在：
> - 总览索引：`batteries/templates/scene/TEMPLATES_INDEX.md`（**第一步查表定位**）
> - 各组详细文档：`batteries/templates/scene/<Name>/README.md`（**第二步读细节**）
>
> 本节只给一份速查概要，避免 skill 过长；以 `scene:templates.get` 和各 README 为准。完整工作流程见上文「模板电池工作流程：查表 → 读文档 → 连线 → 验证」。

### 模板组 id 速查（Example1 实测 · `instantiateTemplate` 的 templateId）

| 模板组 | templateId |
|---|---|
| ArchitectureRegions | `group_1781234452470_mzjv4` |
| ArchitectureStructures | `group_1781235844604_rzrp9` |
| PathConnection | `group_1781236103740_crshq` |
| LakeRegions | `group_1781238394903_rz71v` |
| FarmlandRegions | `group_1781239001217_9be7r` |
| RandomNaturalDecoration | `group_1781239444306_uz0oe` |

> 这些是**库里模板的 id（传给 `instantiateTemplate` 的 `templateId`）**；每次实例化会返回一个**全新的运行时 groupId**（如 `group_mqasqhvc_bxyuuc`），后续连线一律用返回的那个真实 id，不要用上表里的库 id 去连线。也可用 basename（如 `LakeRegions`）作 `templateId`。


下面端口名是从模板组 JSON 的 `exposedInputs` / `exposedOutputs` 归纳的**当前值**；运行时**务必用 `scene:templates.get` 复核**（`scene:batteries.get` 查不到模板组），因为实例化后的 groupId 由 `instantiateTemplate` 返回、隐藏端口可能变化。`[hidden]` 端口一般不用接，走默认即可。所有模板组都遵循同一接口：一个 `in_0:scene` 接收上游场景树、一个 `number` Seed 输入、若干 `scene` 输出（含一个"剩余/Rest"输出用于链式串联）。

### ⚠️ 各模板组 `in_0` 到底该接谁（强约束对照表 · 接错必空跑/接错对象）

> **核心区分：`in_0` 不是"一律接上一组的 Rest"。** 要分清这一组是**「在空地上铺新东西」**（道路/湖/田/装饰——接上一组的 **Rest/剩余空地**），还是**「在已有产物上加工」**（建筑结构在 **Buildings 建筑区域**上盖楼起墙——接对应**主产物**，不是 Rest）。**把"接 Rest"无脑套到所有组，就会把 ArchitectureStructures 接到剩余空地上——这是生产里踩过的真实错连。**

| 模板组 | `in_0` 该接谁 | 接的是"主产物"还是"剩余空地" | 为什么 |
|---|---|---|---|
| **AddBaseGrid** | `empty_scene.scene`（空场景根） | — 起点 | 场景起手式，从空场景建基础网格 |
| **ArchitectureRegions** | `AddBaseGrid.out_1`（BaseNode 基础网格起点） | 主产物（基础网格） | 在基础网格上划建筑用地 |
| **ArchitectureStructures** | `ArchitectureRegions.out_0`（**Buildings 建筑区域**） | **主产物（Buildings）** | **在"建筑区域"上盖楼/起墙，不是在剩余空地上！绝不接 `out_2`(Rest)** |
| **PathConnection** | **`in_0`=POI**：进阶档接 `scene_focus_path`→门（`outer_door`）；简化档接 `ArchitectureRegions.out_0`(Buildings)。**`in_1`=上游空间**接 `ArchitectureRegions.out_2`(Rest) | `in_0`=主产物/门，`in_1`=剩余空地 | `in_0` 是"要被连接的兴趣点(门/建筑)"，`in_1` 才是"可铺路的剩余空间"——**两个不同来源，不能都接同一个 out_0** |
| **LakeRegions** | 上一组的 **Rest/Non-Path**（如 `PathConnection.out_1`） | 剩余空地 | 在空地上挖湖 |
| **FarmlandRegions** | 上一组的 **Rest**（如 `LakeRegions.out_1`） | 剩余空地 | 在空地上开田 |
| **RandomNaturalDecoration** | 上一组的 **Rest**（如 `FarmlandRegions.out_1`）；**仅草坪+植被**时第一组接 **`AddBaseGrid.out_1`（BaseNode）** | 剩余空地 | 在空地上撒植被；**多品种**见 Step 4b（链式 Rest + 各组独立 density） |

> 一句话记法：**ArchitectureStructures 接 Buildings(`out_0`)、PathConnection 的 `in_0`=门/建筑且 `in_1`=Rest（两口不同源）、湖/田/装饰才接上一组的 Rest。** 拿不准时回到这张表，别把"接 Rest"泛化到所有组。

### 1. ArchitectureRegions（建筑区域）
在场景里划分出建筑用地区域并打上语义。
- IN：`in_0:scene`（上游场景）、`in_1:number`(Seed)、`in_2:number`(ExpectedBuildings 期望建筑数)、`in_3:string`(GroundAsset 地面资产名)
- OUT：`out_0:scene`(Buildings 建筑区域)、`out_1:string`(BuildingPath)、`out_2:scene`(Rest 剩余空地)、`out_3:scene`、`out_4:string`(RestPath)

### 2. ArchitectureStructures（建筑结构）
在建筑区域里进一步生成房间/墙体结构。**接在 ArchitectureRegions 的 Buildings 建筑区域之后（`in_0` 接 `out_0`，绝不接 `out_2` Rest）。**
- IN：`in_0:scene`（**建筑区域 Buildings，接 `ArchitectureRegions.out_0`**）、`in_1:string`(WallAsset 墙体资产名)、`in_2:number`(Seed)
- OUT：`out_0:scene`(结构化建筑主产物，内部含 `outer_door` 门子节点)、`out_1:scene`(Rooms 房间)、`out_2:string`(RoomsPath)
> **本组无 Rest 输出**：只细化建筑本身，不消费空地；剩余空地链式仍由 `ArchitectureRegions.out_2` 负责。

### 3. PathConnection（道路连接）
在 POI（兴趣点，如建筑/门）之间生成连通道路，并产出"路"与"非路"两块。
- IN：`in_0:scene`(**POI 焦点【必接】= 要被道路连接的兴趣点。默认进阶档接"门"：`ArchitectureStructures.out_0`→`scene_focus_path`(聚焦 `/outer_door`)→`in_0`；简化档（无结构层时兜底）接 `ArchitectureRegions.out_0`(Buildings)。悬空则整组静默空跑、道路不生成、整图仍 completed**)、`in_1:scene`（上游空间 = 可铺路的剩余，接 `ArchitectureRegions.out_2`，**与 `in_0` 不同源，别都接同一 out_0**）、`in_2:string`(PathAsset 道路资产名)
- OUT：`out_0:scene`(Path 道路)、`out_1:scene`(Non-Path 非道路区域，可继续作为剩余空地)、`out_2:scene`、`out_3:string`(PathPath)、`out_4:string`(Non-PathPath)

### 4. LakeRegions（湖泊区域）
在剩余空地上挖出湖泊区域。
- IN：`in_0:scene`（上游场景/剩余空地）、`in_1:number`(ExpectedLakes 期望湖泊数)、`in_2:string`(LakeAsset 湖泊资产名)、`in_3:number`(Seed)
- OUT：`out_0:scene`、`out_1:scene`(Rest 剩余)、`out_2:scene`(Lake 湖泊)、`out_3:string`(LakePath)、`out_4:string`(RestPath)

### 5. FarmlandRegions（农田区域）
在剩余空地上生成农田与作物。
- IN：`in_0:scene`（上游场景/剩余空地）、`in_1:number`(ExpectedFarmland)、`in_2:string`(FarmlandAsset)、`in_3:string`(CropAsset)、`in_4:number`(Seed)、`in_5:number`(CropDensity)
- OUT：`out_0:scene`、`out_1:scene`(Rest 剩余)、`out_2:scene`(Farmland 农田)、`out_3:string`(FarmlandPath)、`out_4:string`(RestPath)

### 6. RandomNaturalDecoration（自然随机装饰）
在剩余空地上撒自然植被/装饰（树木、石头等）。通常是链路最后一环；**现生成多品种植被**见 Step 4b。
- IN：`in_0:scene`（上游场景/剩余空地或 **AddBaseGrid.out_1 BaseNode**）、`in_1:string`(NaturalAssetName，**一组一名**)、`in_2:number`(Seed)、`in_3:number`(Density 密度)
- OUT：
  - **`out_0:scene`** — **本组处理后的完整 scene 树**（底图 + 截至本组累积装饰）→ **汇总/visualization 接这个**
  - `out_1:string`(NaturalDecPath)
  - **`out_2:scene`(NaturalDec)** — **仅本组新撒**的植被子树 → ❌ **不要**接 `tree_merge` 做完整场景
  - **`out_3:scene`(Rest)** — 剩余空地 → 链式接下一组 `in_0`
  - `out_4:string`(RestPath)

## 链式串联范式（来自参考图 Example1）

参考图 Example1 的顶层数据流（归纳）：

```
empty_scene.scene ─→ AddBaseGrid.in_0(RootScene)   # 强制起手式：空场景 → 基础网格起点
  AddBaseGrid.out_1 (BaseNode, focus 已聚焦) ─→ ArchitectureRegions.in_0   # 后续一律从 BaseNode 出发，不用空根
  AddBaseGrid.out_2 (RootScene, 整棵根)      ─→ tree_merge.item_N / 多区域时接下一块 AddBaseGrid.in_0

seed_control.seed ──┐ (扇出到每个模板组的 Seed 输入)
                    ├─→ ArchitectureRegions.in_1(Seed)
                    ├─→ LakeRegions.in_3
                    ├─→ FarmlandRegions.in_4
                    ├─→ RandomNaturalDecoration.in_2
                    └─→ ArchitectureStructures.in_2

  ArchitectureRegions.out_0 (Buildings) ─→ ArchitectureStructures.in_0   # 在"建筑区域(Buildings)"上盖楼起墙——接 out_0，绝不接 out_2(Rest)
  ArchitectureStructures.out_0 → scene_focus_path(聚焦门 /outer_door) → PathConnection.in_0 (POI 焦点【必接】)   # 默认进阶档：连"门"，道路从门口自然连出
                                                                                    # 简化档(兜底，无结构层时)：ArchitectureRegions.out_0(Buildings) → in_0（道路贴楼边，糙）
  ArchitectureRegions.out_2 (Rest)      ─→ PathConnection.in_1 (上游空间)   # in_0(POI)与 in_1(上游空间)是两个不同来源，别都接同一个 out_0
  PathConnection.out_1 (Non-Path)       ─→ LakeRegions.in_0
  LakeRegions.out_1 (Rest)              ─→ FarmlandRegions.in_0
  FarmlandRegions.out_1 (Rest)          ─→ RandomNaturalDecoration.in_0

汇总（每个模板组的主产物 scene 进 tree_merge 的不同 item 口）：
  ArchitectureStructures.out_0 ─→ tree_merge.item_0
  PathConnection.out_0 (Path)  ─→ tree_merge.item_1
  LakeRegions.out_0            ─→ tree_merge.item_2
  FarmlandRegions.out_0        ─→ tree_merge.item_3
  RandomNaturalDecoration.out_0─→ tree_merge.item_4
  tree_merge.tree ─→ tree_flatten.tree ─→ scene_merge_subtrees.scenes ─→ scene_output.scene
```

要点：
- **PathConnection 的 `in_0`=POI 焦点必接，默认走进阶档（连门）**：`in_0` 是"要被道路连接的兴趣点"，悬空 = 道路整组静默空跑、不生成、且把下游接它 `out_1` 的组（湖/田/装饰）连带带空，而整图仍 `completed` 不报错。**默认**用进阶档（`ArchitectureStructures.out_0` → `scene_focus_path` 聚焦 `outer_door` 门 → `in_0`），路从门口连出；**仅在没有结构层/没门时**才退回简化档（建筑 `out_0` 直接接 `in_0`）。**`in_1`（上游空间，接 `ArchitectureRegions.out_2` Rest）和 `in_0`（POI）是两个不同来源的必接 scene 口——别只接 `in_1` 漏了 `in_0`，更别把两口都接到同一个 `out_0`。**
- **`in_0` 接谁分情况，别一律"接 Rest"**：ArchitectureStructures 在"建筑区域(Buildings)"上加工 → `in_0` 接 `ArchitectureRegions.out_0`(Buildings)，**不是** Rest。完整对照见上文「各模板组 `in_0` 到底该接谁」对照表。
- **强制起手式**：`empty_scene` → `AddBaseGrid`（基础网格起点，模板组，走 `instantiateTemplate` 实例化），拿 `AddBaseGrid.out_1`（BaseNode，focus 已聚焦）作为后续所有模板组的最初上游——**后续组的 `in_0` 接 BaseNode，不再用空根**。多个 AddBaseGrid（前一块 `out_2` 接下一块 `in_0`）= 多区域拼接。
- **Rest 链式（仅限"在空地上铺新内容"的组）**：起手之后，对**道路/湖/田/自然装饰**这类"在剩余空地上铺新东西"的组，把上一个模板组的"剩余/Rest/Non-Path" scene 输出接到下一个模板组的 `in_0`，让每层在前一步留下的空地上继续布置，互不覆盖。**但 ArchitectureStructures 这类"在已有产物上加工"的组例外**——它接的是主产物（`ArchitectureRegions.out_0` Buildings），不接 Rest（见「各模板组 `in_0` 到底该接谁」对照表）。
- **统一种子**：单个 `seed_control.seed` 扇出到每个模板组的 Seed 输入。
- **资产/语义名**：用 `text_panel`（输出 `output`）接到模板组的资产名输入（GroundAsset / WallAsset / PathAsset / LakeAsset / FarmlandAsset / NaturalAssetName 等）；数量/密度用 `number_const`（输出 `value`）。
- **汇总输出**：所有主产物 scene → `tree_merge.item_n` → `tree_flatten.tree` → `scene_merge_subtrees.scenes` → `scene_output.scene`。

## 善用场景查询/分析节点，精确操作子区域（不要只会整组囫囵传递）

模板组负责**批量生成**整片区域（一组建筑、一片道路），但很多时候你只想**对某一个子区域**下手：只连某栋建筑的门、只给某一类子节点加装饰、只读某个节点的属性。这时**不要把整组场景囫囵传给下游**——用下面这几个**查询/分析电池**（都在白名单内）先精确定位/提取出目标子节点，再对它单独操作。这是从"只会整体模板调用"升级到"精确操作子区域"的关键。

### 可用的查询/分析电池（都在 sino 白名单）

| 电池 | 输入 → 输出 | 什么时候用 |
|---|---|---|
| `scene_focus_path` | `scene`+`path(string)` → `scene`（focus 移到该路径，tree 不变） | **已知子节点路径**时，把 focus 精确定位到单个节点（如某栋楼的门）。**按路径定位单点的主力。** |
| `scene_focus_children` | `scene` → `scenes(list)`+`childCount` | 把 focus 节点**展开成它所有直接子节点**的 scene 列表，**遍历某节点下所有子区域**（如逐栋处理每个建筑）。 |
| `node_explode` | `scene` → `childPaths(list)`/`voxelCount`/`childCount`/`voxels`… | **检视一个节点内部到底有什么**：拿到它的直接子节点绝对路径列表、体素数等，用来"先看清楚再决定怎么操作"。 |
| `scene_get_attribute` | `scene`+`key(string)` → `value`/`exists` | **按属性查询/判断**：读 focus 节点上的自定义属性值（不存在则 `exists=false`）。 |

配套：`string_concat`（输入 `a`/`b`、输出 `result`，**拼路径**用）；路径句柄如 `ArchitectureRegions.out_1`=**BuildingPath**、`out_4`=**RestPath**（模板组直接输出的子区域路径 string，省得自己 explode 去找）。

> 🚫 **BuildingPath 是运行时动态字符串句柄，不是 BaseName，不可凭 BaseName 猜**：`ArchitectureRegions.out_1`(BuildingPath) 的值由运行时生成（形如 `/architecture_0`），**必须**把 `out_1` 这个端口接进 `string_concat.a` 去拿真实值——**绝不能**用 AddBaseGrid 的 BaseName（如 `"block"`/`"ground"`）去拼一个 `/block/outer_door` 这样的绝对路径塞给 `string_concat` 或直接喂给 `scene_focus_path.path`。猜出来的路径在 tree 里不存在，focus **必然失败**。子节点名不确定时用 `scene_focus_children`/`scene_get_attribute`/`node_explode` 在结构产物上探查真名，不要猜。

### 通用范式：「拿路径句柄 → 拼子区域名 → 聚焦 → 对该子区域操作」

```
父节点路径句柄(如 BuildingPath = "/architecture_0") ──→ string_concat.a ─┐
text_panel(子区域名, 如 "/outer_door").output ────────→ string_concat.b ─┤
                                                                         ▼
                                  string_concat.result = "/architecture_0/outer_door"
                                                                         │ (path)
带该子区域的场景(如 ArchitectureStructures.out_0) ──→ scene_focus_path.scene
                                                                         ▼
                          scene_focus_path → 输出 scene，focus 精确落在该子区域 → 拿去作 POI / 加装饰 / 读属性
```

- **路径未知时**先 `node_explode`（看 `childPaths`）或 `scene_focus_children`（逐个子节点拿 scene），找到目标再操作。
- **路径已知时**（典型：模板组给了路径句柄如 BuildingPath，子区域名固定如 `/outer_door`）直接 `string_concat` 拼路径 + `scene_focus_path` 聚焦，一步到位。

### 范例：Example1 的「门 → 道路」（实证）

Example1 不把整栋建筑当 POI，而是**提取出每栋楼的 `outer_door`（门）子节点**作 POI：`ArchitectureRegions.out_1`(BuildingPath) + `text_panel("/outer_door")` → `string_concat` → 门路径 → `scene_focus_path`（在 `ArchitectureStructures.out_0` 场景里聚焦）→ `PathConnection.in_0`。于是道路从门口自然连出，而不是贴着整栋楼轮廓走。完整可照抄写法见 `batteries/templates/scene/PathConnection/README.md`「POI 的进阶用法（Example1 实证）：连"门"而非连整栋楼」。

> 🚫 **关键：门路径前缀来自 `ArchitectureRegions.out_1`(BuildingPath) 这个运行时句柄（已用 jq 核对 Example1 的 graph.json），不是 BaseName**。Example1 里 `string_concat.a ← ArchitectureRegions.out_1`（BuildingPath，值形如 `/architecture_0`），`string_concat.b="/outer_door"`，拼出 `/architecture_0/outer_door`。**绝不能**用 AddBaseGrid 的 BaseName（如 `"block"`）去拼 `/block/outer_door`——那条路径在 tree 里不存在，focus 必失败、POI 链报错。focus 报错时**修路径写法（改用 BuildingPath 句柄），不要放弃 focus 改把整张结构场景当 POI**。

> `outer_door` 子节点由 **ArchitectureStructures** 内部生成（每栋建筑结构下都有一个名为 `outer_door` 的门子节点）——所以这套进阶用法依赖管线里已接上 ArchitectureStructures。

### 范例：整栋建筑贴图 · 掩码提取（Scene → 2D PART C · **专属，非默认**）

> **仅当**用户要「按场景形状生成**一整张**建筑装饰贴图」时用本节。日常 **结构化建筑构图**（模板组 + 内置墙材）**不需要** `building_footprint_mask` / `grid_to_json`；一般 object 走 PART A，地块走 PART B。

用户要**按场景里真实建筑形状/门位**生成整栋装饰贴图时，**不能跳过结构层**——门位（grid 值 `2`）只存在于 **`ArchitectureStructures` 跑完之后**的结构 scene 里；仅 `ArchitectureRegions` 没有 `outer_door`。

**强制顺序**：`ArchitectureRegions`（拿 **`out_1`(BuildingPath)**）→ **`ArchitectureStructures`**（生成墙体 + `outer_door`）→ **path 聚焦** → **`building_footprint_mask`** → **`grid_to_json`** → 再跨 workbench 走 2D PART C。

`building_footprint_mask` 要求输入 `scene` 的 **focus 已落在单栋建筑**上——用 **`scene_focus_path`** 把 focus 设到正确 path，**path 前缀来自 `ArchitectureRegions.out_1`(BuildingPath)**（与 POI 门路径同一来源，**不是** BaseName）。

**单栋 / 单区域**：

```
ArchitectureRegions.out_1 (BuildingPath) ──→ scene_focus_path.path
ArchitectureStructures.out_0 ──────────────→ scene_focus_path.scene
scene_focus_path.out ──→ building_footprint_mask.scene
building_footprint_mask.grid ──→ grid_to_json.grid
```

**一片多栋**：`scene_focus_path` 先把 focus 落到区域根（BuildingPath），再 **`scene_focus_children`** 扇出 → 每栋一条 `building_footprint_mask` → `grid_to_json`（DataTree 批量）。

execute 后核对：`doorCount > 0`、grid 含 `2`。`grid_to_json.json` 原样作为 2D 侧 `house_template.spec` / `house_footprint.spec` / `grid_json_to_size.json` 的同一份输入。完整 2D 链见 `/texture-pipeline` 与 `/generate-2d-asset` PART C。

### 与「6 模板组链式」范式的分工

- **模板组**负责**批量生成**：一次性铺出一组建筑/一片道路/一片植被。
- **查询/分析电池**负责**精确定位/提取**：从模板组产出的场景树里挑出"某一栋/某一个门/某一类子节点"，再单独喂给下游或单独装饰。
- 二者配合：**先用模板组批量生成，再用查询电池精确锁定要特殊处理的子区域**。需要"只对某栋建筑 / 某个门 / 某类子节点"操作时，**主动用这些查询电池**，别把整组场景原样传下去。它们都在白名单内，放心在顶层 `createNode`。

## 实例化模板组（首选 `scene:pipeline.instantiateTemplate`）

**首选做法（一步到位）**：用 `scene:pipeline.instantiateTemplate` 把一个模板组实例化进当前活动项目的图。它内部自动完成「读模板 JSON → 对内部 node/edge/group id 唯一重映射（同一模板可重复实例化不冲突）→ 拓扑排序子组先于父组 → 一条有序 batch：createNode 成员 + connect 内部边 + createGroup 带权威 exposedPorts」，落地为一个 `__group__` 顶层组影子节点（含嵌套子组），对外 exposed 端口名稳定为 `in_0/in_1/…`、`out_0/out_1/…`。

```json
{ "toolId":"scene:pipeline.instantiateTemplate", "caller":{"kind":"ai"}, "args":{
  "templateId":"LakeRegions",
  "position":{"x":400,"y":0},
  "opts":{"actor":"ai:sino","label":"实例化 LakeRegions"}
}}
```

返回（节选）：`{ "status":"ok", "groupId":"group_xxx", "exposedInputs":[{"portName":"in_0",...}], "exposedOutputs":[{"portName":"out_0",...}], "opCount": N }`。**用返回的 `groupId` 作为顶层影子节点 id、用 `in_N/out_N` 端口名接线**（不要硬编 groupId/端口名）。`templateId` 用 `scene:templates.list`/`scene:templates.get` 查到的 id 或文件 basename（如 `LakeRegions`）。省略 `groupId` 则自动生成且不冲突；要稳定句柄可显式传 `groupId`。

> 该工具走专用路由（**不经过 `/api/v1/batch`**），因此**不撞 sino opId 白名单硬门**——实例化模板组本就是合法放行的动作，其内部 `alg_*` 等成员都作为组私有成员被收编。仍受每 agent 项目锁约束（先 `projects.open`）。

### 底层原理（手工展开，仅供理解；日常请用上面的工具）

模板组是"成组电池"。若要手工展开（一般不需要），从模板库实例化一个模板组到当前图，**不是**一条简单的 `createNode opId:"__group__"`，而是一个 op 序列：先把模板组的**内部成员节点**逐个 `createNode`（用你起的唯一 nodeId，opId 是各成员的真实 opId），再把内部边逐条 `connect`，最后用 `createGroup` 把这些成员收编成一个组：

```jsonc
// 1) 建内部成员节点（opId 取自模板组定义的 nodes[].opId）
{ "type":"createNode", "nodeId":"ar_n1", "opId":"scene_passthrough", "position":{"x":0,"y":0}, "params":{} }
{ "type":"createNode", "nodeId":"ar_n2", "opId":"rect_grid",        "position":{"x":80,"y":0}, "params":{} }
// … 其余成员 …
// 2) 连内部边（取自模板组定义的 edges[]）
{ "type":"connect", "edgeId":"ar_e1", "source":{"nodeId":"ar_n1","port":"scene"}, "target":{"nodeId":"ar_n2","port":"scene"} }
// 3) 收编为组：groupId 自起；exposedPorts 用模板组的 exposedInputs/exposedOutputs（portName + sourceNodeId + sourcePortName）
{ "type":"createGroup", "groupId":"g_arch_regions", "name":"ArchitectureRegions",
  "memberNodeIds":["ar_n1","ar_n2"],
  "position":{"x":0,"y":0},
  "exposedPorts":{
    "inputs":[ {"portName":"in_0","sourceNodeId":"ar_n1","sourcePortName":"scene"} ],
    "outputs":[ {"portName":"out_0","sourceNodeId":"...","sourcePortName":"scene"} ]
  } }
```

手工展开时用 `scene:templates.get`（= `GET /api/v1/group-templates/:id`）取回模板组完整定义，把它的 `nodes` / `edges` / `exposedInputs` / `exposedOutputs` 原样转成上面的 `createNode` + `connect` + `createGroup`（成员 nodeId 用稳定前缀做命名空间避免冲突）。**收编进 createGroup 的成员 createNode 不受 opId 白名单限制**（它们是模板组私有实现）；**白名单只校验留在顶层、未被任何 createGroup 收编的 createNode**。`scene:pipeline.instantiateTemplate` 正是把这套逻辑封装成了一步。

op 判别字段是 `type`（`createNode`/`connect`/`createGroup`/`updateNode`/`deleteNode`/`disconnect`/`deleteGroup`/`updateGroup`/`ungroup`/`setMetadata`），形状见内核 `Op` 联合类型。`updateNode` 只合并 params；改结构要 `deleteNode`+`createNode`+重连。

## 一个最小可跑的 applyBatch 范例（顶层骨架）

下面是"从空图到一个最小可跑场景"的**顶层骨架**：1 个种子 + 1 个模板组（ArchitectureRegions）+ 汇总到 scene_output。模板组本身实操时用 `scene:pipeline.instantiateTemplate` 一步实例化（拿回 `groupId`，下例假设它叫 `g_arch_regions`），骨架与连边再用一条 `applyBatch` 提交；此处用 `g_arch_regions` 指代实例化返回的 groupId。

```json
{ "toolId":"scene:pipeline.applyBatch", "caller":{"kind":"ai"}, "args":{
  "opts":{"actor":"ai:sino","label":"最小场景：建筑区域→输出"},
  "ops":[
    { "type":"createNode", "nodeId":"seed",      "opId":"seed_control",  "position":{"x":-400,"y":0},   "params":{} },
    { "type":"createNode", "nodeId":"ground_tp", "opId":"text_panel",    "position":{"x":-400,"y":120}, "params":{"text":"ground_grass"} },
    { "type":"createNode", "nodeId":"n_build",   "opId":"number_const",  "position":{"x":-400,"y":240}, "params":{"value":12} },

    "… ArchitectureRegions 模板组先用 scene:pipeline.instantiateTemplate 单独实例化（拿回 groupId=g_arch_regions 与 in_N/out_N 端口），本 batch 只建骨架并连到它 …",

    { "type":"createNode", "nodeId":"merge",  "opId":"tree_merge",           "position":{"x":400,"y":0}, "params":{"inferredAccess":"tree","inferredType":"scene","portCount":6} },
    { "type":"createNode", "nodeId":"flat",   "opId":"tree_flatten",         "position":{"x":600,"y":0}, "params":{} },
    { "type":"createNode", "nodeId":"msub",   "opId":"scene_merge_subtrees", "position":{"x":800,"y":0}, "params":{} },
    { "type":"createNode", "nodeId":"out",    "opId":"scene_output",         "position":{"x":1000,"y":0},"params":{} },

    { "type":"connect", "edgeId":"se1", "source":{"nodeId":"seed","port":"seed"},      "target":{"nodeId":"g_arch_regions","port":"in_1"} },
    { "type":"connect", "edgeId":"se2", "source":{"nodeId":"n_build","port":"value"},  "target":{"nodeId":"g_arch_regions","port":"in_2"} },
    { "type":"connect", "edgeId":"se3", "source":{"nodeId":"ground_tp","port":"output"},"target":{"nodeId":"g_arch_regions","port":"in_3"} },

    { "type":"connect", "edgeId":"me0", "source":{"nodeId":"g_arch_regions","port":"out_0"}, "target":{"nodeId":"merge","port":"item_0"} },
    { "type":"connect", "edgeId":"mf",  "source":{"nodeId":"merge","port":"tree"},  "target":{"nodeId":"flat","port":"tree"} },
    { "type":"connect", "edgeId":"fm",  "source":{"nodeId":"flat","port":"tree"},   "target":{"nodeId":"msub","port":"scenes"} },
    { "type":"connect", "edgeId":"mo",  "source":{"nodeId":"msub","port":"scene"},  "target":{"nodeId":"out","port":"scene"} }
  ]
}}
```

> 端口名（`in_1`/`in_2`/`in_3`/`out_0`/`item_0` 等）和模板组 groupId 在实操时**以 `scene:pipeline.instantiateTemplate` 的返回值 + `scene:pipeline.get` 的真实返回为准**。要扩成完整场景，按「链式串联范式」再用 `scene:pipeline.instantiateTemplate` 实例化 PathConnection / LakeRegions / FarmlandRegions / RandomNaturalDecoration / ArchitectureStructures，并把它们的主产物各接到 `tree_merge.item_1..item_4`。

## op 白名单（硬约束）

sino **准用的顶层 opId**（其余一律禁止；后端对 `actor=ai:sino` 的 `/api/v1/batch` 硬门拒绝清单外的顶层 `createNode.opId`）：

- **模板组实例化**：`createGroup`（成组）—— 6 个模板组都通过它落地；其成员 `createNode` 被豁免。
- **结构 op**：`connect` / `disconnect` / `updateNode` / `deleteNode` / `deleteGroup` / `updateGroup` / `ungroup` / `setMetadata` 不受 opId 白名单限制（它们不是 `createNode`）。
- **顶层工具电池 createNode 的 opId**（白名单）：
  - `text_panel`、`number_const`、`seed_control`、`string_concat`
  - `scene_focus_path`、`scene_merge_subtrees`、`tree_merge`、`tree_flatten`、`add_child`、`scene_output`
  - 场景查询/分析电池：`scene_focus_children`（下钻子节点列表）、`scene_get_attribute`（读节点属性）、`node_explode`（展开节点全部属性）——配合 `scene_focus_path`+`string_concat` 精确定位/操作某一子区域（见「善用场景查询/分析节点，精确操作子区域」一节）
  - **整栋建筑贴图专属桥**（日常构图**用不到**）：`building_footprint_mask`、`grid_to_json` —— 仅当用户要「按场景 footprint 生成一整张建筑 billboard 贴图」时用，见「整栋建筑贴图 · 掩码提取」；**结构化场景默认走内置墙材，不要自动上这条链**
  - 桥接件：`empty_scene`、`rect_grid`、`grid2node`、`voxel_slice`、`scene_passthrough`
  - 成组哨兵：`__group__`（始终允许）

强约束：**禁止在顶层直接 `createNode` 清单外的任何 opId**（尤其 `alg_*` 等算法电池——它们只能作为模板组的内部成员随实例化出现）。语义信息（资产名、数量、密度、区域语义）靠 `text_panel` / `number_const` 等 panel 输入与连接结构承载，不要引入清单外电池来表达语义。

## CLI 通路（headless / 脚本化构图）

除了 `scene:*` 工具通路，还可用内核 CLI `forgeax`（`packages/node-runtime-cli`）在脚本里构图，最终写的是同一张 `graph.json`。**实例化模板组时 CLI 更省事**：`node create-template` 一条命令就把整个模板组（含嵌套子组、内部成员、内部边）落进图，自动给内部 node/edge/group id 重映射（同一模板可重复实例化不冲突），并保持对外 exposed 端口名稳定为 `in_0/in_1/…`、`out_0/out_1/…`（顺序同模板的 `exposedInputs/exposedOutputs`）。组节点对外就像普通电池一样按 `in_N`/`out_N` 连线。

定位目标图（三选一全局参数）：

- `--project-id <id> --project-root <ws>`：定位 `<ws>/projects/<id>/state/graph.json`（多项目工程）
- `--graph-file <path>`：直指某张 `graph.json`
- `--pipeline-id <id> --project-root <ws>`：默认 `<ws>/state/graph.json`

复现 Example1 骨架的命令序列（已验证可跑通）：

```bash
G="--project-id <pid> --project-root <ws> --ndjson"   # 或 --graph-file / --pipeline-id
TMPL=apps/wb-scene-generator/batteries/templates/scene
BATT=apps/wb-scene-generator/batteries

# 1. 一键实例化模板组（可调用 N 次；--group-id 给稳定句柄，省略则自动生成且不冲突）
forgeax node create-template --group-file $TMPL/ArchitectureRegions/ArchitectureRegions.json --group-id arch --x 0   $G
forgeax node create-template --group-file $TMPL/LakeRegions/LakeRegions.json                 --group-id lake --x 400 $G
# … 按需再实例化其余模板组 …

# 2. 建顶层汇总/输出节点（需 op 注册，故带 --batteries）
forgeax node create --node-id merge --op scene_merge_subtrees --x 800  $G --batteries $BATT
forgeax node create --node-id out   --op scene_output         --x 1100 $G --batteries $BATT

# 3. 用稳定 exposed 端口连边（--group-id 给的句柄就是顶层影子节点 id，也是顶层 group key）
forgeax node connect --edge-id e1 --from arch:out_0 --to merge:scenes $G
forgeax node connect --edge-id e2 --from lake:out_0 --to merge:scenes $G
forgeax node connect --edge-id e3 --from merge:scene --to out:scene    $G

# 4. 读回校验（输出含顶层 nodes/edges + groups 定义，可断言 __group__ 节点 / 嵌套组 / exposed 连边）
forgeax pipeline get $G

# 5.（可选）执行整图
forgeax pipeline execute $G --batteries $BATT
```

CLI 通路的 op 白名单约束与工具通路一致：顶层只用清单内 opId，模板组只能通过 `node create-template` 落地，语义靠 panel 节点（`text_panel`/`number_const`）承载。

### 命令清单 / 读回端口内容 / 三通路等价

> 以下 CLI 事实以 dev-scene-layout-pipeline 的 `node-runtime-cli`（`src/index.ts` 与 `commands/*.ts`）**实测为准**，勿参考其它 checkout 或 CLI README 里画饼的 stub。

**全局定位（三选一，所有命令都要带）**：`--project-id <id> --project-root <ws>` ｜ `--graph-file <path>` ｜ `--pipeline-id <id> --project-root <ws>`。运行 op（`node create` / `pipeline execute` 等需注册电池的命令）还要带 `--batteries <dir>`；加 `--ndjson` 得流式输出。

**已实现命令（forgeax）**：

| 用途 | 命令 | 等价 op |
|---|---|---|
| 放普通电池 | `forgeax node create --node-id <id> --op <opId> --params '<json>' --x <n> --y <n>` | 一条 `createNode` |
| 放模板组（实例化） | `forgeax node create-template --group-file <NodeGroup.json> --group-id <id> --x --y` | 模板展开成组 |
| 连线 | `forgeax node connect --edge-id <id> --from <node:port> --to <node:port>` | `connect` |
| 改参/位 | `forgeax node update --node-id <id> --params '<json>' [--x --y]` | `updateNode` |
| 删节点 / 删边 | `forgeax node delete --node-id <id>` ／ `forgeax node disconnect --edge-id <id>` | `deleteNode` ／ `disconnect` |
| 批量 op | `forgeax pipeline apply --ops '<JSON array>'` | 同 `applyBatch` schema |
| 读结构 | `forgeax pipeline get` | — |
| 执行 | `forgeax pipeline execute [--node <id>]`（省略 `--node` 跑整图；带 `--node` 只跑该节点上游闭包） | — |
| 导入 | `forgeax pipeline import --file <path> [--mode replace\|merge] [--remap] [--execute none\|downstream\|full]` | — |
| 项目 | `forgeax project list\|create\|open\|delete`（`create` 需 `--name`） | — |

> ⚠️ **未实现命令（调用会抛错，勿用）**：`pipeline list`、`node list`、`asset *`、`path-slot *`、`history *`。这些在某些 CLI README 里出现过但内核**未实现**，不要据此写脚本。

**像 grep 一样读"某节点某输出端口的内容"（实测确认，无专用命令）**：

做法 = `execute` 后对 `result.outputs` 用 jq 精确投影到 `nodeId.portName`。`pipeline execute` 返回 `{ executionId, status, outputs }`；`outputs` 按 **nodeId** 键控，每节点是 `{ <portName>: <DataTree> }`，DataTree = 数组 `[{ "path":[...], "items":[...] }]`。

```bash
# CLI 通路：投影到具体 节点.端口
forgeax pipeline execute --batteries <BATT> <G> | jq '.result.outputs["<nodeId>"]["<portName>"]'
# 工具通路（curl scene:pipeline.execute）同理
curl -s ... | jq '.result.outputs["<nodeId>"]["<portName>"]'
# scene 端口只看摘要（避免巨量）：取焦点子树的子节点名
forgeax pipeline execute --batteries <BATT> <G> \
  | jq '.result.outputs["<groupId>"]["out_0"][0].items[0].tree.children[].name'
```

实测样例（verified-town）：

- `outputs.name_panel.output` = `[{"path":[0],"items":["grassland"]}]`（string 端口）
- `outputs.road_name.output` = `[{"path":[0],"items":["石路"]}]`
- `outputs.size.value` = `[{"path":[0],"items":[50]}]`（number 端口）
- `outputs.grid.grid` = `[{"path":[0],"items":[[[1,1,…50×50…]]]}]`（grid 端口）
- `outputs.<groupId>.out_0` = scene 端口，`items` 里是 `{tree:{name,path,children:[...]}}`

**portType → 数据格式对应**（回答"这个端口预期什么格式"看 portType 即可）：

| portType | `items` 形态 |
|---|---|
| `number` | 数值 |
| `string` | 字符串 |
| `grid` | 二维数组 |
| `scene` | `{tree:{name,path,children:[...]}}` |
| `boolean` | 布尔 |

> ⚠️ **28MB 告警**：整图 `execute` 的 `outputs` 可能极大（verified-town 实测约 28MB，因含全 voxel 网格）。**绝不整体打印 `outputs`**，必须用 jq 投影到具体 `nodeId.portName`；scene 端口只取 `.[0].items[0].tree.children[].name` 之类摘要，否则会刷屏 / 爆上下文。

**三通路等价（理念）**：内核底层把 **UI 拖拽 / CLI / `scene:*` 工具**三条通路都归一为同一套基本 op（`createNode` / `connect` / `updateNode` / …）经 `applyBatch` 落到同一张 `graph.json`。所以 AI 用 CLI 或工具做的放置 / 连线 / 改参会**精确、确定地反映到画布**——人在 UI 看到的就是 AI 操作的结果；读回也一致：`pipeline.get` 读结构、`execute.outputs` 读端口值。这保证 AI 行为可被人在画布验证、可被 jq 精确审查。

## 参考

- [compose-scene-pipeline](../compose-scene-pipeline/SKILL.md)：通用 Scene Generator 工具通路（更底层、无白名单约束，sino 不直接用）。
- 6 个模板组定义：`batteries/templates/scene/<Name>/<Name>.json`（端口与内部结构的真相源，配合 `scene:templates.get`）。
