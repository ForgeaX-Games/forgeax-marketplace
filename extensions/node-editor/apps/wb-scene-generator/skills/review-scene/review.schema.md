# `review.json` 契约

> sino-critic 的产出，Sino 驱动「反复循环」的依据。一个 `review.json` 评审一个 scene tree
> 节点（或整图）。多次评审可追加到 `history`，或按节点分文件。

## 顶层字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `schemaVersion` | number | 否 | 当前 `1`。 |
| `target` | string | 是 | 被评审的 `location.name`（整图用 `sceneName` 或 `"__root__"`）。 |
| `reviewedAt` | string | 否 | ISO 时间戳。 |
| `scores` | `AxisScore[]` | 是 | 四维度评分。 |
| `punchList` | `PunchItem[]` | 是 | 可执行问题清单（可为空=无问题）。 |
| `verdict` | string | 是 | `refine` / `recurse` / `done`。 |
| `recurseInto` | string | 否 | `verdict=recurse` 时，要展开的 POI `location.name`。 |
| `summary` | string | 否 | 一句话总评。 |

## `AxisScore`

| 字段 | 类型 | 说明 |
|------|------|------|
| `axis` | string | `gameplay` / `narrative` / `dressing` / `aesthetics`。 |
| `score` | number | 0–5。 |
| `notes` | string | 该维度评语。 |

## `PunchItem`

| 字段 | 类型 | 说明 |
|------|------|------|
| `axis` | string | 同上四维度之一。 |
| `severity` | string | `blocker` / `major` / `minor`。 |
| `pass` | string | 该回哪道工序：`whitebox` / `structure` / `dress` / `design`。 |
| `detail` | string | 具体问题 + 期望修法。 |

## 示例

```json
{
  "schemaVersion": 1,
  "target": "钟表店",
  "reviewedAt": "2026-06-27T15:40:00Z",
  "scores": [
    { "axis": "gameplay", "score": 4, "notes": "柜台可达，进出动线清晰；puzzle 交互点位置合理。" },
    { "axis": "narrative", "score": 3, "notes": "怀表线索的空间承载偏弱，缺一个视觉锚点。" },
    { "axis": "dressing", "score": 2, "notes": "keyProps 只放了柜台，橱柜/挂钟墙缺失，东南角大片空白。" },
    { "axis": "aesthetics", "score": 3, "notes": "暖光基调对，但装饰单一、缺层次。" }
  ],
  "punchList": [
    { "axis": "dressing", "severity": "major", "pass": "dress", "detail": "补 LocalPreciseDecoration 在柜台周围播撒橱柜/挂钟墙；东南角用 NaturalDecoration 填背景。" },
    { "axis": "narrative", "severity": "minor", "pass": "dress", "detail": "用 PlaceOneDecoration 在柜台旁加一个怀表展柜作叙事锚点。" }
  ],
  "verdict": "recurse",
  "recurseInto": "钟表店·店内",
  "summary": "外部布局达标，店内（柜台/橱柜/挂钟墙）需展开细布。"
}
```
