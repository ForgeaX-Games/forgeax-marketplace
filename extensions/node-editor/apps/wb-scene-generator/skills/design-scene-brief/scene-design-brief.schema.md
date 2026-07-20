# `scene-design-brief.json` 契约

> Sino「设计脑」阶段的**唯一产出**与下游（白盒 keypoint 求解 / 结构 / 布景 / 评审）的 **SSOT**。
> 本格式是 aw-support 上游 `ScenePipelineInput`（`aw-support/src/pipeline/types.ts`）的**超集**：
> 保留其全部既有字段并保持同名同义，**新增字段一律可选**，因此既能直接喂给现有
> keypoint 管线（多余字段被忽略），又承载了设计脑补齐的「四关注点」。

---

## 1. 设计目标：一张地图 = 一份 brief = 一个 scene project

- 一份 `scene-design-brief.json` 描述**整张地图**的设计意图树（root → 区 → 建筑 → 室内/物件簇）。
- 它**不是**多个文件、也**不**对应多个 project：下游在**同一个 scene project** 的 in-graph scene tree 里把每个 `location` 落成一个分支模块，最终 `scene_merge_subtrees → scene_output` 自动装配。
- `location.expand=true` 的节点表示「该 POI 还要展开其内部」（如钟表店→柜台/橱柜），递归仍发生在**同一 project 内**更深的子树，不另开 project。

---

## 2. 顶层字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `schemaVersion` | number | 否 | 本契约版本，当前 `1`。 |
| `sceneName` | string | 是 | 地图名（沿用上游）。 |
| `style` | string | 是 | 整体美术 / 世界基调一句话（沿用上游，喂 Mira 基准图）。 |
| `spawnLocation` | string | 否 | 出生点 `location.name`（沿用上游，游戏逻辑）。 |
| `designNote` | string | 否 | **新增**：设计脑对整张地图的总意图摘要（玩法主线 + 叙事主线 + 审美主张）。 |
| `locations` | `Location[]` | 是 | 设计意图树的扁平列表（用 `parent` 串成树，沿用上游）。 |

---

## 3. `Location` 字段

### 3.1 既有字段（与上游 `SceneLocation` 完全一致，不可改名/改义）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 唯一标识（树/邻接均按 name 引用）。 |
| `type` | string | 是 | `顶层世界` / `大型区域` / `中型区域` / `小型区域` / `建筑` / `室内房间` 等。 |
| `scale` | string | 否 | `XL` / `L` / `M` / `S`。 |
| `parent` | string \| null | 是 | 父节点 `name`；root 为 `null`。 |
| `adjacent` | string[] | 否 | 同级邻接节点 `name`（双向请两侧都写，闭环成路）。 |
| `layoutHint` | object | 否 | `{ inParent?: "东/南/中…", relativeTo?: { anchor, bearing, distance? } }`，喂 keypoint 求解。 |
| `description` | object | 否 | `{ semantic?, location?, art? }`：叙事语义 / 空间位置 / 美术氛围三段。 |

> 方位约定（与 `compose-sino-scene` 一致）：原点 `(0,0)` 左上角，右=东=`+x`，下=南=`+y`。

### 3.2 新增字段（设计脑补齐的四关注点 — 全部可选）

| 字段 | 类型 | 关注点 | 说明 |
|------|------|--------|------|
| `gameplay` | object | **游戏逻辑 / 白盒** | 关卡功能意图。`role`（如 `spawn`/`hub`/`combat`/`puzzle`/`gate`/`transition`/`boss`/`safe`/`loot`）；`keyInteractions?`（可交互点，如「桌底暗记」）；`encounter?`（遭遇/战斗节拍）；`gating?`（解锁/卡点条件）。 |
| `narrative` | object | **叙事** | `beats?`（在此发生的剧情节拍数组）；`reveals?`（此处揭示的信息）；`mood?`（情绪基调）。`description.semantic` 写「是什么」，`narrative` 写「这里发生什么」。 |
| `dressing` | object | **布景 / 环境美术 / 审美** | `keyProps?`（关键物件，如钟表店的 `["柜台","橱柜","挂钟墙","怀表展柜"]`）；`storytellingDetails?`（环境叙事细节，如「散落的齿轮」）；`density?`（`sparse`/`medium`/`dense`，装饰密度倾向）。 |
| `assetHints` | string[] | 资产 | 该节点关键语义资产名（地砖/物件），下游汇成 `asset-requirements.json` 的线索。 |
| `expand` | boolean \| object | **递归** | `true` 表示该 POI 需展开其内部为更深子树（如钟表店内部）。可写 `{ reason? }` 说明为何展开。子节点用 `parent` 指向本节点。 |
| `acceptance` | string[] | **评审** | 该节点的验收要点（供后续 sino-critic 生成 `review.json` 的打分依据）。 |

> 所有 3.2 字段缺省即「设计脑未特别指定」，下游按通用规则处理，**不破坏**现有 keypoint/构图流程。

---

## 4. 产出路径

- **aw-support 派工**：写入本次 `runDir` 根，文件名 `scene-design-brief.json`，与 `keypoint-layout-solved.json` 同级（它是 keypoint 求解的上游）。
- **Sino 独立对话**：写入 `<active_game>.dir/pipeline/scene-design-brief.json`，与 `asset-requirements.json` 同级。

---

## 5. 最小示例（西部世界·城镇+郊区，截断演示递归与四关注点）

```json
{
  "schemaVersion": 1,
  "sceneName": "无主之地·赤岩镇",
  "style": "美式西部、赤红荒漠、正午烈日、木栈与砂石、低饱和做旧。",
  "spawnLocation": "镇中心广场",
  "designNote": "玩法主线：从镇中心向郊区据点推进的线性潜入；叙事主线：钟表店暗藏的怀表是开启据点的钥匙；审美：镇内暖木暖砂、郊区冷峻荒凉对比。",
  "locations": [
    {
      "name": "赤岩区",
      "type": "顶层世界",
      "scale": "XL",
      "parent": null,
      "adjacent": [],
      "description": { "semantic": "一座建在赤岩荒漠边缘的边境聚落与其外围荒野。", "art": "赤红砂岩、正午烈日、做旧木构。" }
    },
    {
      "name": "赤岩镇",
      "type": "中型区域",
      "scale": "M",
      "parent": "赤岩区",
      "adjacent": ["镇郊荒野"],
      "layoutHint": { "inParent": "中" },
      "description": { "semantic": "本作前半场景，居民区与商铺沿主街排布。", "location": "赤岩区中部，向外即镇郊荒野。", "art": "暖木暖砂、晾衣绳、马槽。" },
      "gameplay": { "role": "hub", "gating": "取得钟表店怀表后才能进入据点" }
    },
    {
      "name": "镇中心广场",
      "type": "小型区域",
      "scale": "S",
      "parent": "赤岩镇",
      "adjacent": ["钟表店"],
      "layoutHint": { "inParent": "中" },
      "gameplay": { "role": "spawn", "keyInteractions": ["公告栏接任务"] },
      "narrative": { "mood": "正午喧嚣", "beats": ["开场：玩家在广场醒来"] },
      "dressing": { "keyProps": ["水井", "公告栏", "拴马桩"], "density": "medium" }
    },
    {
      "name": "钟表店",
      "type": "建筑",
      "scale": "S",
      "parent": "赤岩镇",
      "adjacent": ["镇中心广场"],
      "layoutHint": { "inParent": "东", "relativeTo": { "anchor": "镇中心广场", "bearing": "东" } },
      "description": { "semantic": "关键点：店主藏着开启据点的怀表。", "art": "暖黄烛光、木质橱柜、滴答钟声。" },
      "gameplay": { "role": "puzzle", "keyInteractions": ["翻找柜台抽屉取怀表"] },
      "narrative": { "reveals": ["怀表背面刻着据点坐标"] },
      "dressing": { "keyProps": ["柜台", "橱柜", "挂钟墙", "怀表展柜"], "storytellingDetails": ["散落的齿轮", "未完工的座钟"], "density": "dense" },
      "expand": { "reason": "钟表店内部需作为子场景细布柜台/橱柜/挂钟墙" },
      "acceptance": ["柜台可交互且醒目", "挂钟墙形成视觉焦点", "整体暖光不杂乱"]
    },
    {
      "name": "钟表店·店内",
      "type": "室内房间",
      "scale": "S",
      "parent": "钟表店",
      "adjacent": [],
      "dressing": { "keyProps": ["收银柜台", "靠墙橱柜×3", "挂钟墙", "工作台"], "density": "dense" }
    },
    {
      "name": "镇郊荒野",
      "type": "大型区域",
      "scale": "L",
      "parent": "赤岩区",
      "adjacent": ["赤岩镇"],
      "layoutHint": { "inParent": "西" },
      "description": { "semantic": "本作后半场景，散布遗迹与非法分子据点。", "art": "冷峻荒凉、枯木、风蚀岩。" },
      "gameplay": { "role": "transition" }
    },
    {
      "name": "非法分子据点",
      "type": "建筑",
      "scale": "S",
      "parent": "镇郊荒野",
      "adjacent": [],
      "layoutHint": { "inParent": "西" },
      "gameplay": { "role": "boss", "encounter": "潜入或强攻二选一" },
      "dressing": { "keyProps": ["了望塔", "栅栏", "篝火"], "density": "medium" },
      "expand": { "reason": "据点内部需细布装备架与非法分子营地装饰" }
    }
  ]
}
```
