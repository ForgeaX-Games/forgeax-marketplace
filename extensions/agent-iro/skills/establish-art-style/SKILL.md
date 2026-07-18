---
name: establish-art-style
description: 在画第一张 hero 之前先建立全游戏的视觉语言 —— 产出 art-style.md（线条/构图/风格关键词）+ palette.json（token 化色板）。当一个新项目还没有 art-style.md 或 palette.json 就有人想先要素材时调用。
---

# Establish Art Style

## When to use

- 新项目第一次开美术工作流，还没有 art-style.md / palette.json
- 已有 art-style 但 hex 散落各处、没有 token 化
- 玩家说"这游戏看着不像同一款"—— 一致性崩塌信号
- 需要在生成 sprite / 立绘 / VFX 前先固定视觉规范

## Procedure

1. **读上游**：Iori 的 pillars（视觉要表现哪些动作 / 状态 / 反馈）、Kotone 的 characters/*.md（性格肉眼可见的特征）、Suzu 的 hud-spec（UI 优先级 / 尺寸）
2. **抽风格关键词**：写出 3–5 个具体形容（"低饱和水彩 + 0.5px 线稿"），不写"清新""有质感"这种空话
3. **写 `art-style.md`**：分段
   - 线条（粗细 / 锐利度 / 是否手绘）
   - 配色情绪（玩家情绪 → 色相映射）
   - 构图规则（人物占画幅多少、留白比例）
   - 失败案例（哪些视觉会破坏一致性）
4. **写 `palette.json`**：所有颜色 token 化
   - 命名按用途：`hero-low-hp` / `boss-cooldown` / `ui-success-flash`
   - 每个 token 含 `hex` + `usage` + 至少一个 `pair-with` 兼容色
5. **反向校验**：随机挑 3 个未画素材，问"按这份规范我能立刻画吗？"答不出 → 规范不够具体
6. **只覆盖 art-style.md / palette.json，不连带画 hero**；hero 走单独素材生成 skill

## Examples

- ✅ `palette.json` 含 `{ "hero-low-hp": { "hex": "#C75B3F", "usage": "主角 HP < 30% 时角色描边", "pair-with": ["ui-warn-bg"] } }`
- ✅ art-style.md 写"线条：1px 锐利黑线，禁手绘抖动；构图：主角占画幅 60%，背景留 40% 给 VFX"
- ❌ "整体风格清新可爱" —— 没有可执行规则
- ❌ 没建立 palette 就先画了 hero portrait

## Anti-patterns

- 不要直接覆盖 art-style.md 旧内容；走 `2026-MM-DD revision` 段追加
- 不要让 palette 里有相同 hex 的两个不同 token —— 用途冲突时合并
- 不要在 hud-spec 没就绪时定 UI palette —— 顺序错了
- 不要在风格里写"参考 XX 游戏" —— 写出可执行的具体规则
