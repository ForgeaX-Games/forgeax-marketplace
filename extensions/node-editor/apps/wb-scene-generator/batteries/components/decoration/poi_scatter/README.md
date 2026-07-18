# 随机POI分布 (poi_scatter)

在单张网格指定区域值上随机散布兴趣点（POI），仅在目标格上写入 POI 点位 ID。

> **DataTree 数据格式**：`inputGrid` / `outputGrid` 均为 `grid`（`access: item`）。本电池每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。

## 功能特点

1. **单张多值网格输出**：每种 POI 一个递增 id 写入同一张 `outputGrid`，配合 `outputNameList` 可接 `grid_split_by_value` 拆分。
2. **多类 POI 同时布置**：通过 `poiRules` 数组一次声明多种 POI，每种有独立的目标区域值、数量和间距约束。
3. **最小间距保护**：同一网格内所有已放置点（含跨规则）共享最小间距检测，避免 POI 堆叠。
4. **ID 自动递增**：自动从输入网格最大值+1 开始分配 POI ID，不与已有掩码冲突。

## 适用情况

- 给已生成的地形/区域网格快速叠加洞穴、营火、遗迹等地标点位。
- 需要对一批网格（如多张地图）批量布置同类 POI。
- 只需要记录 POI 中心坐标（无足迹写回需求）时，比 `islands_poi_layout` 更轻量通用。
- 不适合需要 POI 足迹（周边地形改写）的场景，那种情况请在本电池下游再接足迹写回节点。

## 基本使用方法

1. 将上游地形网格接入 `inputGrid` 端口。
2. 在 `poiRules` 端口输入规则数组，每条规则至少包含 `decoration`（名称）和 `targetValue`（目标格值）。
3. 调整 `seed` 控制随机结果，POI ID 自动从网格最大值+1开始分配。
4. `outputGrid` 为单张多值网格，可接 `grid_split_by_value` 拆分后传给下游渲染或足迹写回节点。

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| inputGrid | grid | - | 单张输入网格 `number[][]`（DataTree 逐张处理） |
| poiRules | array | - | POI规则列表，见下方"POI规则格式"说明 |
| seed | number | 0 | 随机种子，0 使用当前时间自动随机 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| outputGrid | grid | 单张多值网格：每种 POI 一个递增 id，未放置处为 0 |
| outputNameList | array | 网格中实际出现的 POI 清单：`[{id, name, type}]`，type 固定为 asset |
| placedCount | number | 成功放置的 POI 总点数 |

## POI规则格式

### 规则数组格式

```json
[
  {
    "decoration": "洞穴入口",
    "targetValue": 7,
    "count": 4,
    "minDistance": 12
  },
  {
    "decoration": "营火点",
    "targetValue": 4,
    "count": 8,
    "minDistance": 8
  }
]
```

### 规则参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| decoration | string | "poi" | POI 名称，写入 `poiNameList` 的 name 字段 |
| targetValue | number | 1 | 目标格值，POI 只会落在等于该值的格上 |
| count | number | 5 | 该类型 POI 的目标放置数量 |
| minDistance | number | 8 | 与所有已放置点的最小格距（欧式距离） |

## 使用示例

### 输入示例

```json
{
  "inputGrid": [[4,4,7,4],[4,4,4,7],[3,3,3,3]],
  "poiRules": [
    {"decoration": "洞穴", "targetValue": 7, "count": 2, "minDistance": 4},
    {"decoration": "营火", "targetValue": 4, "count": 3, "minDistance": 3}
  ],
  "seed": 42
}
```

### 输出示例

```json
{
  "outputGrid": [[0,101,7,0],[0,0,0,100],[0,0,0,0]],
  "outputNameList": [
    {"id": 100, "name": "洞穴", "type": "asset"},
    {"id": 101, "name": "营火", "type": "asset"}
  ],
  "placedCount": 2
}
```

## 注意事项

1. **只写点位，不改地形**：输出网格中 POI 仅在中心格写入新 ID，不覆盖周边格子。如需足迹写回，请在下游接专用节点。
2. **跨规则共享间距**：同一网格内，不同规则的 POI 之间也会相互排斥（共享间距检测），密度过高时部分 POI 会找不到位置并被跳过。
3. **ID 分配**：POI ID 从当前网格最大值+1 开始递增，避免与已有掩码冲突。
