# 音频项目合约

音频项目是 Agent 与玩家“事件绑定”工作台共用的修订版草稿。它位于游戏目录，
但必须通过插件工具读写，不直接修改 JSON。

## 固定调用顺序

1. `inspect-audio-events`：只读发现候选事件。
2. `get-audio-project`：读取共享草稿与当前 revision。
3. `patch-audio-project`：使用 `expectedRevision` 增改或删除绑定。
4. 用户在工作台预览、修改并确认。
5. 再次 `get-audio-project`：接收玩家的最新 revision 和改动。
6. `apply-audio-project`：确认后生成游戏侧运行时。
7. 在真实游戏逻辑中插入 `gameAudio.emit(eventId, context)`。
8. `verify-audio-project`：验证资产、生成文件与字面量事件插桩。

## 绑定示例

```json
{
  "eventId": "combat.heavy_hit",
  "label": "重击命中",
  "enabled": true,
  "kind": "sfx",
  "assets": [
    { "assetId": "live-real-id-a", "file": "heavy-hit-a.wav", "name": "重击 A" },
    { "assetId": "live-real-id-b", "file": "heavy-hit-b.wav", "name": "重击 B" }
  ],
  "variation": { "mode": "random-no-repeat" },
  "trigger": { "delayMs": 0, "cooldownMs": 80, "probability": 1 },
  "playback": {
    "volume": 0.9,
    "bus": "sfx",
    "spatial": "3d",
    "mode": "one-shot",
    "fadeInMs": 0,
    "fadeOutMs": 60
  },
  "shaping": {
    "gainDb": 0,
    "pitchSemitones": 0,
    "highpassHz": 20,
    "lowpassHz": 16000,
    "eqLowDb": 2,
    "eqMidDb": 0,
    "eqHighDb": -1
  },
  "follow": {
    "field": "target.material",
    "defaultValue": "",
    "cases": [
      {
        "value": "metal",
        "assets": [{ "assetId": "live-metal-hit", "file": "metal-hit.wav" }]
      }
    ]
  },
  "conditions": [
    { "field": "damage", "operator": "gte", "value": 20 }
  ]
}
```

## 可编辑范围

- `enabled`：临时停用，不删除设计。
- `assets`：真实已挂载声音；可替换、增删和排序。
- `assets[].file`：可直接使用 `attach-audio` / manifest 返回的 `audio/foo.wav`，也可传 `foo.wav`；系统会统一保存为相对 `audio/` 目录的 `foo.wav`，禁止手工重复拼接目录。
- `variation.mode`：`single`、`sequential`、`random-no-repeat`。
- `trigger`：延迟/冷却为毫秒，概率为 0–1。
- `playback.volume`：线性音量 0–4；玩家界面以百分比显示。
- `playback.bus`：`sfx`、`music`、`voice`。
- `playback.spatial`：`2d` 或 `3d`。
- `playback.mode`：`one-shot` 或 `loop`；循环可配置 `stopEventId`。
- `fadeInMs` / `fadeOutMs`：0–60000 毫秒。
- `conditions`：事件 context 字段与 `eq/neq/gt/gte/lt/lte/in` 简单比较。
- `shaping`：事件级 Gain、Pitch、高低通和三段 EQ，统一作用于所有声音变体。EQ范围为 -12～12 dB。
- `follow.cases`：根据游戏值选择不同真实资产；未匹配时回退绑定顶层 `assets`。
- `follow.range`：把连续数值线性映射为音量、Pitch和低通。`min`必须小于`max`。
- 每条绑定最多一种`follow`规则；`cases`与`range`不能同时存在。
- 顶层`assets`不能为空，它是游戏没有传值或取值未知时的安全默认声音。

## 修订与确认

- 每次 patch 都传最后读取的 `expectedRevision`。
- `revision_conflict` 表示玩家或另一个 Agent 已经修改草稿；重新读取并逐项合并。
- `apply-audio-project` 必须使用最新 revision，并始终等待用户确认。
- apply 前草稿可反复编辑；apply 后继续编辑会产生新的 draft revision，不会静默覆盖已应用版本。

## 插桩纪律

- 从生成的 `src/forgeax-audio` 公开入口导入 `gameAudio`。
- 事件 ID 使用字面量，便于扫描与验证。
- context 只传条件或 3D 空间实际需要的数据。
- 离散的单次值随`gameAudio.emit` context传入；持续游戏状态或连续参数调用`gameAudio.setGameValue(field, value)`。
- 插桩位置代表事件真实完成；例如命中在伤害确认后，死亡在状态切换成功后。
- 不修改引擎、ECS、网关、工具注册或生成运行时内部实现。
