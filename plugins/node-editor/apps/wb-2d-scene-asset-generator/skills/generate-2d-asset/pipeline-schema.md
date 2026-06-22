# 图生图管线 · applyBatch / 图结构

所有图变更走 `asset2d:pipeline.applyBatch`。`args` 形如
`{ ops: [...], opts: { actor, label } }`，每个 op 的**判别字段是 `type`**。

## op 写法（与内核 `@forgeax/node-runtime` Op 联合类型一致）

```jsonc
{ "type":"createNode", "nodeId":"prompt", "opId":"text_panel", "position":{"x":0,"y":0}, "params":{}, "name":"提示词" }
{ "type":"connect", "edgeId":"e1", "source":{"nodeId":"prompt","port":"output"}, "target":{"nodeId":"gen","port":"prompt"} }
{ "type":"updateNode", "nodeId":"pixscale", "params":{"width":128,"lock_aspect":true} }   // params 合并
{ "type":"deleteNode", "nodeId":"gen" }                                               // 级联删它的边
{ "type":"disconnect", "edgeId":"e1" }
```

- `opId` = 电池 id，**只从 `asset2d:batteries.list` 取**；端口名 **只从 `asset2d:batteries.get` 取**。
- **connect 的 `source.port` = 输出端口名，不是 params 字段名**（PART C 实测）：`text_panel` → **`output`**（内容在 `params.text`）；`number_const`/`toggle` → **`value`**。写成 `text` → 下游 spec 全空。
- `nodeId` / `edgeId` 你自己起，稳定可读（prompt / src / gen / nobg / pixfix / pixscale / view / out …）。
- `opts.actor` 用 `"ai:scene"`，`opts.label` 写一句话意图。
- **乐观锁（防并发覆盖）**：`pipeline.get` 返回的 `hash` 写入 `opts.expectedPrevHash` 再提交。
  若 UI/其他 agent 在此期间改过图，batch 返回 `status:"rejected"` + HTTP `409`，应重读 `pipeline.get` 后重试。

> ⚠️ **"ok 却空"陷阱**：`type` 拼错时内核不命中也不报错，applyBatch 照样返回 `{ok:true,newHash}`
> 但图没变。**每次 applyBatch 后立刻 `asset2d:pipeline.get`，确认 `nodes` 真的变了再往下走。**

## 最小可跑图：文生图 → 抠图 → 像素修复 → 像素缩放 → 预览 → 入库

```json
{ "toolId":"asset2d:pipeline.applyBatch", "caller":{"kind":"ai"}, "args":{
  "opts":{"actor":"ai:scene","label":"text2img → nobg → pixfix → pixscale → preview → output"},
  "ops":[
    {"type":"createNode","nodeId":"prompt","opId":"text_panel","position":{"x":0,"y":0},"params":{},"name":"提示词"},
    {"type":"createNode","nodeId":"gen","opId":"image_gen","position":{"x":260,"y":0},"params":{},"name":"生图"},
    {"type":"createNode","nodeId":"nobg","opId":"image_remove_bg","position":{"x":520,"y":0},"params":{},"name":"抠图"},
    {"type":"createNode","nodeId":"pixfix","opId":"image_pixel_fix","position":{"x":780,"y":0},"params":{},"name":"像素修复"},
    {"type":"createNode","nodeId":"pixscale","opId":"image_pixel_scale","position":{"x":1040,"y":0},"params":{"width":128,"lock_aspect":true},"name":"像素缩放"},
    {"type":"createNode","nodeId":"view","opId":"image_preview","position":{"x":1300,"y":0},"params":{},"name":"预览"},
    {"type":"createNode","nodeId":"out","opId":"image_output","position":{"x":1560,"y":0},"params":{"name":"圣诞树测试","overwrite":true},"name":"入库"},
    {"type":"connect","edgeId":"e1","source":{"nodeId":"prompt","port":"output"},"target":{"nodeId":"gen","port":"prompt"}},
    {"type":"connect","edgeId":"e2","source":{"nodeId":"gen","port":"image"},"target":{"nodeId":"nobg","port":"image"}},
    {"type":"connect","edgeId":"e3","source":{"nodeId":"nobg","port":"image"},"target":{"nodeId":"pixfix","port":"image"}},
    {"type":"connect","edgeId":"e4","source":{"nodeId":"pixfix","port":"image"},"target":{"nodeId":"pixscale","port":"image"}},
    {"type":"connect","edgeId":"e5","source":{"nodeId":"pixscale","port":"image"},"target":{"nodeId":"view","port":"image"}},
    {"type":"connect","edgeId":"e6","source":{"nodeId":"view","port":"image"},"target":{"nodeId":"out","port":"image"}}
  ]
}}
```

> 这是**像素风**的标准链：抠图后先 `image_pixel_fix` 还原真实像素网格，**有尺寸需求**再接
> `image_pixel_scale`（无需尺寸就省掉它）。**别再用 `image_resize`。** 生图阶段只在提示词里写长宽比、不写像素尺寸。
> 写实/卡通件不接 PixelFix/PixelScale，去掉这两个节点即可。

## 图生图变体

加一个参考图源，并把它连到 `image_gen.image`：

```jsonc
{"type":"createNode","nodeId":"src","opId":"image_source","position":{"x":0,"y":160},"params":{"image":"<{alias,blobId} JSON 或 data URL>","alias":"<参考图 alias>"},"name":"参考图"}
{"type":"connect","edgeId":"e6","source":{"nodeId":"src","port":"image"},"target":{"nodeId":"gen","port":"image"}}
```

> 参考图通常由用户从 generated asset folders **拖入画布**自动生成 `image_source`；
> 若手建，`image`/`alias` param 从 `asset2d:assets.list` 拿到的 alias 填。

## 入库命名（image_output）

给入库资产起人类可读名时，在 `image_output` 节点上设置 `name`（落到资产显示名字段，
支持中文）。两种填法，择一即可：

```jsonc
// 写法 A：直接在 out 节点 param 上设名称与标签
{"type":"updateNode","nodeId":"out","params":{"name":"圣诞树测试","tags":["xmas","tree"],"overwrite":true}}

// 写法 B：用一个 text_panel 输出名称，连到 image_output 的 name 端口
{"type":"createNode","nodeId":"name","opId":"text_panel","position":{"x":1300,"y":160},"params":{},"name":"资产名"}
{"type":"connect","edgeId":"e6","source":{"nodeId":"name","port":"output"},"target":{"nodeId":"out","port":"name"}}
```

- `name` 落到资产记录的**显示名字段**（卡片标题/检索/可重命名所用），`alias`（机读文件名）
  始终由后端自动生成，仅含英文数字。
- `overwrite`（默认 `true`）：同显示名资产存在时就地覆盖；`false` 则另存并自动加 ` (2)` 后缀。
- 入库后用 `asset2d:assets.get <alias>` 看记录的 `name` 字段，确认命名已落上。

## 运行顺序

1. applyBatch 建图 → `pipeline.get` 校验
2. 在 `text_panel` 写入提示词：`updateNode` 设 **`params.text`**（不是 `params.output`——`output` 是输出端口名）
3. **对 `gen` 调一次** `asset2d:generation.generateImage`（`nodeId:"gen"`, `prompt`, 图生图带 `images`）
4. `asset2d:pipeline.execute` 跑下游（nobg → pixfix →（按需）pixscale → view → out）；**image_gen 不会被重触发**
5. `screenshot.capture` / `preview.latest` 看结果，迭代
6. `asset2d:assets.get <alias>` 核对入库资产的 `name`（显示名）已按预期落上
