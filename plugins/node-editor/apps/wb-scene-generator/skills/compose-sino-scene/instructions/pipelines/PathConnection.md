# 道路 - PathConnection（道路连接）

> 权威详情：[../../../../batteries/templates/scene/PathConnection/README.md](../../../../batteries/templates/scene/PathConnection/README.md)
> templateId：`PathConnection`。完整端口以 `scene:templates.get` / `instantiateTemplate` 返回为准。

## 1. 管线电池的基本介绍

管线所属层级：**道路层级**

在 **POI 点集** 与 **可铺路的上游 Scene** 约束下，用 MST + 正交 A* 生成连通道路，输出 Path + Rest。

**整图通常只需一个 PathConnection**——多个连接点先经 `tree_merge`（item 档）合成 **point2d 列表**，再接入 `in_3`。

## 2. 输入端口

| portName | 类型 | access | 语义 | 必接 | 怎么喂 |
|----------|------|--------|------|------|--------|
| `in_2` | scene | tree | 上游可铺路空间 | **是** | 上一组 **Rest** |
| `in_3` | point2d | **list** | POI 点列表 | **是** | `tree_merge`(item) ← 多个 `manual_points` |
| `in_0` | string | item | RoadName | 建议 | `text_panel` |
| `in_1` | string | tree | RoadAsset | 建议 | `text_panel`，如 `石路` |

## 3. POI 列表合并（标准写法）

```jsonc
{ "type":"createNode", "nodeId":"poi_merge", "opId":"tree_merge",
  "params":{"inferredAccess":"item", "inferredType":"point2d", "portCount":4} }
// pt_n.point → poi_merge.item_0 … pt_w.point → poi_merge.item_3
// poi_merge.tree → PathConnection.in_3
```

`portCount` = POI 个数；**不要用 `inferredAccess:"tree"`**（那是 scene 汇总档）。

## 4. 输出端口

| portName | 语义 | 典型去向 |
|----------|------|---------|
| `out_1` | Path 道路 | `tree_merge` |
| `out_2` | Rest | 下一组 Scene |
| `out_3` | PathPath | 可选 |

## 5. 防呆

- **`in_2` + `in_3` 必接**；悬空静默空跑。
- **不要**每个方向各放一个 PathConnection；**一个实例 + POI 列表**。
- 验证：`execute` 后 `out_1` 非空且图层出现道路资产名。

## 6. 示例：中心向四向连到边界

8 个 POI 一次接入：四侧 (30,21)(30,39)(39,30)(21,30) + 边界 (30,2)(30,57)(57,30)(2,30) → `poi_merge.portCount:8` → 单个 `PathConnection`。
