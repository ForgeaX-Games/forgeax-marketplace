# NaturalDecorationDistribution（自然装饰散布）

> templateId（传给 `scene:pipeline.instantiateTemplate`）：`group_1782117984754_5oqi1`，也可用 basename `NaturalDecorationDistribution`。

在剩余空地上按密度散布自然装饰（树木、石头等）。接上一组的 Rest/Non-Path 场景。

## 主要可见端口

| 方向 | portName | 语义 |
|---|---|---|
| IN | `in_1` | Scene 上游剩余空地（**必接**） |
| IN | `in_0` | NamePrefix 名称前缀 |
| IN | `in_5` | AssetName 装饰资产名 |
| IN | `in_2` | Density 密度 |
| IN | `in_3` / `in_4` | seed / zHeight |
| OUT | `out_1` | Decoration 装饰（主产物） |
| OUT | `out_2` | Rest 剩余空地 |

`in_1` 悬空会导致整组静默空跑（execute 仍 completed）。完整端口以 `scene:templates.get` 为准。
