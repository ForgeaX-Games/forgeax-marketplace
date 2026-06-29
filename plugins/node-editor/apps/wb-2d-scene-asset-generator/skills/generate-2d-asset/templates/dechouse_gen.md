# 模板 · dechouse_gen（指定形状的装饰房屋贴图）

> [SKILL.md](../SKILL.md) 路由到此。通用操作流程见 SKILL.md 第二节。**端口以 `asset2d:groups.get` 为准。**

适用：**一张覆盖整栋建筑**的装饰房屋贴图（billboard object），形状由房顶占地掩码控制；模板内部把掩码渲成灰度底图后图生图，并同出底面碰撞图。

## 暴露输入（连到 `<groupId>.端口`，喂未 hidden 的）

| 端口 | 含义 | 类型 | 喂什么 |
|---|---|---|---|
| `in_4` | item_name | string | 房屋语义名（入库名 + 提示词主体） |
| `in_0` | json_mask | string | **房顶占地掩码 JSON 字符串**（`0`=空 / `1`=占地 / `2`=预设门位；与 Scene `building_footprint_mask` 对齐）。原样贴入 `text_panel.params.text` 再连进端口 |
| `in_1` | height | number | 房高（装饰房常用 1–2，最多 3–4） |
| `in_15` | roofType | string（下拉） | `flat`=平屋顶 / `pitched`=坡屋顶（按设定/风格选） |
| `in_3` | referenced_scene | image | 可选场景风格参考图（把其像素风格迁到灰度图上）；不连即纯灰度图生图 |
| `in_5` | imageSize | string | image_gen 生成档位 |

## Run（runButtons：**一个 image_gen**）
对该 image_gen 的 `nodeId` 调一次 `generation.generateImage`。模板内部已用强约束提示词（严守灰度形状 + 纯色背景），并按 `height`/`roofType` 渲灰度底图。

## 暴露输出

| 端口 | 含义 | 类型 | 说明 |
|---|---|---|---|
| `out_3` | image | image | 房屋成品贴图 |
| `out_4` | collision | image | 与房屋逐像素对齐的底面碰撞图 |
| `out_0` | error | string | 错误汇总 |

> 发布同 object：`assetType:"object"`，按需带 `geometryJson`/`anchorX/Y`。
