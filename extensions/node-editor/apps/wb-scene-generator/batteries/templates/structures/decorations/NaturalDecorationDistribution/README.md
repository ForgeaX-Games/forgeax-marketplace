# NaturalDecorationDistribution（自然装饰散布）

> templateId（传给 `scene:pipeline.instantiateTemplate`）：`group_1782117984754_5oqi1`，也可用 basename `NaturalDecorationDistribution`。

在剩余空地上按密度散布自然装饰（树木、石头等）。接上一组的 Rest/Non-Path 场景。

## 主要可见端口

| 方向 | portName | 语义 |
|---|---|---|
| IN | `in_1` | Scene 上游剩余空地（**必接**） |
| IN | `in_0` | NamePrefix 名称前缀 |
| IN | `in_5` | AssetName 装饰资产名 |
| IN | `in_2` | Density 密度 |
| IN | `in_3` / `in_4` | seed / zHeight |
| OUT | `out_1` | Decoration 装饰（主产物） |
| OUT | `out_2` | Rest 剩余空地 |

`in_1` 悬空会导致整组静默空跑（execute 仍 completed）。完整端口以 `scene:templates.get` 为准。

---

## 如何用命令调用（输入侧）

> 文档标准见 [`../../_DOC_STANDARD.md`](../../_DOC_STANDARD.md)。

### 通道 B · 必接输入（**端口勿接反**）

| 本端口 | 语义 | 怎么喂 |
|--------|------|--------|
| `in_1` | Scene Rest | **`PlaceOneDecoration.out_2` → `scene_focus_path`（path=`/父区域/划分子区域1/rest/rest`）→ `in_1`** |
| `in_0` | NamePrefix | `text_panel`，如 `自然` → 子节点名 `自然0`、`自然1`… |
| **`in_5`** | **AssetName** | `text_panel`，如 `树` — **不是 `in_2`** |
| **`in_2`** | **Density** | `number_const` **0.01–0.015**（验证链 **0.012**）；禁止 >0.05 |
| `in_3` | Seed | `seed_control.seed` |

每组**一种** asset；多类资产请多实例 + Rest 串联。

---

## 如何用命令消费输出（输出侧）

| 本端口 | 典型下游 |
|--------|---------|
| `out_1` | Decoration scene → merge |
| `out_2` | Rest → 下一装饰 / LocalPrecise |
| `out_4` | 散布路径列表（headless 验收用） |

---

## 已验证调用示例

| 项 | 值 |
|---|---|
| **projectId** | `p_mr4b9s3j_dycp8k` |
| **报告** | [`step-m6-naturaldecoration.json`](../../../../../../../aw-support/battery-verify/p_mr4b9s3j_dycp8k/step-m6-naturaldecoration.json) |
| **groupId** | `verify_nd1` |
| **restFocusPath** | `/父区域/划分子区域1/rest/rest` |
| **density** | `0.012`；asset `树` → **`in_5`** |

```bash
PID=p_mr4b9s3j_dycp8k
curl -s -X POST "http://127.0.0.1:9557/api/v1/projects/$PID/execute/summary" \
  -H 'content-type: application/json' -H 'x-forgeax-caller-kind: ai' \
  -d '{"narrativeLocationNames":["父区域"]}' \
  | jq '.outputs.verify_nd1.out_4.itemCount'
# 预期 ≥ 3（含前缀 自然）
```
