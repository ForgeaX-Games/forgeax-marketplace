# 模板 · ui_item_gen（背包物品 / UI 图标）

> [SKILL.md](../SKILL.md) 路由到此。通用操作流程见 SKILL.md 第二节。**端口以 `asset2d:groups.get` 为准。**

适用：**背包物品 / UI 图标**（默认 64px 像素、纯白底、黑描边），按物品属性 + 可选参考图生成。

## 暴露输入（连到 `<groupId>.端口`，喂未 hidden 的）

| 端口 | 含义 | 类型 | 喂什么 |
|---|---|---|---|
| `in_15` | name | string | 物品名（入库名 + 提示词主体） |
| `in_16` | label | string | 物品标签/分类 |
| `in_17` | level | string | 等级/品级 |
| `in_18` | tooltip | string | 物品描述（tooltip 文案，供提示词理解物品语义） |
| `in_19` | background | string | 底色/背景说明 |
| `in_20` | visual | string | 视觉风格描述 |
| `in_7` | reference1 | image | 可选参考图（图生图） |
| `in_8` | reference2 | image | 可选第二参考图 |

> `name`/`label`/`level`/`tooltip`/`background`/`visual` 是内部图标提示词模板的占位符，按需填；留空走默认。

## Run（runButtons：**一个 image_gen**）
对该 image_gen 的 `nodeId` 调一次 `generation.generateImage`。

## 暴露输出

| 端口 | 含义 | 类型 | 说明 |
|---|---|---|---|
| `out_2` | image | image | 图标成品（像素修复 + 缩放 + 抠净杂点） |
| `out_3` | error | string | 错误汇总 |
