# PlaceOneDecoration（单点装饰物）

> templateId（传给 `scene:pipeline.instantiateTemplate`）：`group_1783000010000_p1dec`，也可用 basename `PlaceOneDecoration`。

在指定**可放置区域**（上游 Scene 的底面形状）内，围绕参考 **Point** 尽可能贴近地放置**单个**装饰物：底面占地由 FootprintWidth × FootprintHeight 定义，竖向由 DecorationHeight 定义包围盒高度；放不下时 `alg_point2rect` 会自动缩小 footprint 直至完整落在区域内。

与 `PickOneBuilding`（建筑 + 随机 blocky 轮廓）互补；本模板**不做** blocky 雕刻， footprint 为精确矩形贴合。

与 `NaturalDecorationDistribution`（随机散布多棵）互补；本模板用于**精准指定**单个装饰物位置（如入口雕像、特定树、地标物件）。

## 主要可见端口

| 方向 | portName | 语义 |
|---|---|---|
| IN | `in_1` | Scene 上游可放置区域（通常接 Rest） |
| IN | `in_3` | Point 参考位置（`manual_points` → point） |
| IN | `in_5` / `in_6` | FootprintWidth / FootprintHeight 底面占地（格） |
| IN | `in_2` | DecorationHeight 竖向高度（格，写入 grid2node zRange） |
| IN | `in_0` / `in_4` | DecorationName / DecorationAsset |
| OUT | `out_1` | Decoration 装饰物 scene（主产物） |
| OUT | `out_3` | DecorationPath 路径句柄 |
| OUT | `out_2` | Rest 扣除装饰物后的剩余区域 |
| OUT | `out_0` | Scene 整树中间态 |
| OUT | `out_4` | RestPath |

其余 `in_*` 为 hidden 高级参数，默认即可。完整端口以 `scene:templates.get` 为准。

## 内部算法链（固定操作）

```
Scene → explode → rect_grid → voxel_slice → region
  → alg_point2rect(region, point, width, height)   # 贴近参考点、尽量保持 footprint
  → alg_region_subtract(全区域, 装饰 footprint)
  → grid2node(装饰, zRange=DecorationHeight) + ObjectAssetName
  → grid2node(rest) + 标准 Path 句柄
```

## 典型串联

```
… → Rest → PlaceOneDecoration.in_1(Scene)
manual_points → in_3(Point)
number_const → in_5/in_6/in_2(尺寸)
type_string → in_0/in_4(名称/资产)

PlaceOneDecoration.out_1(Decoration) → tree_merge
PlaceOneDecoration.out_2(Rest)       → 下一层 in_1 或 LakeRegions
```

多个精准装饰物：用 **`out_2`(Rest) → 下一实例 `in_1`(Scene)** 串联，每实例一个 Point。

## 验证要点

- `in_1` Scene 悬空 → 静默空跑，无 Decoration 输出。
- Point 落在区域外 0 格 → 算法取最近有效格再贴合矩形。
- 区域放不下目标 footprint → 自动缩小，仍尽量靠近 Point。
- execute 后本组 outputs 中 Decoration 子节点非空，Rest 为扣除 footprint 后的区域。
