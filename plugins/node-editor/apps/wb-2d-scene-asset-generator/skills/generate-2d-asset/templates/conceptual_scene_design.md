# 模板 · conceptual_scene_design（场景实景基准图）

> [SKILL.md](../SKILL.md) 路由到此。通用操作流程见 SKILL.md 第二节。**端口以 `asset2d:groups.get` 为准。**

适用：生成**一张完整、丰富的像素风游戏场景实景图**，用作后续美术资产生成/对齐的基准（统一像素颗粒度、配色、光照、透视）。

## 暴露输入（连到 `<groupId>.端口`，喂未 hidden 的）

| 端口 | 含义 | 类型 | 喂什么 |
|---|---|---|---|
| `in_5` | scene_name | string | 场景名（也作入库名）；可在其中写明场景内容/构图意图 |
| `in_4` | width | number | 画布像素宽 |
| `in_3` | height | number | 画布像素高 |
| `in_6` | image_size | string | image_gen 生成档位（`512`/`1K`/`2K`/`4K`） |
| `in_7` | referenced_image | image | 可选参考图（图生图，做风格/构图迁移）；不连即文生图 |

> 内部提示词模板还含「构图(composition)/风格(style)」等变量；若未单独暴露端口，则在 `scene_name`/参考图里描述，或进组内视图（`groups.get` 看内部 `prompt_template`）按需调整。

## Run（runButtons：**一个 image_gen**）
对该 image_gen 的 `nodeId` 调一次 `generation.generateImage`。

## 暴露输出

| 端口 | 含义 | 类型 | 说明 |
|---|---|---|---|
| `out_3` | image | image | 场景实景基准图（像素修复 + 缩放后） |
| `out_2` | error | string | 错误汇总 |
