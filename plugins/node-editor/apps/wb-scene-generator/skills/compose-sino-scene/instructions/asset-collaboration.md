# 资产协作协议（调度 ↔ Sino ↔ Mira）

> Sino **只做场景布局，不生成任何图片/贴图/物件**。场景里要用的贴图(tile)与物件(object，可带碰撞)由 **Mira**（2D 资产生成器）生成。本文定义三方如何用一份 **`asset-requirements.json` 契约**协作，以及 Sino 如何导入与验收 Mira 的产物。

---

## 一、四阶段流程（调度 agent 驱动）

```
① 调度 → Sino：生成场景布局
② Sino → 调度：交付 asset-requirements.json（资产需求清单）
③ 调度 → Mira：按清单生成 → Mira 发布到共享游戏沙箱 → 回传 gameSlug + 结果路径
④ 调度 → Sino：导入沙箱资产、跑图、截图验收
```

| 阶段 | 负责 | 动作 | 产出 |
|------|------|------|------|
| ① 布局 | Sino | 用**语义资产名**（写进 `text_panel`）拼完整张场景，`execute` 跑通（先用内置素材占位） | 一张布局完成的场景图 |
| ② 收集需求 | Sino | 汇总场景引用到的每个资产 → 写 `asset-requirements.json`，交还调度 | `asset-requirements.json` |
| ③ 生成 | Mira | 读清单逐项生成，`asset2d:publishToGame` 发布进共享沙箱 | 沙箱 `textures/`（blobs + index.json）+ `gameSlug` |
| ④ 导入验收 | Sino | `scene:library.useGameTextures` 绑沙箱 → `library.list` 核对 → `execute`+截图验收 | 验收结论 / 回提需求 |

> **为什么 Sino 能给出 footprint 与 height**：Sino 在布局时本就为建筑/物件设了占地宽高（`PickOneBuilding` 的 AreaWidth/AreaHeight、BuildingHeight 等）、为底图/道路设了语义名。这些参数即资产的尺寸约束，收集需求时直接读出即可，无需另算。

---

## 二、`asset-requirements.json` 契约格式

Sino 在阶段②产出，落在当前游戏项目约定路径（建议 `<active_game>.dir/pipeline/asset-requirements.json`）。调度 agent 把它转交 Mira。

```jsonc
{
  "schemaVersion": 1,
  "gameSlug": "grass-village",          // 目标游戏 slug（导入/发布共享沙箱用同一个）
  "sceneProjectId": "p_xxx",            // Sino 当前场景项目 id（便于回溯）
  "assets": [
    {
      "name": "草地",                    // ★语义资产名 = 渲染图层名 = text_panel 里写的那个名字（Mira 与 Sino 必须一致）
      "description": "明亮的卡通草地底图，可平铺，低饱和绿色", // 给 Mira 的生成描述（风格/用途/色调）
      "type": "tile",                   // "tile"(可平铺底图/地面/道路) | "object"(独立物件，建筑/树/石等)
      "footprint": { "w": 1, "d": 1 },  // 占地（单位：格 cell）。tile 通常 1×1；object 用布局时设的 AreaWidth×AreaHeight
      "heightRatio": 0,                 // 相对高度比（0=纯平铺贴地；object 用 BuildingHeight/占地 估算的高度感，如 1.5）
      "autotileKind": "common_16",      // 仅 tile：autotile 规则（道路/地面边界过渡用）；不需要可省
      "collision": false,               // 仅 object：是否需要碰撞区域（true 时 Mira 产 geometryJson 碰撞掩码）
      "anchor": { "x": 0.5, "y": 1.0 }, // 仅 object：锚点（底边中心=0.5,1.0，billboard 站位用）；可省走默认
      "usedIn": ["AddBaseGrid.BaseAsset", "PathConnection.PathAsset"] // 该名字在管线哪些位置被引用（便于核对/回溯）
    }
  ]
}
```

字段说明：

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | **三方一致的语义名**。Sino 写进 `text_panel` 的就是它；Mira 发布时 `assetName` 用它；渲染器靠它匹配图层。 |
| `description` | ✅ | 给 Mira 的自然语言生成需求（风格、用途、色调、像素特征）。 |
| `type` | ✅ | `tile`（平铺：底图/地面/道路/水面）或 `object`（独立物件：建筑/树/石/道具）。 |
| `footprint{w,d}` | ✅ | 占地格数。tile=1×1；object 取 Sino 布局时设的占地宽高（如建筑 12×12）。 |
| `heightRatio` | ✅ | 相对高度。tile=0（贴地）；object 取高度感（建筑高=BuildingHeight 与占地的比例，植被按视觉）。 |
| `autotileKind` | tile 选填 | autotile 规则（如 `common_16`），需要边界自动过渡的地面/道路填。 |
| `collision` | object 选填 | 是否要碰撞区域；true → Mira 产 `geometryJson` 碰撞掩码（导入侧渲染/导出会消费）。 |
| `anchor{x,y}` | object 选填 | billboard 锚点；默认底边中心。 |
| `usedIn` | 选填 | 该名字被哪些管线端口引用，便于核对与回提。 |

> **像素尺寸比例**（用户要的"底面占地和高度"）= `footprint`(底面占地，格) + `heightRatio`(高度比)。Mira 据此决定出图的画布比例与锚点，保证 billboard 摆进场景时占地/高度与布局一致。

---

## 三、Sino 侧：收集需求（阶段②）

1. 布局完成后，遍历场景里所有 `text_panel` 承载的语义资产名（底图 BaseAsset、道路 PathAsset、湖 LakeAsset、装饰 AssetName、建筑 BuildingAsset 等）。
2. 对每个名字判定 `type`：底图/道路/水面/地面 → `tile`；建筑/树/石/道具 → `object`。
3. `footprint`/`heightRatio`：tile 填 `1×1`/`0`；object 读对应模板组的占地宽高与高度参数。
4. 写出 `asset-requirements.json`（上节格式），交还调度 agent。**不要自己去 `asset2d:*` 生成**——那是 Mira 的事。

---

## 四、Sino 侧：导入与验收（阶段④）

Mira 发布完成、调度回传 `gameSlug` 后：

1. **绑定沙箱**（把 Mira 发布的成品目录作为只读资产源）：
   ```json
   { "toolId":"scene:library.useGameTextures", "caller":{"kind":"ai"},
     "args":{ "gameSlug":"grass-village" } }
   ```
   > 共享沙箱在 `<projectRoot>/.forgeax/games/<gameSlug>/textures/`（Mira 的 `asset2d:publishToGame` 写入 blobs + index.json）。绑定后渲染器匹配池自动并入这些资产；tile 的 autotile、object 的碰撞 `geometryJson` + 锚点都在导入侧自动 compose，Sino **无需**手动处理。
2. **核对**：`scene:library.list`（默认 zone=`raw`）确认每个 `name` 都已就位（资产名/alias 与契约一致）。缺失或对不上 → 回提调度让 Mira 补。
3. **跑图 + 看图验收**：`scene:pipeline.execute` → `scene:screenshot.capture` **真的看图**——底图/道路/物件是否换成了 Mira 的新素材、占地与高度是否匹配、billboard 站位是否正确。
4. **验收结论**：符合 → 归档（见 SKILL 第五步）；不符 → 指出问题（哪个资产、什么不对）回提需求，或在布局侧微调后重新导入。

> `scene:library.publishExternal` 是已退役的单资产兼容回退，新流程**不用**它——一律走 Mira `publishToGame` + Sino `useGameTextures` 的共享沙箱通路。

---

## 五、调度 agent 侧：编排要点

- **串行依赖**：必须 ① Sino 布局完成 → ② 拿到 `asset-requirements.json` → ③ Mira 按清单生成完 → ④ Sino 导入。不要并行抢跑（Mira 没有需求清单无从下手；Sino 没有产物无从导入）。
- **传递载体**：用 `asset-requirements.json` 文件路径 + `gameSlug` 在两 agent 间传参，不要把大 base64 塞进对话（会被上下文压缩丢弃）。
- **派活**：用 `delegate_to_subagent(agent:"sino"/"mira", message:...)`，消息里带上契约文件路径与 `gameSlug`。
- **回路**：Sino 验收不通过时，调度据 Sino 的回提决定是让 Mira 重出（改 description）还是让 Sino 调整布局（改占地/高度），再走一遍 ②→④。
