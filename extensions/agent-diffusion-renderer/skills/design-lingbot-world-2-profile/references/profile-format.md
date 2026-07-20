# Profile Format

> [!WARNING]
> Portable catalog schema、Editor resolver 与 LingBot composer 已存在。本 Skill
> 本轮只输出预览；namespaced profile 和 Agent Pack 仍不可写入或注册。

## Portable manifest

目标路径：

```text
.forgeax/games/<slug>/visual-presentation/manifest.json
```

```json
{
  "version": 1,
  "entries": [
    {
      "continuityKey": "castle-night",
      "worldIdentity": "A silver-armored knight in a rain-soaked castle courtyard.",
      "description": "Cold moonlight, wet stone, fixed banners and one brazier.",
      "camera": {
        "idle": "Third-person view keeps the knight centred while look input is the only camera motion.",
        "moving": "Strict third-person rear view tracks the knight while look input changes heading."
      },
      "movement": {
        "idle": "The knight breathes steadily while rain runs from the armor.",
        "moving": "The knight advances across the wet stone with grounded footfalls."
      },
      "vertical": {
        "jump": "The knight springs upward, clears the wet stone, then lands.",
        "crouch": "The knight lowers into a compact crouch.",
        "stand": "The knight rises to full height."
      },
      "actions": [
        {
          "actionKey": "cast-fire",
          "active": "The knight raises the blade as fire gathers and streams toward the target."
        }
      ]
    }
  ]
}
```

### 约束

| 字段 | 约束 |
| :-- | :-- |
| `continuityKey` | 非空；manifest 内唯一；与 runtime intent/prior key 一致 |
| `worldIdentity` | 稳定主体、环境、风格；不得包含 Provider 命令 |
| `description` | 可选场景补充；不得复制 runtime action |
| `camera` / `movement` | 可选 `idle` / `moving` prose；不得包含 camera pose 数组或 SDK 命令 |
| `vertical` | 可选 jump/crouch/stand prose；只表达画面，不表达 provider 参数 |
| `actions[]` | 数组；每个 `actionKey` 在 entry 内唯一 |
| `active` | 必填；动作持续期间可见的状态 |

不得出现 `image`、JWT、model、command、camera pose 数组、chunk/latent 参数或 provider URL。

`continuityKey` 是游戏拥有的世界连续性标识，不是 provider session/token id。

## LingBot namespaced profile（延期，仅预览）

目标路径（本轮禁止写入）：

```text
.forgeax/games/<slug>/visual-profiles/lingbot-world-2/manifest.json
```

```json
{
  "version": 1,
  "entries": [
    {
      "continuityKey": "castle-night",
      "base": "A silver-armored knight in a rain-soaked castle courtyard...",
      "camera": {
        "static": "Third-person view, the knight locked at frame centre...",
        "dynamic": "Strict third-person rear view, the camera tracking behind..."
      },
      "movement": {
        "static": "The knight stands balanced, breathing slowly as rain runs from the armor.",
        "dynamic": "The knight advances across the wet stone, boots splashing through shallow water."
      },
      "events": {
        "cast-fire": {
          "active": "The knight raises the blade as fire gathers and streams toward the target.",
          "ended": "The flames fade and the knight lowers the blade into a balanced stance."
        }
      },
      "vertical": {
        "jump": "The knight springs upward, clears the wet stone, then lands in a balanced crouch.",
        "crouch": "The knight lowers into a compact crouch as the viewpoint settles closer to the ground.",
        "stand": "The knight rises to full height as the viewpoint returns to its normal level."
      }
    }
  ]
}
```

该 schema 尚未有 runtime resolver/consumer contract。Skill 可以用下面的
形状做设计讨论，但不得创建文件或注册 Agent Pack。

### 合成顺序（目标）

```text
base
+ camera[isMoving ? dynamic : static]
+ movement[isMoving ? dynamic : static]
+ active event details sorted by actionKey then instanceId
+ vertical
```

### 覆盖规则

- Profile entry 以 `continuityKey` 为单位完整覆盖 LingBot authoring（延期）。
- Entry 存在时，不混入 portable `worldIdentity/description/action prose`。
- Runtime actor、target、intensity 仍可由 Adapter 以确定性方式补充。
- Entry 不存在时，当前 LingBot composer 使用 portable catalog。
- Seed image 始终从 `visual-priors` 解析。

## Runtime action binding

```ts
interface VisualActiveAction {
  actionKey: string;
  instanceId?: string;
  actorId?: string;
  targetId?: string;
  intensity?: number;
}
```

匹配规则：

1. 用 `actionKey` 找 event definition。
2. 无 definition 时记录可诊断 issue；不得把未经作者化的程序员 key 直接塞入高保真 prompt。
3. 同 key 多实例按 `instanceId` 排序；无 `instanceId` 的实例排在前。
4. `intensity` 只调整 Adapter 已定义的措辞/权重，不直接拼浮点数。

## Budget report

Skill 输出：

```json
{
  "idleChars": 0,
  "movingChars": 0,
  "largestEventChars": 0,
  "worstCommonChars": 0,
  "limit": 2000,
  "status": "pass"
}
```

`worstCommonChars` 使用 dynamic camera、dynamic movement、最大的两个 events 与最长 vertical 计算。

Budget report 与 seed-image prompt 都是 Skill 派生产物；不得作为第二份 authored runtime SSOT 回写。
