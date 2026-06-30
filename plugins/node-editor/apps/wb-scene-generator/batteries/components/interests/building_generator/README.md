# 建筑生成 (Building Generator)

根据区域掩码列表批量生成完整的建筑平面结构，包含外墙、内墙分区、大门、内门、窗户和室内各房间地面。

## 功能特点

1. **完整建筑管线**：一次性完成从地块到室内的全部生成步骤，无需手动连线
2. **随机建筑雕刻**：对每个输入地块内置执行两层退线随机雕刻，生成自然凹凸的建筑轮廓
3. **BSP内墙分区**：使用二叉空间分区（BSP）算法在建筑内部生成内墙，将室内划分为多个房间
4. **智能开门**：外门优先选择外墙中段（避免角落），内门使用 Kruskal MST 保证所有室内房间互通
5. **均匀/随机开窗**：仅在内外均为空格的外墙格上开窗，支持随机布局和均匀布局两种模式
6. **按房间输出**：室内地面按4连通分量拆分，每个房间独立输出一张网格，便于分层渲染

## 适用情况

- 俯视角城市/村庄建筑的程序化平面生成
- 地牢、迷宫等室内场景
- 需要室内结构（墙/门/窗/房间）的任何 2D 游戏场景
- 与 `grid_label_multi_list` / `grid_label_double_list` 配合进行后续语义标注

## 基本使用方法

1. 将建筑地块掩码列表（`gridList`）连接到此电池
2. 根据需要调整外墙厚度、内墙密度、门窗参数和随机种子
3. `outputGridList` + `outputNameList` 即可直接传入渲染器或后续处理节点

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| gridList | array | - | 建筑地块掩码列表，也可传入单个网格 |
| wallThickness | number | 1 | 外墙向内厚度（格数），最小值1 |
| innerWallDensity | number | 0.5 | BSP内墙密度，0=无内墙，1=最大分割深度 |
| doorCount | number | 1 | 每栋建筑的外门（大门）数量 |
| doorWidth | number | 2 | 外门宽度（格数） |
| windowCount | number | 4 | 每栋建筑的窗户数量 |
| windowWidth | number | 2 | 窗户宽度（格数） |
| windowRandom | boolean | true | 窗户随机布局（false=均匀分布） |
| seed | number | 0 | 随机种子，0使用当前时间戳 |
| mergeOutput | boolean | true | 输出合并：同类语义跨建筑合为一张网格；false 时每栋建筑独立分层 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| outputGridList | array | 拍平的单值网格列表，每张只含一种语义，ID全局递增 |
| outputNameList | array | 名称清单，格式 `[{id, name, type}]` |

### 每栋建筑的输出层顺序

| 层名称 | type | 说明 |
|--------|------|------|
| 建筑N-外墙 | tile | 外轮廓减去门窗后的纯墙体 |
| 建筑N-大门 | tile | 外墙上的门洞位置 |
| 建筑N-内门 | tile | 内墙上的门洞位置（Kruskal MST保证连通） |
| 建筑N-窗户 | tile | 外墙上的窗洞位置 |
| 建筑N-室内1 | tile | 第1个连通室内区域（地面） |
| 建筑N-室内2 | tile | 第2个连通室内区域（地面），以此类推 |

## 内部管线说明

此电池内联了以下原始电池的完整逻辑：

```
building_carve       → 雕刻建筑轮廓
mask_outline         → 提取外墙轮廓（wallThickness层）
building_inner_wall  → BSP生成内墙
mask_subtract        → 外墙 - 内墙 = 纯外墙
batch_max_merge      → 外轮廓 + 内墙 = 全部墙体
building_door        → 在外墙上开外门
building_inner_door  → 在全部墙体上开内门（MST连通）
batch_max_merge      → 外门 + 内门 = 全部门洞
mask_subtract        → 全部墙体 - 全部门洞 = 纯墙（无门）
building_window      → 在外墙（无门）上开窗
mask_subtract        → 纯墙 - 窗户 = 最终外墙
mask_subtract        → 建筑实体 - 全部墙体 = 室内地面
grid_split_by_connectivity → 室内地面按房间拆分
```

## 使用示例

### 输入示例

```json
{
  "gridList": [[[0,0,0,0,0],[0,1,1,1,0],[0,1,1,1,0],[0,0,0,0,0]]],
  "wallThickness": 1,
  "innerWallDensity": 0.5,
  "doorCount": 1,
  "doorWidth": 2,
  "windowCount": 4,
  "windowWidth": 2,
  "seed": 42
}
```

### 输出示例

```json
{
  "outputGridList": [
    [[0,0,0,0,0],[0,1,1,1,0],[0,1,0,1,0],[0,0,0,0,0]],
    [[0,0,0,0,0],[0,0,0,0,0],[0,0,1,0,0],[0,0,0,0,0]],
    "..."
  ],
  "outputNameList": [
    {"id": 1, "name": "建筑1-外墙", "type": "tile"},
    {"id": 2, "name": "建筑1-大门", "type": "tile"},
    {"id": 3, "name": "建筑1-内门", "type": "tile"},
    {"id": 4, "name": "建筑1-窗户", "type": "tile"},
    {"id": 5, "name": "建筑1-室内1", "type": "tile"}
  ]
}
```

## 注意事项

1. **内墙密度为0时**：不生成内墙，所有室内区域连通，仍会生成内门（但不会有内墙，内门为空）
2. **外门优先选择较长的墙段**：短于6格的墙段不会被选为门位，小型建筑可能开门失败
3. **窗户条件较严格**：窗户仅在"内外两侧均为空格"的外墙格上开启，非常薄的建筑可能无窗
4. **室内房间数量**：由内墙密度决定，密度越高分割越细，室内层越多
