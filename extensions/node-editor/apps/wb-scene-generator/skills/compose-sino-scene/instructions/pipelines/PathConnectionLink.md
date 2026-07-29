# 道路 - PathConnectionLink（连连看路网）

> 权威详情：[../../../../batteries/templates/structures/path/PathConnectionLink/README.md](../../../../batteries/templates/structures/path/PathConnectionLink/README.md)
> templateId：`PathConnectionLink`。端口与 **PathConnectionRandomWalk 完全一致**。
> 端口序号和语义（`label`）以 instantiateTemplate 返回的 exposedInputs/exposedOutputs 为准（勿 templates.get 预读）；本文档在 `label` 缺失或需要接线配方/数值参考时作补充。

## 选型

| 模板 | 路网风格 | 何时用 |
|------|---------|--------|
| **PathConnectionLink** | Prim MST + 连连看折线（≤2 转弯，规整） | 棋盘格/田园/城镇主街 — **默认推荐** |
| **PathConnectionRandomWalk** | MST + 正交 A*（更自然随机） | 栈道/崖边/野路 |

> ⚠️ **`PathConnection` 已更名** — instantiate 时用 `PathConnectionRandomWalk` 或 `PathConnectionLink`，**不要**写旧名 `PathConnection`。

## 端口（与 RandomWalk 相同）

| portName | 语义 | 必接 |
|----------|------|------|
| `in_2` | Scene — 上游 **Rest**（与 POI 校验同源） | **是** |
| `in_3` | point2d 列表 — POI（须提门，见 [PathConnection.md](PathConnection.md) §1） | **是** |
| `in_0` / `in_1` | RoadName / RoadAsset | 建议 |
| `in_15` | Obstacles（可选，建筑/水体绕行） | 否 |

| OUT | 去向 |
|-----|------|
| `out_1` | Path | 调试 / 领域引用 |
| `out_0` | Scene | `appendMergeItem` → `aw_m0_merge`（`{ label:"Scene", portName:"out_0" }`） |
| `out_2` | **Rest** → 下一组 `in_0`/`in_2`/`in_1`（Mountain/Hill/装饰 **串链**，禁止 fan-out） |

POI 推导、自检清单、merge 写法：**完全同** [PathConnection.md](PathConnection.md)。
