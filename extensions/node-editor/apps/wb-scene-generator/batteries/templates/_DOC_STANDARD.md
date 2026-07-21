# 模板电池 README 文档标准（SSOT）

每个 `batteries/templates/**/<BatteryName>/README.md` **必须**包含以下两大块（与功能说明、端口表并列，不可省略）：

---

## 1. 如何用命令调用（输入侧）

说明 **Sino / CLI / HTTP** 如何把数据喂进本模板。固定结构：

### 通道 A · 实例化模板组

```json
{ "toolId": "scene:pipeline.instantiateTemplate",
  "args": { "projectId": "<pid>", "templateId": "<Basename>",
            "groupId": "<可选稳定句柄>", "position": { "x": 0, "y": 0 },
            "opts": { "actor": "ai:sino", "label": "实例化 <Basename>" } } }
```

> 模板组 **只走通道 A**，不经过 applyBatch 的 opId 白名单。

### 通道 B · applyBatch 接线（仅白名单工具电池 + connect）

对每个 **必接 / 建议接** 的 `in_*`，给出可照抄的 `createNode` + `connect` ops：

| 本端口 | 允许的上游 opId（白名单） | connect 示例 |
|--------|---------------------------|--------------|
| `in_0` | … | `{ "type":"connect", "source":{…}, "target":{ "nodeId":"<G>", "port":"in_0" } }` |

**白名单来源（与代码锁步）：** `backend/src/routes/sinoOpGate.ts` → `SINO_TOP_LEVEL_OPID_ALLOWLIST`；Sino 可见目录 = `scene:composerUtilities.list`。

**禁止写法：**

- 顶层 `createNode` 使用 `alg_*` / `rect_grid` / `grid2node` / `add_child` 等模板内部 opId
- `manual_points` 输出端口名写错（正确是 **`point`**，不是 `points`）
- `tree_merge` 缺 `params.inferredAccess` / `inferredType` / `portCount`

### 等价 CLI（可选）

与 applyBatch **同一套 op schema**，用 `forgeax node create` / `forgeax node connect` 或 `forgeax pipeline apply --ops '[…]'`。

### 读回验证（execute 后 jq）

```bash
curl -s …/execute -d '{}' | jq '.outputs.<G>.out_0[0].items[0].tree.children[].name'
```

> ⚠️ 禁止整体 dump `outputs`（含全 voxel，会爆上下文）。

---

## 2. 如何用命令消费输出（输出侧）

对每个 **`out_*`**，说明下游如何接：

| 本端口 | 语义 | 下游接法 | 允许的工具电池（白名单 opId） |
|--------|------|----------|-------------------------------|
| `out_0` | … | 直接 → 下一组 `in_0` / `tree_merge` | `tree_merge`, `scene_merge_subtrees`, `scene_output` |
| `out_1` | … | … | … |

### 常见消费模式（按场景选用）

| 模式 | 何时用 | 命令链（白名单 opId） |
|------|--------|------------------------|
| **直传** | 整棵产物给下一模板 | `<G>.out_N` → `connect` → `<Next>.in_0` |
| **汇总** | 多组主产物合并 Preview | 各组 `out_*` → `tree_merge`(tree,scene) → `tree_flatten` → `scene_merge_subtrees` → `scene_output` |
| **路径索引单个子节点** | 只要某一个子区/子建筑 | `text_panel`(绝对 path) 或 `string_concat` → `scene_focus_path`(scene+path) → 下一组 `in_0` |
| **扇出全部子节点** | 对每个子区并行施工 | `scene_focus_children`(scene) → `tree_merge`(item,scene) 或逐 branch 接线 |
| **读属性** | 读 focus 节点 metadata | `scene_get_attribute`（**仅人类/Workbench**；Sino 未开放则文档标注） |

**路径格式：** 绝对路径，以 `/` 开头，如 `/父区域/划分子区域1`。须与 `in_3` 子区名、父节点 BaseName 一致。

### 输出侧禁止

- 引用已删除端口（模板 CHANGELOG 须同步）
- 把 **`out_0`（未 focus 的 raw grid）** 当装饰链入口（若模板区分 focus / raw）
- 对 **list/tree 端口** 用错 `tree_merge.inferredAccess`（scene=tree，point2d/number/string 列表=item）

---

## 3. 文档维护

- 新增模板：README 从本标准复制骨架，填端口表 + 两节命令示例 + **已验证 projectId**（可选）。
- 改 exposedPorts：同步更新 README、`skills/compose-sino-scene/instructions/pipelines/<Name>.md`。
- 新增 Sino 白名单 opId：同时改 `sinoOpGate.ts`、`SKILL.md` 工具电池表、本标准涉及的消费模式表。

## 4. 参考范例

| 模板 | 输入命令完整度 | 输出消费完整度 |
|------|----------------|----------------|
| **AddBaseGrid** | ★★★ | ★★（待补输出消费表） |
| **AreaPartition** | ★★★ | ★★★（含 path 索引 + 扇出） |
| **PathConnection** | ★★★ | ★★（POI 进阶档 + Rest 链） |
