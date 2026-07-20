# LingBot World 2 Prompt Language

## Layer ownership

| Layer | 唯一职责 | 常见冲突 |
|:--|:--|:--|
| `base` | 主体、环境、风格、固定地标和可用道具 | 写入 POV、移动、输入或 action |
| `camera` | 构图、跟随方式、look-input 含义 | 用无条件 motion verb 导致自行漂移 |
| `movement` | idle/travel 的主体行为与地面响应 | 重述主体外观或 camera |
| `events` | active action 引起的局部变化 | 重新选角、重写世界、假设其它 event 不存在 |
| `vertical` | jump/crouch/stand 的完整可逆动作 | 只有起跳无落地，或 camera 与主体动作相反 |

模型始终读取合成后的同一段 prose。一个 axis 只能由一个 layer 拥有。

## Base

结构：

```text
concrete subject + environment + visual style + two-to-four fixed anchors
```

规则：

- 主体只在 base 完整选角一次；其它 layer 用 definite reference。
- event 使用的道具必须在 base 和 prior 中可见且处于可用姿态。
- 对定义空间的少量地标写明确数量和固定位置。
- 描述存在的内容；避免用 “no/empty/nothing” 绘景。
- 不写 “camera follows”“the hero runs”“press W”。

## Camera

第三人称 static 模板：

```text
Third-person view, the {subject} locked at the exact centre of the frame at
constant size and distance. Neither the {subject} nor the camera moves on its
own; held look-input is the only source of camera motion, arcing the camera
around the stationary subject only while held.
```

第三人称 dynamic 模板：

```text
Strict third-person rear view, the {subject} locked at the exact centre of the
frame as the camera holds a fixed position behind and tracks forward.
The camera does not rotate around the subject; look-input becomes heading change.
```

第一人称以可见 anchor 替代 subject，并明确 look-input 改变 heading。

持续 directed camera move 需要同义 prompt hint；短促 mouse-look/jump arc 不需要：

```text
The camera orbits steadily around the stationary subject, which stays centred
at constant size as the viewpoint circles.
```

Hint 仅在动作期间存在，释放时原样移除。

## Movement

Static：

- 主体位置不变。
- 写两至三个可见微动作：呼吸、布料、手指、坐骑蹄子、车辆浮动。
- 姿态必须允许后续 event 使用道具。

Dynamic：

- 使用具体 travel verb。
- 写地面/水面接触与环境响应。
- 容易侧视漂移的角色、动物、坐骑要重申 rear-view 几何，但不重写 camera contract。

## Events

事件 detail 可以是：

- action beat：起手 → 轨迹 → 目标 → 材质结果 → 收稳
- environment transformation：变化作用于明确表面
- contextual entrance：原主体保持，次要对象进入
- staged spectacle：发生在 play axis 外，重复物逐次出现
- cause-and-effect：用可见机制拆成连续因果

约束：

- 任意两个 active events 必须能同时阅读。
- 不写 “the hero stands still and fires”；movement layer 已决定静止/移动。
- 风险名词使用贴近名词的单一 disambiguation guard。
- action beat 必须结束在稳定状态。
- 长时间 held 会累积漂移；作者文案不能承诺 release 后恢复已经改变的历史帧。

## Vertical

Jump：

```text
launch → airborne moment → return → stable landing
```

Crouch/stand 是互逆状态。camera 高度变化必须与主体姿态同向。车辆、坐骑和非人主体需单独写。

## Seed-image prompt

从以下内容派生：

```text
base + still framing from camera.static + pose from movement.static
```

删除 input contract；保留：

- 同一主体名词和外观
- 固定地标及位置
- event 会使用的可见道具
- static 构图与 idle 姿态
- 相同风格和光照

目标为 16:9。文本与图片冲突时，图片通常主导生成并以 artifact 表现。

## 字符预算

| Fragment | 目标 |
|:--|--:|
| base | ≤ 600 |
| camera variant | ≤ 300 |
| movement variant | ≤ 350 |
| event | ≤ 500 |
| 常见最坏组合 | 约 ≤ 2000 |

事件会叠加；预算检查至少覆盖最大的两个 event。

## 对齐检查

| 信号对 | 问题 |
|:--|:--|
| text ↔ image | 主体、道具、构图、材质是否一致 |
| text ↔ input | 只有 held movement/look/action 才触发对应运动 |
| text ↔ text | 各 layer 是否在争夺同一 axis |
| action ↔ runtime | profile event key 是否与 `actionKey` 完全一致 |
| camera ↔ pose | 持续 pose 是否有同义 hint，释放后是否清理 |

## 运行时限制

- Setter 在 chunk boundary 生效；极短点击可能不进入生成 chunk。
- Forward 通常比 lateral 稳定；能用转向解决时不要依赖大幅 strafe。
- 新 session 前几秒用于建立世界；关键剧情动作不得立即调度。
- 坏帧会进入自回归历史；修复后用干净 session 判断。
