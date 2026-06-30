# 自适应逐房间家具放置器 (adaptive_room_furniture_placer)

按房间面积自动选择合适尺寸的家具，逐房间独立放置，保证每个房间都有与之匹配的家具。

## 功能特点

1. **面积分档**：自动将房间分为 small / medium / large 三类
2. **尺寸匹配**：small 房间只放 `small_*` 家具，medium 房间放 `small_*` + `medium_*`，large 房间放全部
3. **逐房间独立**：每个房间有自己的放置上下文，不同房间互不干扰
4. **主 + 填充两阶段**：先放主家具（每种一次），再填充小件直到占用率上限
5. **放置报告**：输出每个房间的面积、档位、放置数量，便于调试

## 适用情况

- 需要根据房间大小差异化摆放家具的室内游戏场景
- 包含大厅（大房间）+ 普通房间 + 储藏室（小房间）的复杂布局

## 尺寸档位划分

| 面积 | 档位 | 可用家具尺寸 |
|------|------|------------|
| ≤ smallMaxArea（默认30） | small | small_* 只 |
| smallMaxArea ~ largeMinArea | medium | small_* + medium_* |
| ≥ largeMinArea（默认100） | large | 所有尺寸 |

## furniture_id 命名规范

电池通过 `furniture_id` 前缀判断尺寸：
- `small_rect`, `small_square` → small
- `medium_rect`, `medium_square` → medium
- `large_rect`, `large_square` → large
- 组合家具如 `书桌_small`, `书桌_medium`, `书桌_large` → 取 `_small/medium/large` 后缀

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| layoutGrid | grid | — | complex_indoor_gen 输出（0=墙,1=房,2=廊,3=门） |
| mainList | array | [] | 主家具清单（furniture_rank_split.main_list），可含多种尺寸 |
| fillList | array | [] | 填充家具清单（furniture_rank_split.fill_list） |
| smallMaxArea | number | 30 | 小房间面积上限（格数） |
| largeMinArea | number | 100 | 大房间面积下限（格数） |
| seed | number | 42 | 随机种子，0=当前时间 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| newMaskA | grid | 合并后的家具掩码网格，非零值为家具编号 |
| furnitureIndex | array | 已放置家具编号列表 [{rank, name, isGroup}] |
| roomReport | array | 每个房间摘要 [{area, category, placedCount}]，可接调试输出 |

## 注意事项

1. 家具清单里建议同时包含 small/medium/large 三种尺寸，电池会自动选择
2. 只有值为 `1` 的格子才会放家具（走廊=2、门=3 不放）
3. 面积小于 6 格的连通块会被跳过
