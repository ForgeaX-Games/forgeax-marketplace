---
id: make-game-design
trigger: /make-game-design
description:
  zh: 从一句话愿景起一份最小可玩游戏设计 (玩法 / 数值 / 角色 / 章节)
  en: Draft a minimal playable game design (gameplay, numbers, characters, chapters) from a one-line vision
allowedTools:
  - balance:resim
  - code:read
  - code:write
allowedAgents:
  - cc-coder
---

# /make-game-design

把"我想做个 XX 游戏"在 30 分钟内变成一份可以交给 cc-coder 落代码的最小设计文档。产出落到 `design/<slug>.md`,后续 workbench 直接读这个文件作为 ground truth。

## 触发场景

- 玩家在 chat 里说"帮我设计一个 …"或 "/make-game-design …"
- 当前没有 `design/<slug>.md`,或玩家明确要重写
- 玩家想从概念跳到可玩 demo,不想一上来写代码

## 流程提纲

### 1. 锁定一句话愿景 + 平台

问玩家:

> 用一句话告诉我:这游戏给谁玩,玩家在做什么。运行平台: web / 移动 / PC?

记录到 `design/<slug>.md` 的 `## Vision` 段。**禁止** 自己脑补玩家没说的范围。

### 2. 锁玩法 (1-3 个核心动词)

从愿景里抽 1-3 个动词,例如:**冲刺 · 闪避 · 投掷**。每个动词配一句"为什么这个动词让游戏好玩"。

如果抽不出 ≥ 1 个非平凡动词,**回到第 1 步**重新问玩家——愿景太抽象,设计无从落地。

### 3. 列 5-10 个角色草图

每个角色一行 yaml-ish:

```
- id: hero
  role: 主角 / 怪 / NPC
  avatar: 🧝
  stat: { hp: 100, atk: 12, def: 5 }
  hook: 一句话动机
```

数值是初步骨架,不用精调。

### 4. 写章节大纲 (3-5 章)

每章包含:
- 目标 (玩家完成什么)
- 节奏关键词 (探索 / 战斗 / 解谜 / 抉择)
- 引入的新元素 (技能 / 道具 / 角色)
- 估算分钟数

### 5. 跑数值假设

调 `balance:resim` 用 N=100 验证关键战斗 (主角 vs 第 1/3/5 章 boss):

```
bus.call("balance:resim", { scenario: "pve/chapter-1-boss", N: 100, teamA: ["hero"], teamB: ["boss-1"] })
```

把 winRate 写回章节大纲后面,如果偏离 0.55-0.70 区间太多,标 ⚠ 提示玩家调数值。

### 6. 输出 design/<slug>.md

把 1-5 步串成一个 markdown 文件,落到 workspace 的 `design/<slug>.md`,用 `code:write`。文件结构固定:

```
# <Title>

## Vision
## Core verbs
## Characters
## Chapters
## Balance pre-check
```

不要写其他段——更细的分镜 / UI / VFX 走对应 workbench 而不是 skill。

## 不要做的事

- 不要替玩家选游戏类型 (RPG / Roguelike / 平台跳跃) 除非玩家明确说
- 不要写代码——这是 skill 不是 codegen
- 不要落任何 `src/**` 文件
- 不要超过 200 行 markdown——超长的设计是没收敛的设计

## 完成判据

`design/<slug>.md` 存在,5 段都有内容,balance:resim 跑过至少 1 次并把结果写回。玩家说"OK 可以让 cc-coder 开干了"即 DONE。
