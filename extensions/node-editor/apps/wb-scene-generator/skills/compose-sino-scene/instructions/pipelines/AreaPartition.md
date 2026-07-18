# AreaPartition · 功能分区管线

> templateId：`group_area_partition_district` / basename `AreaPartition`
> 算法：`alg_region_area_partition`（配额 Voronoi + Lloyd 松弛 + 边界后处理）

## 何时用

在**父区域**上按 **中心点 + 面积权重** 做**纯划分**，子区铺满父区域、两两不重叠。**不含水域** — 海岛用 `IslandRegions`。

**无 Rest / 剩余区** — 配额划分会分完父区域；模板**不输出** Rest / RestPath。

## 输入端口

| in | 类型 | 必接 | 说明 |
|----|------|------|------|
| `in_0` | scene | **是** | 待划分父区域；首组 `AddBaseGrid.out_1` |
| `in_1` | point2d list | **是** | 子区中心；N×`manual_points` → merge(`item`,`point2d`) |
| `in_2` | number list | 建议 | 面积权重；merge(`item`,`number`) — **禁止 tree** |
| `in_3` | string tree | 建议 | 子区名，如 `划分子区域1`… |
| `in_4` | string tree | 建议 | catalog tile 名列表 |
| `in_5` | number | 可选 | Seed |
| `in_6` | string item | **默认 organic** | BoundaryStyle |
| `in_7` | number item | 默认 8 | RelaxIterations |
| `in_8` | number item | 默认 12 | SmoothIterations |

## 边界风格（in_6）

| 值 | 视觉效果 | 适用 |
|----|----------|------|
| **organic**（默认） | CA 平滑，自然起伏 | 自由地块 |
| smooth | 更圆润 | 柔和自然区 |
| voronoi | 原始 Voronoi | 不规则多边形 |
| rectilinear | 直线田字格 | 棋盘格街区 |

### 避免生硬直线

- **勿**四角对称贴边 + 等权 `[1,1,1,1]`
- **要**中心内缩 3–5 格 + 互不相同面积权重 `[3,2,1.5,1]` + `organic`

## 输出

| out | 语义 | 去向 | 消费命令（白名单 opId） |
|-----|------|------|-------------------------|
| `out_0` | 主产物（父下挂全部分子区） | → `tree_merge` / 单区再施工 | `tree_merge`；单区：`text_panel`+`scene_focus_path`；多区扇出：`scene_focus_children` |
| `out_1` | Zones 子树 | 仅子区 scene 直传 | 同 `out_0` |
| `out_2` | ZonesPath | 拼 path 参考 | `string_concat` → `scene_focus_path` |

> 完整输入/输出命令示例见 [AreaPartition README](../../batteries/templates/structures/districts/AreaPartition/README.md) §如何用命令调用 / §如何用命令消费输出。

> 旧版 `out_1`(Rest)、`out_4`(RestPath) **已删除**。

## 施工纪律

- **一组一 execute**
- 禁止多 AP 并行接同一 BaseNode
- 再划分时 `in_0` 接**某一子区 scene**，不是 Rest
- execute 后应出现 N 个 `划分子区域*`，**不应**出现 `rest`
