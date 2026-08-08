# Audio Plan 合约

## resolve 请求

```json
{
  "schemaVersion": "audio-plan/1",
  "planId": "combat-core-v1",
  "projectId": "game-slug",
  "slug": "game-slug",
  "topK": 3,
  "items": [
    {
      "eventId": "player.heavy_attack.hit",
      "playerGoal": "确认重击已命中金属目标，并体现重量",
      "kind": "sfx",
      "cue": "combat.attack.impact",
      "directoryCategory": "3_combat",
      "directorySubcategory": "melee",
      "source": "sword",
      "targetMaterial": "metal",
      "intensity": "heavy",
      "exclude": ["voice", "music", "sci_fi"],
      "variantCount": 3,
      "priority": "core"
    }
  ]
}
```

## 字段纪律

- `eventId`：使用游戏语义，不使用文件名或素材 ID。
- `playerGoal`：描述玩家应获得的反馈，不描述“找一个好听的声音”。
- `cue`：表达发生了什么；命中、挥动、脚步、跳跃必须分开。
- `directoryCategory` / `directorySubcategory`：与玩家端共用的在线资产目录英文
  ID。能从需求稳定判断时一起填写并作为硬条件；不能判断时两者都省略。
- `source`：表达谁或什么发声。
- `targetMaterial`：只用于真实接触材质。
- `intensity`：只在策划或代码能判断力度时填写。
- `exclude`：只放硬排除语义。

## 结果语义

- `exact`：所有已指定结构字段均明确匹配，没有放宽项。
- `fallback`：核心 cue 仍成立，但存在缺标签、相邻力度或项目风格未命中；逐项读取 `relaxed`。
- `gap`：没有满足核心事件与硬排除的候选。
- `error`：输入或单项检索失败。

不使用数值分数作为通过门槛。分数只用于符合结构条件后的排序，不能把缺标签候选解释成精确命中。

## 固定约束顺序

1. `cue` 不放宽到其他核心事件。
2. 已填写的一级/二级在线目录不放宽。
3. `exclude` 永不放宽。
4. 已标注且冲突的 `targetMaterial/source` 直接排除。
5. 缺少 `targetMaterial/source` 元数据只能进入 fallback。
6. `intensity` 优先精确；相邻或缺失只能进入 fallback。

## apply 请求

将 resolve 的结果直接传递：

```json
{
  "slug": "game-slug",
  "planId": "combat-core-v1",
  "items": "<resolve返回的items>"
}
```

不要在两次调用之间重写资产 ID、URL、族或状态。apply 内部负责 manifest 校验、文件复用、并发下载和 `assetBindings` 合并。
