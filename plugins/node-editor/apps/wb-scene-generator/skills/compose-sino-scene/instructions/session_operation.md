# 管线操作手册（wb-scene-generator 连线）

> 对应 `scene_creator` 的 `session_operation.md`，但本工作台**不手编 session.json**——所有图操作都走 `scene:*` 工具（或等价的 `forgeax` CLI），底层归一为同一套 op 经 `applyBatch` 落到同一张 `graph.json`。本文是这套 op / 工具通路的写法与验证规范。

---

## 一、官方工具通路（不要直接改 graph.json）

所有图操作走 ToolRegistry 工具（代理到插件后端 `/api/v1/*`）。**不要直接改 `state/graph.json`，不要点 UI。**

可用工具：

- 项目：`scene:projects.list` / `projects.create` / `projects.open` / `projects.close` / `projects.remove`
- 模板组：`scene:templates.list` / `scene:templates.get`（发现/核对 7 个模板组及其 `exposedInputs/exposedOutputs`）
- 实例化模板组：`scene:pipeline.instantiateTemplate`（**一步把模板组落进图，首选**）
- 工具电池目录：`scene:batteries.list` / `scene:batteries.get`（查白名单工具电池端口；**模板组不在这里**）
- 流水线：`scene:pipeline.get` / `scene:pipeline.applyBatch` / `scene:pipeline.execute`
- 预览：`scene:renderer.*` / `scene:screenshot.capture` / `scene:screenshot.latest` / `scene:assets.list`
- 导入资产：`scene:library.useGameTextures` / `scene:library.list`（导入 Mira 产物，见 asset-collaboration.md）

每次 `applyBatch` **必须**带 `opts.actor`，且 `ai:sino` 开头（触发后端 opId 白名单硬门）：

```json
{ "toolId": "scene:pipeline.applyBatch", "caller": { "kind": "ai" },
  "args": { "ops": [], "opts": { "actor": "ai:sino", "label": "一句话意图" } } }
```

---

## 二、op schema 速查（写错内核静默忽略 → "ok 却空"）

`applyBatch.ops` 里每个 op 的**判别字段是 `type`**；节点 id 字段是 `nodeId`，电池类型字段是 `opId`。**不要凭直觉猜字段名。**

```jsonc
// 建节点：type=createNode，nodeId=你起的唯一 id，opId=电池类型，position 必带
{ "type":"createNode", "nodeId":"seed", "opId":"seed_control", "position":{"x":0,"y":0}, "params":{} }
// 连边：type=connect，edgeId 全图唯一，source/target 都是 {nodeId, port}
{ "type":"connect", "edgeId":"e1", "source":{"nodeId":"seed","port":"seed"}, "target":{"nodeId":"merge","port":"item_0"} }
// 改参数：type=updateNode（只合并 params）
{ "type":"updateNode", "nodeId":"seed", "params":{"seed":12345} }
// 其余：deleteNode / disconnect / createGroup / updateGroup / deleteGroup / ungroup / setMetadata
```

合法 `type` 白名单：`createNode` / `updateNode` / `deleteNode` / `connect` / `disconnect` / `createGroup` / `updateGroup` / `deleteGroup` / `ungroup` / `setMetadata`。**没有 `addNode` / `addEdge`，没有 `type:电池名` 这种写法。**

> ⚠️ 提交大 JSON（含 `ops`）务必**先写临时文件再 `curl --data @file`**，别把整段塞命令行——shell 转义会把 `nodeId`、数字吃坏（实测把 `nodeId` 转成 `0`）。

---

## 三、连线铁律

1. **`connect` 必带唯一 `edgeId`**（字段名是 `edgeId`，**不是** `id`）。每条边一个全图唯一 `edgeId`。
   - ✅ `{"type":"connect","edgeId":"e_unique","source":{"nodeId":"a","port":"out_0"},"target":{"nodeId":"b","port":"in_0"}}`
   - ❌ 漏 `edgeId` / 写成 `"id":"e1"` → 边以 key=`undefined` 落盘，第二条边报 `edge undefined already exists`。
   - 这不是"一批不能连多条边"——一批里连任意多条边、多条边连进同一节点都没问题，**只要每条 `edgeId` 唯一**。
2. **`applyBatch` 后必 `pipeline.get` 核对**：返回 ok / hash 变化都可能是"ok 却空"（某 op 失败被原子回滚或字段拼错被静默忽略）。必须紧跟 `scene:pipeline.get` 确认 nodes/edges 真进图。
3. **`tree_merge` 必带 params** `{"inferredAccess":"tree","inferredType":"scene","portCount":6}`——缺了会因动态端口推断报错/崩溃。
4. **必接 scene / POI 端口不可悬空**：`PathConnection.in_2`(Scene) / `in_3`(POI 列表) / `NaturalDecorationDistribution.in_1` 等悬空会静默空跑（不产输出、`execute` 仍 `completed`）。

---

## 四、实例化模板组（首选 `instantiateTemplate`）

```json
{ "toolId":"scene:pipeline.instantiateTemplate", "caller":{"kind":"ai"}, "args":{
  "templateId":"LakeRegions",
  "position":{"x":400,"y":0},
  "opts":{"actor":"ai:sino","label":"实例化 LakeRegions"}
}}
```

返回（节选）：`{ "status":"ok", "groupId":"group_xxx", "exposedInputs":[{"portName":"in_0",...}], "exposedOutputs":[...], "opCount":N }`。

- **用返回的 `groupId` 作顶层影子节点 id、用 `in_N/out_N` 端口名接线**（不要硬编库 templateId/端口名）。
- `templateId` 用 `scene:templates.list`/`get` 查到的 id 或文件 basename（如 `LakeRegions`）。
- 该工具走专用路由（不经 `/api/v1/batch`），**不撞白名单硬门**——实例化模板组本就是合法动作，其内部 `alg_*` 成员作为组私有成员被收编。仍受每 agent 项目锁约束（先 `projects.open`）。
- **禁止手工 `createNode`+`connect`+`createGroup` 展开模板组**，也禁止从参考项目复制节点。

---

## 五、执行与验证（execute 默认只返回轻量摘要）

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

**截图验证（必须真的看图）：** `scene:screenshot.capture` 成功返回可直接观看的图片块（+ 分辨率/path），无需 `read_file`。每加一层都看图判断（区域比例、路是否连通、分布）。给足 `timeout`（如 20000ms）；只有返回 `timeout (no renderer connected?)` 才是真没截到图，如实上报。

---

## 六、CLI 等价通路（headless / 脚本化）

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

## 七、注意事项

1. **每次新任务先 `scene:projects.create` + `open`**：在自己的新空项目里搭，别碰参考/只读项目（如 Example1）。用户明说"接着上次"才 `projects.list` 找回。
2. **端口名 / groupId 以工具返回为准**：模板组用 `templates.get` + `instantiateTemplate` 返回值；工具电池用 `batteries.get`。不要凭记忆硬编。
3. **强制顺序**：`empty_scene → AddBaseGrid` + seed + 汇总骨架先 execute 跑通 → 再逐组实例化 → 再连线。顺序颠倒会让模板组拿不到上游、输出空。
4. **位置坐标仅影响视觉**：`position.x/y` 不影响执行，按从左到右、分层排列整齐即可。
5. **工具不可见时如实上报**：若 `templates.list`/`instantiateTemplate` 报 "Unknown tool"，是后端未加载的部署问题——停下来告诉用户，别退回复制参考项目硬凑。
