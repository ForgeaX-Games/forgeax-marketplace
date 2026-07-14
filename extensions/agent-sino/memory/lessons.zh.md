# Sino · 累积 lessons

> Sino 只做**场景构图**（wb-scene-generator，`scene:*` 工具 + 内置素材）。下面都是场景构图的硬经验，动手前默念，禁止在生产会话里靠试错重新发现。

## 2026-06-17 · 工具侧已做「输出落盘 / 摘要」整理（上下文不再被大结果污染）
> 后端 + host 桥都加固过了，**下面是新的工具行为，照着用，别再担心「结果太大撑爆上下文 / 网页死机」**：
- **`scene:pipeline.execute` 默认只回 KB 级摘要**（status + 每端口的 item 数 / 形状提示），**绝不再回全量体素/网格**。判成功照旧看 `status` 和端口的 `itemCount` / 子节点名。
  - **增量执行（重点）**：传 `nodeId` 就**只重跑该节点的下游闭包**，上游全部从 output cache 取——这正是编辑器「Run 按钮 / 热更新」的省钱路径。**改了哪个节点就 execute 那个 `nodeId`，不要每次裸 execute 全图**。
  - 极少数确需全量时才 `raw:true`；即便如此，host 桥的兜底也会把超大结果落盘。
- **任何工具结果超 ~24KB 都会自动落盘**到 `<cwd>/.cache/tool-results/*.json`，只回 `{ note, path, preview }`。**通常看 `preview` 就够**；真要全量再 `read_file` 那个 path。这是统一兜底，巨型 `pipeline.get` / `raw` execute 都被它接住。
- **`scene:templates.list/get` 也都剥了内联图（iconPng/iconSvg）**，输出干净文本，别在对话里反映「电池列表渲染有问题」。

## 当前定位（简表）
- 专职场景构图（wb-scene-generator），工具 **只有 `scene:*`**，默认 skill **只有 `compose-sino-scene`**。
- **不生成图片/贴图/资产**，不碰 `asset2d:*`、不做 2D/3D、不写引擎代码。要现生成贴图交 2D 工作台 / Mira。
- 硬边界：只用场景模板组（AddBaseGrid / ArchitectureRegions / ArchitectureStructures / PathConnection / LakeRegions / FarmlandRegions / RandomNaturalDecoration / PointSampleBuilding）+ 白名单工具电池；`applyBatch` 带 `opts.actor = "ai:sino"`，清单外顶层 opId 会被后端拒绝。
- 构图主线：模板组 Rest→in_0 链式串联 + `seed_control` 统一分发 seed + `tree_merge→tree_flatten→scene_merge_subtrees→scene_output`。

## 2026-06-12 · 生产事故复盘（这些坑已踩过，下次直接照做，禁止再在生产会话里试错）
这些规则 SKILL 顶部「强制铁律」已写死，文档已替你验证过——**动手前默念，不要再用生产时间去重新发现**：
- **connect 必带唯一 `edgeId`**：字段名就是 `edgeId`（不是 `id`、不是 `edge_id`）。漏了 `edgeId`，边会以 key=`undefined` 落盘，第二条边即报 `edge undefined already exists`。这**不是**"一批不能连多条边"，**也不是**"一个节点只能收一条边"——那些都是漏 edgeId 时的伪症状，是我上次臆测错的方向。一批里连任意多条边、任意多条进同一目标节点都没问题，只要每条 `edgeId` 全图唯一。
- **applyBatch 后必 `pipeline.get` 核对**：返回 ok / hash 变都可能是"ok 却空"（整批被某 op 原子回滚，或 `type` 拼错被静默忽略）。合法 `type` 只有 createNode/updateNode/deleteNode/connect/disconnect/createGroup/updateGroup/deleteGroup/ungroup/setMetadata，**没有 addNode/addEdge**。
- **禁止回读 `pipeline.execute` 全量返回**：它会把每层完整 voxel cells 全量吐出，直接撑爆上下文。只看 `status`；要细节用 jq 投影 `outputs[nodeId][portName]` 的关键信息（children 名 / cell 数 / 资产名），或看截图。
- **PathConnection 的 `in_0`(POI) 必接**：悬空会让道路静默不生成，而 execute 仍 `completed`（极具欺骗性，我已连续两次栽在这）。优先用进阶 POI（BuildingPath + string_concat 拼 `/outer_door` → scene_focus_path 提取门 → 作 POI），让路从门口连出；见 PathConnection/README「POI 进阶用法」。
- **善用查询电池精确操作子区域**：scene_focus_path / scene_focus_children / node_explode / scene_get_attribute + string_concat 拼路径，都在白名单内。需要只对某栋楼/某个门/某类子节点操作时主动用，别把整组场景囫囵传递。
- **截图就是图片，直接看**：`scene:screenshot.capture` 的结果以图像内容（ContentPart）形式返回，直接当图片肉眼判断即可，不要再去 Read 落盘文件、也不要把它当 base64 字符串解析。

## 2026-06-12 · 连接不规范复盘（crowded-block `p_mqb2iv4w_cktxo4` 实证 3 错，下次直接照做）
> 这一轮试错变少了，但连接仍不规范。下面 3 个错连已取证，**修法已固化进 SKILL/README/persona，下次照做即可，禁止重蹈**：

- **ArchitectureStructures 接 Buildings，不接 Rest**：上次把 `ArchitectureStructures.in_0` 接成了 `ArchitectureRegions.out_2`(Rest 剩余空地)✗——等于把楼盖到空地上。**正解：`in_0` ← `ArchitectureRegions.out_0`(Buildings 建筑区域)✓**，因为建筑结构是在"建筑区域"上盖楼/起墙。**根因是把"接上一组 Rest → in_0"的通用链式话术过度泛化了**——那句只适用于"在空地上铺新东西"的组（道路/湖/田/装饰）；ArchitectureStructures 是"在已有产物上加工"，接主产物。拿不准时查 SKILL「各模板组 `in_0` 到底该接谁」对照表。

- **PathConnection 的 POI 要提取门，不是接整张带楼场景；且 `in_0`/`in_1` 不同源**：上次 `in_0`(POI) 直接接了 `ArchitectureStructures.out_0`(整张带楼场景)、`in_1` 也接同一个 `out_0`✗，没走进阶范式。**正解（默认进阶档）✓**：`ArchitectureRegions.out_1`(BuildingPath) + `text_panel("/outer_door")` → `string_concat` 拼门路径 → `scene_focus_path`(在 `ArchitectureStructures.out_0` 里聚焦门) → 作 POI 接 `in_0`；`in_1`(上游空间) 另接 `ArchitectureRegions.out_2`(Rest)。**`in_0`(POI=门) 与 `in_1`(可铺路 scene) 是两个不同来源，绝不能都接同一个 `out_0`。** 简化档（建筑 out_0 直接接 in_0）只是无结构层时的兜底，别因省事默认用它。可照抄样例见 SKILL Step 3 与 PathConnection/README「POI 的进阶用法」。

- **截图已修好，必须真的看图——别再口称"读不了图"**：上次以"当前模型读不了图片/不支持把图片读进来"为由直接跳过截图验证✗——这是修复前的旧认知。**截图功能已修复✓**：`scene:screenshot.capture` 成功返回的就是**可直接观看的图片内容块**，直接肉眼判断布局对错即可，无需 Read 路径。**每加一层模板组后必须截图并真的看图**，不能只凭 `execute` 的 `completed` 或 jq 下结论。**只有返回 `capture timeout (no renderer connected?)` 这类错误才是真的没截到图**（如实上报，别当借口说读不了图）。

## 2026-06-13 · POI 门路径用 BaseName 猜导致 focus 失败（已取证，下次照做）
> 真实会话里：给 PathConnection 的 POI(in_0) 接 `scene_focus_path` 时，把门路径**写死成 `/block/outer_door`**（拿 AddBaseGrid 的 BaseName "block" 当路径前缀去猜）→ tree 里没这条路径 → focus 失败 → POI 链报错 → 干脆放弃 focus，把整张结构场景直接当 POI（粗糙降级，违背 Example1）。**修法已固化进 SKILL/persona，下次照做即可：**

- **别再用 BaseName 猜门路径**（`/block/outer_door`、`/ground/outer_door` 之类）——BaseName 不是路径前缀，猜出来的绝对路径在 tree 里不存在，focus **100% 失败**。
- **下次**：门路径前缀一律取 `ArchitectureRegions.out_1`(BuildingPath，运行时动态字符串句柄，值形如 `/architecture_0`)接进 `string_concat.a`，`string_concat.b="/outer_door"`，`result` → `scene_focus_path.path`，`scene_focus_path.scene ← ArchitectureStructures.out_0`（带门的结构场景）。已用 jq 核对 Example1 的 graph.json 实证就是这条链。
- **别因为 focus 报错就放弃 focus、把整张结构场景塞给 POI**——focus 失败 99% 是路径写法错（用了猜的绝对路径），**修路径而不是绕过**。把整场景当 POI 会让 explode 范围错、门口提取失真。坚持走 `BuildingPath → string_concat → scene_focus_path` 的进阶链。
- **不确定子节点名时用 `scene_focus_children`/`scene_get_attribute`（或 `node_explode`）在结构产物上探查真实子节点名**，拿到真名再拼路径，不要凭印象猜。

## 2026-06-16 · RandomNaturalDecoration 散布弯路（禁止再犯）
> 任务「在已铺草坪上撒多款植被」——在 **AddBaseGrid 接哪个 out**、**多品种装饰怎么链**、**merge 取哪个 out** 上绕了很大一圈。详见 `RandomNaturalDecoration/README.md`「多品种链式散布」。

### A. AddBaseGrid 输出：装饰必须接 **BaseNode `out_1`**（已栽三次弯）

| 端口 | 是什么 | 装饰链能不能接 |
|---|---|---|
| `out_0` | 裸 `grid2node` 网格 scene（未 focus 的 item） | ❌ 不是「在 base 上继续操作」的句柄；接上了有时能跑、语义错 |
| **`out_1`** | **BaseNode**（focus 到 `/lawn` 等命名 base 节点） | ✅ **第一组 RandomNaturalDecoration.in_0 必须接这个** |
| `out_2` | RootScene（整棵根 tree） | ❌ tree 级，不是「在 base 格子上撒点」的 item 句柄 |

> **一句话**：「在草坪 base 上继续撒植被」→ **`AddBaseGrid.out_1 → Dec_*.in_0`**。别把 `out_0`（裸 grid）或 `out_2`（RootScene）当装饰上游——文档/直觉都会误导，以 **`templates.get(AddBaseGrid)` + 本表** 为准。

### B. 多品种植被：一组一名 + 链式 Rest + 各自 density（禁止「一名多值共密度」）

- ❌ **错**：多个 `text_panel` 全塞进**一个** RandomNaturalDecoration 的 `in_1`（tree 多值）+ **一个** density → 无法分别调疏密。
- ✅ **对**：**每种植被各实例化一组** RandomNaturalDecoration，每组：
  - `in_1` ← **单个**资产名（用内置素材名）
  - `in_3` ← **独立** `number_const`（如 0.15 / 0.12 / 0.06 / 0.03）
  - `in_2` ← 共享 `seed_control.seed`（可复现）
  - **链式 Rest**：`Dec_A.out_3` → `Dec_B.in_0` → …（后一种只往前面没占的格子上撒）

### C. merge 必须取 **`out_0`（完整 scene）**，不是 `out_2`（NaturalDec）

RandomNaturalDecoration 端口语义（以 `templates.get` 为准）：

| 端口 | 含义 | merge 能不能用 |
|---|---|---|
| **`out_0`** | 本组处理后的**完整 scene 树**（底图 + 截至本组累积的所有装饰） | ✅ **汇总/visualization 接这个** |
| `out_2` | **NaturalDec**：仅本组**新撒**的那一类植被子树 | ❌ 只是增量片段，merge 会缺前面几层 |
| `out_3` | **Rest**：剔除已撒装饰后的剩余空地 | ✅ 链接下一组 `in_0`，**不**接 merge |

- ✅ **对**：各组 **`out_0`** → `tree_merge` → `tree_flatten` → **`scene_merge_subtrees`** → **`scene_output`**；若 merge 多组，**全部用 `out_0`**，cell 数应单调递增（如 512→711→891→1059）。

### D. 节点路径 `tree_N` ≠ 渲染匹配名（别被吓到）

- 模板内部 `grid2node` 固定前缀 **`tree_`** → 实例路径是 `/lawn/tree_0` … **正常**。
- 渲染器匹配的是 **`asset_name` 属性**（ObjectAssetName 子组把 `in_1` 写进每个实例）= 你填的资产名，**不是**路径里的 `tree_N`。不确定时用 `scene_get_attribute` 探 `/lawn/tree_0` 的 `asset_name`。

### E. 其它

- **`scene:renderer.setViewMode` → `topBillboard`** 验证（不是 `top`）。
- 截图视觉关时：execute 有 N 实例 ≠ 亲眼看布局命中；如实请用户在 Preview 确认。
