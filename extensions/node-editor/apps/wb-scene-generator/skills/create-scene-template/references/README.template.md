# {{NameEn}}（{{中文名}}）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`{{group_id}}`，也可用 basename `{{NameEn}}`。

{{一句话功能}}。与 `{{ClosestTemplate}}`（{{差异说明}}）互补。

## 主要可见端口

| 方向 | portName | customLabelEn | 语义 |
|------|----------|---------------|------|
| IN | `in_1` | Scene | 上游 Rest / BaseNode |
| IN | `in_3` | Point | 放置坐标 |
| IN | `in_4` | {{AssetLabel}} | 资产名（object/tile） |
| OUT | `out_0` | Scene | 整树汇总口 |
| OUT | `out_1` | {{MainProduct}} | 领域主产物 scene |
| OUT | `out_2` | Rest | 剩余空地 → 下一组 Scene |
| OUT | `out_3` | {{MainProduct}}Path | 路径句柄 |

其余 `in_*` 为 `[hidden]` 高级参数，默认即可。完整端口以 `GET /api/v1/group-templates/:id?scope=templates` 为准。

## 链式接法

- 上游：**{{PrevTemplate}}.out_2 (Rest)** → 本组 `in_1` (Scene)
- 下游：本组 **out_2 (Rest)** → {{NextTemplate}}.in_1
- 汇总：本组 **out_0 (Scene)** → 根 merge；必须使用 `{ label:"Scene", portName:"out_0" }`
- 细化：本组 **out_1 ({{MainProduct}})** → 下游领域模板，禁止接 merge

## 静默空跑

- **条件**：`in_1` Scene 未接有效上游 → 整组无输出，`execute` 仍 `completed`
- **验证**：instantiate 后接 Rest → execute → `outputs/<groupId>/out_1` children 非空

## 内部实现摘要

- 嵌套子组：`{{ObjectAssetName|TileAssetName|MultiNames}}`
- 算法段：`{{alg_xxx}}`
- 参考：[TEMPLATE_PATTERNS.md](../TEMPLATE_PATTERNS.md) §4.x
