# 自然地物 - LakeRegions（湖泊区域）

> 权威详情（含可照抄 applyBatch/CLI + 验证）：[../../../../batteries/templates/scene/LakeRegions/README.md](../../../../batteries/templates/scene/LakeRegions/README.md)
> templateId：`LakeRegions`。完整端口以 `scene:templates.get` 为准。

## 1. 管线电池的基本介绍

管线所属层级：**自然地物层级**

管线效果：在**剩余空地上挖出湖泊区域**（水体），消费一块上游空间划出若干湖，没被占用的地作 Rest 继续往下传。典型位置：建筑/道路之后。

## 2. 管线电池的总输入端口

| 端口名 | 类型 | 说明 | 是否必接 | 怎么喂 / 建议值 |
|--------|------|------|---------|----------------|
| `in_0` | scene | 上游场景 / 剩余空地 | **必接** | `PathConnection.out_1`(Non-Path) 或上一组 Rest |
| `in_1` | number | ExpectedLakes 期望湖泊数 | 建议接 | `number_const`：点缀 `1~2`，水乡 `3~5` |
| `in_2` | string | LakeAsset 湖泊资产名 | 建议接 | `text_panel`，如 `湖` |
| `in_3` | number | Seed | 建议接 | `seed_control.seed` |

> 隐藏 `in_4..in_17`（大小方差/间距等）默认即可。

## 3. 管线电池的总输出端口

| 端口名 | 类型 | 说明 | 典型去向 |
|--------|------|------|---------|
| `out_0` | scene | 湖泊产物（主产物） | `tree_merge` |
| `out_1` | scene | Rest 剩余空地 | 下一组 `in_0`（链式） |
| `out_2`/`out_3`/`out_4` | scene/string | Lake / LakePath / RestPath | 一般不接 |

## 4. 参数范围组合套餐

| 套餐 | ExpectedLakes | 效果 |
|------|--------------|------|
| 点缀小水塘 | 1~2 | 少量水景点缀 |
| 多湖湿地/水乡 | 3~5 | 多片水面，水乡氛围 |

## 5. 管线效果描述

- 在剩余空地挖湖，产水体图层（名 = LakeAsset 文本，如 `湖`），数量随 ExpectedLakes。
- `out_1`(Rest) 继续给后续农田/植被链式使用。
