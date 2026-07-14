# 地形分带 - DistanceZones（按距离场分近/远区域）

> 权威详情（含端口表 + 内部流程 + 校验）：[../../../../batteries/templates/scene/DistanceZones/README.md](../../../../batteries/templates/scene/DistanceZones/README.md)
> templateId：`DistanceZones`。端口以 instantiateTemplate 返回的 exposedInputs 为准（勿 templates.get 预读）。
> 核心算法为模板组私有实现（到边界的距离场 + 阈值二分近/远），顶层看不到、不可摆放；整组走 `instantiateTemplate` 落地。

## 1. 管线电池的基本介绍

管线所属层级：**地形分区 / 区域细化层级**（在某个已有区域节点内部，按到边界的距离再切成两带）

管线效果：输入一棵 focus 指向**某个区域节点**（如海洋、岛屿）的 scene，按该区域到边界的**距离场**以自定义阈值切成**近处**(`Near`) 与**远处**(`Far`) 两块子区域，作为该节点的两个子节点挂回场景树。近、远并集恰好等于原区域。典型用途：

- **海洋分深浅**：输入海洋区域（内部含岛屿），`IncludeOuterBoundary=false`（默认）→ `Near`=浅海（靠岛岸）、`Far`=深海。
- **岛屿分海岸**：输入岛屿/实心陆地，`IncludeOuterBoundary=true` → `Near`=海岸线（靠外缘）、`Far`=内陆。

典型位置：**在 `AddBaseGrid` / `IslandRegions` 之后**——先有海洋或岛屿主体，再用它把这片区域分出深浅 / 海岸内陆，然后在 `Near`/`Far` 上分别铺不同贴图或继续布置。

## 2. 管线电池的总输入端口

| 端口名 | 类型 | 说明 | 是否必接 | 怎么喂 / 建议值 |
|--------|------|------|---------|----------------|
| `in_0` | scene | Scene focus 指向待分带的区域节点 | **必接** | 上游 `IslandRegions.out_2`(水域) / `out_1`(岛屿) 或某区域节点 |
| `in_1` | number | Threshold 近/远分界距离（含界归近） | **必接** | `number_const`：浅海/海岸带宽，未归一化时为格数（如 `3~6`） |
| `in_2` | bool | IncludeOuterBoundary 是否把区域外缘也作距离源 | 视用途 | 海洋分深浅=`false`(默认可不接)；**岛屿分海岸必接 `toggle`=`true`** |
| `in_3` | string | NearName 近处子节点名 | 建议接 | `text_panel`，如 `浅海` / `海岸线` |
| `in_4` | string | NearAsset 近处底图资产名 | 建议接 | `text_panel`，如 `浅海` / `沙滩` |
| `in_5` | string | FarName 远处子节点名 | 建议接 | `text_panel`，如 `深海` / `内陆` |
| `in_6` | string | FarAsset 远处底图资产名 | 建议接 | `text_panel`，如 `深海` / `草地` |

> 隐藏 `in_7..in_14`（connectivity / normalize / 切片 z / fillValue / 近远节点 schema·token·zRange）默认即可。
> ⚠️ `in_0` 的 focus 必须落在**已存在且占位非空**的区域节点上，否则静默空跑。
> ⚠️ 岛屿/实心陆地（无内部洞）若漏接 `in_2=true`，将没有任何距离源、整片归入 `Far`、`Near` 为空。

## 3. 管线电池的总输出端口

| 端口名 | 类型 | 说明 | 典型去向 |
|--------|------|------|---------|
| `out_1` | scene | Near 近处区域（浅海 / 海岸线，focus 已聚焦该子节点） | 在近带上继续铺贴图 / 撒装饰 / `tree_merge` 汇总 |
| `out_2` | scene | Far 远处区域（深海 / 内陆） | 在远带上继续布置 / 汇总 |
| `out_0` | scene | Scene 整棵合并后场景树 | 调试 / 汇总根 |
| `out_3` / `out_4` | string | NearPath / FarPath 路径句柄 | 一般不接 |

## 4. 参数范围组合套餐

| 套餐 | 输入区域 | IncludeOuterBoundary | Threshold | 效果 |
|------|---------|----------------------|-----------|------|
| 海洋深浅（推荐） | 海洋（含岛） | `false` | `3~6` | 岛周一圈浅海，外海为深海 |
| 窄海岸线 | 岛屿/陆地 | `true` | `2~3` | 仅外缘一圈海岸线，其余内陆 |
| 宽滩涂 | 岛屿/陆地 | `true` | `5~8` | 大片海岸带 + 较小内陆核心 |

- Threshold 单位与距离场一致：未归一化（默认）时为**格数**；若把隐藏 `normalize` 置真则为 `[0,1]` 小数。
- `connectivity` 默认 4（正交）；要更圆润的距离环可隐藏改 8。

## 5. 管线效果描述

- 把一片区域按「离边界多近」二分：`Near`=靠边界的带（浅海 / 海岸线），`Far`=区域深处（深海 / 内陆），各成一个带独立 `asset_name` 的子节点。
- 海洋与岛屿是**对称**的两种用法，仅靠 `IncludeOuterBoundary` 切换：海洋看「到内部岛屿的距离」（`false`），岛屿看「到外缘海岸的距离」（`true`）。
- 与 `IslandRegions` 的区别：IslandRegions 把空地**造出陆地/水域**（造区域）；DistanceZones 是在**已有区域内部**按距离**再分两带**（细化区域），通常接在 IslandRegions 或海洋主体之后。
