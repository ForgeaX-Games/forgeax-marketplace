# 模板 · tile_gen（地形瓦片 / Autotile atlas）

> [SKILL.md](../SKILL.md) 路由到此。通用操作流程见 SKILL.md 第二节。**端口以 `asset2d:groups.get` 为准。**

适用：可无缝平铺的**地形瓦片 / Wang-Autotile atlas**。模板内部：生大块目标纹理 → TerrainExtract 提取 → AtlasCompose 用内置 4×N 模版合成 atlas → 入库。

## 暴露输入（连到 `<groupId>.端口`，喂未 hidden 的）

| 端口 | 含义 | 类型 | 喂什么 |
|---|---|---|---|
| `in_12` | name | string | 瓦片入库显示名（如 `草地瓦片`） |
| `in_13` | tile | string（下拉） | 瓦片种类：`floor`/`cliff`/`forest`/`flower_bed`/`tilemap`/`slope`（驱动内部分支） |
| `in_14` | description | string | 目标纹理描述提示词（强调铺满、俯视、无主体物件、无阴影） |
| `in_2` | imageSize | string | image_gen 生成档位 |

## Run（runButtons：**一个 image_gen**）
对该 image_gen 的 `nodeId` 调一次 `generation.generateImage`（生**大面积目标纹理**）。下游 TerrainExtract/AtlasCompose 是普通电池，`execute` 时执行。

## 暴露输出

| 端口 | 含义 | 类型 | 说明 |
|---|---|---|---|
| `out_3` | image | image | 合成的瓦片 atlas（与内置模版同分辨率） |
| `out_2` | error | string | 错误汇总 |

> 发布 tile：`asset2d:publishToGame` 传 `autotileKind`（如 `common_16`）；后端会校验 atlas 尺寸与该 rule 匹配。
