# 城镇岛状布局 (town_island_layout)

在输入网格内用双层 BSP 生成均匀的棋盘格道路，再用几何形状（圆 / 椭圆 / 有机不规则形）将其裁剪为孤岛状城镇轮廓，边界处的道路随机向外延伸后断开，形成自然的城镇入口桩。

## 功能特点

1. **双层 BSP 道路**：完整复刻 `chess_road_bsp` 算法，主路宽度与辅路宽度均可通过参数控制，生成均匀的棋盘格网格。
2. **三种岛型形状**：正圆（circle）、随机旋转椭圆（ellipse）、正弦波扰动有机形（organic），覆盖规整到自然的各种风格。
3. **基于覆盖率的块级过滤**：以 BSP 地块为单位计算形状覆盖率，超过阈值的地块保留，低于阈值的消除，产生自然的岛屿轮廓。
4. **边界道路延伸桩**：岛屿边缘的道路向外随机延伸若干格后断开，模拟城镇出入口路桩效果。
5. **独立输出三层网格**：主路掩码、辅路掩码、多值地块，可分别连接下游电池继续处理。

## 适用情况

- 城镇建造类游戏需要岛状 / 半岛状城镇布局
- 需要有机形状城市边界（非矩形）的 PCG 场景
- 接在 `noise_perlin` 或区域分割电池后，将任意形状区域裁剪为城镇
- 不适用于需要道路铺满整个矩形网格的场景（请改用 `chess_road_bsp`）

## 基本使用方法

1. 将任意网格（如全 1 矩形、或经过 noise 处理的掩码）接入 `inputGrid`
2. 调整 `shapeType` 和 `shapeScale` 决定岛的形状和大小
3. 调整 `coverageThreshold`（默认 0.6）控制边界粗糙度：值越高边缘越整齐，越低越参差
4. 将输出的 `mainRoad` / `subRoad` / `parcels` 分别接入建筑生成、贴图着色等后续电池

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| inputGrid | grid | — | 源掩码网格，非零单元格为可用区域 |
| mainRoadWidth | number | 2 | 主干道宽度（单元格数），推荐 2–4 |
| subRoadWidth | number | 1 | 支路宽度（单元格数），推荐 1–2 |
| mainBlockMinSize | number | 20 | 主路 BSP 叶块最小边长，控制主路稀疏度 |
| parcelMinSize | number | 8 | 辅路 BSP 叶块最小边长，控制地块大小 |
| splitRatio | number | 0.4 | BSP 分割比例下限（0–0.5），越大越均匀 |
| shapeType | string | "ellipse" | 岛型形状：circle / ellipse / organic |
| shapeScale | number | 0.5 | 岛型面积占 bbox 面积比例（0.2–0.9） |
| coverageThreshold | number | 0.6 | 地块保留覆盖率阈值（0–1） |
| borderExtendMin | number | 1 | 边界道路向外延伸最小格数 |
| borderExtendMax | number | 4 | 边界道路向外延伸最大格数 |
| seed | number | 0 | 随机种子（0 = 每次随机） |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| mainRoad | grid | 主干道掩码：主路格 = 1，其余 = 0 |
| subRoad | grid | 支路掩码：支路格 = 1，其余 = 0 |
| parcels | grid | 多值地块：每块唯一整数 ID，非地块 = 0 |
| nameList | array | 保留地块的 [{id, name}] 清单 |

## 参数说明

### shapeType 选项

| 值 | 效果 |
|----|------|
| `circle` | 正圆，半径由 shapeScale 决定 |
| `ellipse` | 随机长宽比椭圆（0.5–1.5），随机旋转角度 |
| `organic` | 椭圆基础上叠加 3–6 次谐波正弦波扰动，产生自然不规则轮廓 |

### shapeScale 说明

`shapeScale = 0.5` 表示形状面积约为 bbox（输入网格边界框）面积的 50 %。
- 0.3：较小城镇岛，大量空白区域
- 0.5：中等覆盖（推荐起点）
- 0.7：大面积城镇，仅切除边角

### coverageThreshold 说明

以 BSP 地块为单位计算形状覆盖率：
- 0.3：只要有 30 % 面积在岛内就保留 → 边缘粗糙/参差
- 0.6：60 % 以上才保留 → 边缘较整齐（默认）
- 0.9：几乎完全在岛内才保留 → 边缘非常整齐

## 注意事项

1. **网格尺寸建议 80×80 以上**：BSP 最小块尺寸（`mainBlockMinSize` + `parcelMinSize`）决定了最小可用网格大小，过小的网格可能无法进行有效分割。
2. **seed = 0 每次结果不同**：中心点、形状参数均由 RNG 决定，`seed=0` 时使用时间戳作为种子。固定 seed 可以复现结果。
3. **先执行再连线（动态端口规则）**：`nameList` 是数组输出，下游需要执行一次后再连线。
4. **mainRoad 优先于 parcels**：当 `mainRoad[r][c] = 1` 时，`parcels[r][c] = 0`，两者不重叠。
5. **borderExtendMax 建议不超过 10**：过长的道路延伸桩可能超出 inputGrid 边界，电池内部会自动截断到网格边界。
