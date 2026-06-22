# 区域嵌套 (Zone Nesting)

在目标掩码上做多层边缘侵蚀，得到有机嵌套轮廓；再对侵蚀后的外轮廓应用与「边缘样条化」相同的闭合样条算法并重绘为填充区域。

## 功能特点

1. **三种侵蚀**：元胞自动机、FBM 噪声、随机游走。
2. **五种样条**：贝塞尔(Chaikin)、自然三次样条、移动平均、高斯、折线扰动；默认高斯。
3. **独立随机种子**：侵蚀用 `seed`，折线扰动用 `splineSeed`，便于分别复现。

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| inputGrid | grid | — | 输入网格 |
| targetValue | number | 1 | 目标区域掩码值 |
| erosionStrength | number | 20 | 大于 1 时按 0~100 百分点；≤1 时为旧版 0~1 强度 |
| layers | number | 12 | 侵蚀层数 |
| algorithm | string | cellular | 侵蚀算法：cellular / noise / random_walk |
| seed | number | 0 | 侵蚀随机种子，0=时间戳 |
| splineAlgorithm | string | gaussian | bezier / cubic_spline / moving_avg / gaussian / polyline_perturb |
| splineSmoothness | number | 5 | 样条强度 1~20（与边缘样条化一致） |
| splineSeed | number | 0 | polyline_perturb 用，0=每次随机 |
| backgroundId | number | 0 | 样条重绘时背景格值 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| outputGrid | grid | 结果网格 |
| outputPoints | array | 样条后的闭合轮廓点 |

## 注意事项

1. 样条阶段仅追踪**最外层**连通区域边界，行为与「边缘样条化」一致。
2. 若侵蚀后目标区域过小或消失，样条阶段可能报错「找不到有效区域边界」。
