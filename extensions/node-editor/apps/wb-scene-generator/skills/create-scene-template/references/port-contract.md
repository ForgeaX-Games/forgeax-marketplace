# exposed 端口契约（NodeGroup JSON）

## 根对象字段

```json
{
  "id": "group_<timestamp>_<tag>",
  "name": "PickOneBuilding",
  "nameEn": "PickOneBuilding",
  "nodes": [ /* 含 __group__ 哨兵 */ ],
  "edges": [ /* 组内边 */ ],
  "exposedInputs": [ /* in_N */ ],
  "exposedOutputs": [ /* out_N */ ],
  "_nestedGroups": [ /* 完整子组定义 */ ]
}
```

| 字段 | 规范 |
|------|------|
| `id` | 库内稳定 id；`instantiateTemplate` 后运行时 **groupId 重新 mint**（除非 CLI 显式 pin） |
| `name` / `nameEn` | UI 与 `TEMPLATES_INDEX` 显示名 |
| `nodes[].opId` | 叶子 op 或 `__group__` |
| `__group__.params.groupId` | **必须**等于 `_nestedGroups[].id` |

## exposedPort 单条结构

```json
{
  "portName": "in_1",
  "portType": "scene",
  "access": "item",
  "sourceNodeId": "node-...",
  "sourcePortName": "scene",
  "hidden": false,
  "order": 2,
  "customLabel": "场景",
  "customLabelEn": "Scene"
}
```

| 字段 | 规范 |
|------|------|
| `portName` | **`in_N` / `out_N` 永不 remap** — Sino/文档/连线的稳定契约 |
| `portType` | `scene` / `point2d` / `grid` / `string` / `number` / … |
| `access` | `item`（单条 scene/point）或 `tree`（DataTree 包 string/list）或 `list` |
| `hidden` | `true` = 高级调参（密度/zRange/步长）；日常默认即可 |
| `customLabelEn` | **语义真源** — 编号 `in_3` 不透明，文档和 Sino 表都写 En 标签 |
| `sourceNodeId` / `sourcePortName` | 组内边界抽头；instantiate 时 **nodeId remap**，port 名不变 |

## 命名惯例

1. **编号不透明**：语义看 `customLabelEn`，不看 N 的大小顺序
2. **visible IN 最小集**：Scene + 本层算法必需参数 + 资产名
3. **visible OUT 五件套**（占空地类推荐）：
   - 主产物 Scene（Building/Path/Lake/Decoration…）
   - Rest Scene
   - 主 Path（*Path）
   - Rest Path（RestPath）
   - 可选整树 Scene
4. **资产 IN**：接 `type_string` 或嵌套组外显口；最终 `asset_name` 属性 = Preview 图层名

## _nestedGroups 要求

- 每个嵌套子组是**完整** NodeGroup（nodes, edges, exposedInputs, exposedOutputs）
- 父组 `nodes` 里 `__group__` 的 `id` 可与 `params.groupId` 相同
- instantiate 时 `buildTemplateOps`：**子 createGroup 先于父**；缺子组定义 → inner view 空白或失败

## 与 Sino 白名单的关系

- 模板**内部**可用任意 `alg_*`（私有实现）
- **顶层**图只允许 compose-sino-scene 工具白名单 + `__group__` 实例
- 新模板发布后，Sino 通过 `scene:pipeline.instantiateTemplate` 放置整组，**不在顶层直接 createNode alg_***

## README 端口表模板

每个 `templates/<cat>/<Name>/README.md` 至少：

```markdown
# Name（中文名）

> templateId：`group_...` 或 basename `Name`

一句话功能。

## 主要可见端口

| 方向 | portName | customLabelEn | 语义 |
|------|----------|---------------|------|
| IN | in_1 | Scene | 上游 Rest / BaseNode |
| OUT | out_2 | Rest | 链式下一组 Scene |

## 静默空跑

- 条件：…
- 验证：instantiate 后 execute，检查 outputs/<groupId>/out_1 children 非空
```
