# 管线操作手册（wb-scene-generator 连线）

> 对应 `scene_creator` 的 `session_operation.md`，但本工作台**不手编 session.json**——所有图操作都走 `scene:*` 工具（或等价的 `forgeax` CLI），底层归一为同一套 op 经 `applyBatch` 落到同一张 `graph.json`。本文是这套 op / 工具通路的写法与验证规范。

> **零起点（aw-support 测试）**：禁止读 `../executions/*.md` 历史归档；禁止 open 非本次 `projectId` 的项目。坐标来自 runDir `keypoint-layout-solved.json`。**快循环 + Rest** 见 [fast-loop.md](fast-loop.md)。

---

## 零、快循环与 Rest（必读）

- **双通道 SSOT**：[mutation-lanes.md](mutation-lanes.md)
- **四拍**：instantiate(A) → applyBatch 连线(B) → get → execute → 读 `verification.hints`
- **Rest** = 剩余区域；下一组 Scene 输入接上一组 Rest
- **M0** 汇总链：`AddBaseGrid.out_2` → tree_merge → … → scene_output → execute

---

## 一、官方工具通路（不要直接改 graph.json）

所有图操作走 ToolRegistry 工具（代理到插件后端 `/api/v1/*`）。**不要直接改 `state/graph.json`，不要点 UI。**

可用工具：

- 项目：`scene:projects.list` / `projects.create` / `projects.open` / `projects.close` / `projects.remove`
- 模板组：`scene:templates.list`（**仅**发现 templateId 名称）；**禁止** `scene:templates.get` 预读组内 nodes — 端口看 **`instantiateTemplate` 返回的 exposedInputs**
- 实例化模板组：`scene:pipeline.instantiateTemplate`（**一步把模板组落进图，首选**）
- Composer 工具电池：`scene:composerUtilities.list` / `scene:composerUtilities.get`（**Sino 唯一电池目录**）
- 模板组：`scene:templates.list`（发现 id）；**禁止** `scene:batteries.list`（全量目录，非 AI）
- 流水线：`scene:pipeline.get` / `scene:pipeline.applyBatch` / `scene:pipeline.execute`
- 预览 / 渲染：`scene:renderer.*` / `scene:assets.list`
- 导入资产：`scene:library.useGameTextures` / `scene:library.list`（导入 Mira 产物，见 asset-collaboration.md）

每次 **通道 B** `applyBatch` **必须**带 `projectId` 和 `opts.actor`（`ai:sino` 开头）：

> **422 不是「模板不可用」** — 是通道混用。见 [mutation-lanes.md](instructions/mutation-lanes.md)。

```json
{ "toolId": "scene:pipeline.applyBatch", "caller": { "kind": "ai" },
  "args": {
    "projectId": "<与 open 相同的项目 id>",
    "ops": [],
    "opts": { "actor": "ai:sino", "label": "一句话意图" }
  } }
```

> **字段名**：`projects.open` 用 **`id`**；`pipeline.get` / `applyBatch` / `execute` / `import` / `export` / `instantiateTemplate` 用 **`projectId`**（值相同）。open 成功后同一 agent 可省略 `projectId`（工具层会回退到 agent lock），但编排派工消息里应**显式写出**以免搞混项目。

---

## 二、op schema 速查（写错内核静默忽略 → "ok 却空"）

`applyBatch.ops` 里每个 op 的**判别字段是 `type`**；节点 id 字段是 `nodeId`，电池类型字段是 `opId`。**不要凭直觉猜字段名。**

```jsonc
// 建节点：type=createNode，nodeId=你起的唯一 id，opId=电池类型；position 可省（省了内核自动排到不重叠网格）
{ "type":"createNode", "nodeId":"seed", "opId":"seed_control", "params":{} }
// 连边：type=connect，source/target 都是 {nodeId, port}；edgeId 可省（省了内核自动铸唯一 id）
{ "type":"connect", "source":{"nodeId":"seed","port":"seed"}, "target":{"nodeId":"merge","port":"item_0"} }
// 改参数：type=updateNode（只合并 params）
{ "type":"updateNode", "nodeId":"seed", "params":{"seed":12345} }
// 其余：deleteNode / disconnect / createGroup / updateGroup / deleteGroup / ungroup / setMetadata
```

合法 `type` 白名单：`createNode` / `updateNode` / `deleteNode` / `connect` / `disconnect` / `createGroup` / `updateGroup` / `deleteGroup` / `ungroup` / `setMetadata`。**没有 `addNode` / `addEdge`，没有 `type:电池名` 这种写法。**

> ⚠️ 提交大 JSON（含 `ops`）务必**先写临时文件再 `curl --data @file`**，别把整段塞命令行——shell 转义会把 `nodeId`、数字吃坏（实测把 `nodeId` 转成 `0`）。

---

## 三、Rest 链接（防重叠）

1. **Rest 语义**：模板组主产物（Building/Island/Path/Decoration…）被切走后，**剩下仍可布置的区域**。不是 AddBaseGrid 全图 BaseNode。
2. **单链**：第二组起的 Scene 输入（`in_0`/`in_1`/`in_2` 视模板）接上一组 **`out_2` Rest**（或文档规定的 Rest 口）。
3. **禁止**：两个组都把 Scene 输入接到 **同一** `AddBaseGrid.out_1` —— 会在全图重复布置、区域重叠。
4. **Island 子区**：子 `IslandRegions.in_0` ← 父 **`Island.out_1`**，不是全图 BaseNode。
5. **BuildingStructures**：`in_0` ← `Pick*.out_1`(Building)，**不接 Rest**。
6. **主产物 vs Rest**：主产物 → `tree_merge.item_N`；Rest → 下一组输入。详见 [fast-loop.md](fast-loop.md)。

---

## 四、连线铁律

1. **`connect` 的 `edgeId` 可省略**——省了内核自动铸全图唯一 id；要稳定引用某条边（如后续 `disconnect`）时才显式给。**要给就用字段名 `edgeId`（不是 `id`）且全图唯一**。
   - ✅ 省略：`{"type":"connect","source":{"nodeId":"a","port":"out_0"},"target":{"nodeId":"b","port":"in_0"}}`
   - ✅ 显式：`{"type":"connect","edgeId":"e_unique","source":{"nodeId":"a","port":"out_0"},"target":{"nodeId":"b","port":"in_0"}}`
   - ❌ 写成 `"id":"e1"`（字段名错）→ 内核当成"未给 edgeId"自动铸 id，你那个 `id` 字段被忽略、引用不到。
   - 一批里连任意多条边、多条边连进同一节点都没问题；显式给 `edgeId` 时只要每条唯一即可。
2. **`applyBatch` 后必 `pipeline.get` 核对**：返回 ok / hash 变化都可能是"ok 却空"（某 op 失败被原子回滚或字段拼错被静默忽略）。必须紧跟 `scene:pipeline.get` 确认 nodes/edges 真进图。
3. **`tree_merge` 必带 params** `{"inferredAccess":"tree","inferredType":"scene","portCount":6}`——缺了会因动态端口推断报错/崩溃。
4. **必接 scene / POI 端口不可悬空**：`PathConnection.in_2`(Scene) / `in_3`(POI 列表) / `NaturalDecorationDistribution.in_1` 等悬空会静默空跑（不产输出、`execute` 仍 `completed`）。
5. **PathConnection POI 须合法**：每个 POI 在可铺路 **region 内或贴边**；从 Rest/建筑 **导出体素或 footprint 推理**（门、建筑外侧、边界锚点），接入前确认 **不在区域外、不在建筑体内**（见 PathConnection 管线文档）。

---

## 五、实例化模板组（首选 `instantiateTemplate`）

```json
{ "toolId":"scene:pipeline.instantiateTemplate", "caller":{"kind":"ai"}, "args":{
  "projectId":"<项目 id>",
  "templateId":"LakeRegions",
  "position":{"x":400,"y":0},
  "opts":{"actor":"ai:sino","label":"实例化 LakeRegions"}
}}
```

返回（节选）：`{ "status":"ok", "groupId":"group_xxx", "graphVerified":true, "exposedInputs":[{"portName":"in_0",...}], "exposedOutputs":[...], "opCount":N }`。

- **用返回的 `groupId` 作顶层影子节点 id、用 `in_N/out_N` 端口名接线**（不要硬编库 templateId/端口名）。
- **`graphVerified: false` 或 `verifyError` 存在时**：禁止 applyBatch 连线；必须 `pipeline.get` 看清真值或重试 instantiate。
- **禁止编造工具返回**：没亲眼看到 JSON 响应就不要写 groupId/ports/hash。
- `templateId` 用 `scene:templates.list` 或 Skill 目录表（如 `PickOneBuilding`）；**不要** `templates.get` 打开组内结构。
- 该工具走**通道 A**：模板组内部（含 scene_set_attribute）自动收编为组私有成员 — **黑盒，你不读、不审计、不「实证」**。
- **禁止**用通道 B 手工 `createNode`+`connect`+`createGroup` 展开模板组。

---

## 六、执行与验证（execute 默认只返回轻量摘要）

`scene:pipeline.execute` 默认返回 KB 级摘要（顶层 `status`/`error`/`durationMs` 原样，`outputs[nodeId][portId]` 投影成 children 名 / cell 数等），可放心**整图 execute 看摘要逐组验证**，不会爆上下文。仅极少数需原始 voxel cells 时传 `{ raw: true }`（体积巨大，谨慎）。

**每加一组后，逐组验证三步：**

```bash
# ① get 确认本组所有必接 in 端口都连上（尤其 PathConnection.in_0=POI）
... scene:pipeline.get | jq '.edges[]? | select(.target.nodeId=="<G>") | "\(.target.port) <- \(.source.nodeId):\(.source.port)"'
# ② execute 后读本组 out 端口确认非空
... scene:pipeline.execute | jq '.result.outputs["<G>"]["out_0"][].items[0].tree.children[].name'
# ③ 最终 names/图层里出现本组资产名（道路→石路、装饰→行道树）才算成功
```

> ⚠️ **绝不整体打印 `outputs`**（整图可达 ~28MB 含全 voxel）；scene 端口只取 `.[].items[0].tree.children[].name` 之类摘要。

**验证（基于 execute 摘要，不靠截图）：** 每加一层都 `scene:pipeline.execute` 跑通、读 `outputs` 端口摘要确认无 error、本组资产名出现在 names/图层里（区域比例、路是否连通、分布从摘要与参数判断）。像素级视觉确认由用户在 Preview 面板亲眼查看（本环境渲染器截图视觉默认关闭）。

---

## 七、CLI 等价通路（headless / 脚本化）

`forgeax`（`node-runtime-cli`）写的是同一张 `graph.json`，三通路等价、可互验。定位参数三选一：`--project-id <id> --project-root <ws>` ｜ `--graph-file <path>` ｜ `--pipeline-id <id> --project-root <ws>`；运行 op 类命令再加 `--batteries <dir>`，加 `--ndjson` 出流式。

| 操作 | CLI 命令 | 等价 op |
|---|---|---|
| 放普通电池 | `forgeax node create --node-id <id> --op <opId> --params '<json>' --x <n> --y <n>` | `createNode` |
| 放模板组 | `forgeax node create-template --group-file <NodeGroup.json> --group-id <id> --x --y` | 一步实例化整组 |
| 连线 | `forgeax node connect --edge-id <id> --from <node:port> --to <node:port>` | `connect` |
| 改参/位 | `forgeax node update --node-id <id> --params '<json>' [--x --y]` | `updateNode` |
| 删节点/边 | `forgeax node delete --node-id <id>` / `forgeax node disconnect --edge-id <id>` | `deleteNode` / `disconnect` |
| 批量 op | `forgeax pipeline apply --ops '<JSON array>'` | 同 `applyBatch` schema |
| 读结构 | `forgeax pipeline get` | — |
| 执行 | `forgeax pipeline execute [--node <id>]`（省略=整图；带 `--node`=该节点上游闭包） | — |
| 导入 | `forgeax pipeline import --file <path> [--mode replace\|merge] [--remap] [--execute none\|downstream\|full]` | — |
| 项目 | `forgeax project list\|create\|open\|delete`（create 需 `--name`） | — |

> ⚠️ **未实现（会抛错，勿用）**：`pipeline list`、`node list`、`asset *`、`path-slot *`、`history *`。

**像 grep 一样读端口内容**（无专用命令）：`execute` 后对 `result.outputs` 用 jq 投影到 `nodeId.portName`。`portType` 决定 `items` 形态：`number`→数值、`string`→字符串、`grid`→二维数组、`scene`→`{tree:{name,path,children}}`。

```bash
forgeax pipeline execute --batteries <BATT> <G> | jq '.result.outputs["<nodeId>"]["<portName>"]'
```

---

## 八、注意事项

1. **每次新任务先 `scene:projects.create` + `open`**：在自己的新空项目里搭，别碰参考/只读项目（如 Example1）。`open` 仅 acquire agent 锁，**不会**切换 UI 浏览项目。用户明说"接着上次"才 `projects.list` 找回。
2. **所有 pipeline 工具必须带 `projectId`**（或与 `open` 同一 agent 省略后走 lock 回退）：`pipeline.get` / `applyBatch` / `execute` / `import` / `export` / `instantiateTemplate` 的值均与 `projects.open` 的 **`id`** 相同，只是字段名不同。
3. **多 session 并行**：Sino 已启用 `multiInstance`；不同 session（不同 agentId）可各自 `open` 不同项目并同时 mutate，互不抢占 global viewing。
4. **端口名 / groupId 以 instantiateTemplate 返回值为准**；composer 工具端口查 `scene:composerUtilities.get`。**禁止** `scene:batteries.*` / `templates.get` 预读组内。
5. **强制顺序**：`empty_scene → AddBaseGrid` + seed + 汇总骨架先 execute 跑通（M0）→ 再实例化后续组 → 再连线。顺序颠倒会让模板组拿不到上游、输出空。**M0 之后允许一拍批量实例化+连线多组再一起 execute**（参数已知、互不依赖的相邻组）；**但依赖上游 execute 结果的组必须分步**（PathConnection POI、装饰 keypoint、高差、资产导入），先 execute 看真值再连——**不要一口气全连完**。见 [fast-loop.md](fast-loop.md)「可分步批量」。
6. **位置坐标仅影响视觉**：`position.x/y` 不影响执行，按从左到右、分层排列整齐即可。
7. **工具不可见时如实上报**：若 `templates.list`/`instantiateTemplate` 报 "Unknown tool"，是后端未加载的部署问题——停下来告诉用户，别退回复制参考项目硬凑。
