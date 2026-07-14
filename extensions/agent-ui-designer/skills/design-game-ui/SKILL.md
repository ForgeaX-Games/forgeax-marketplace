---
name: design-game-ui
description: 从 Iori 的玩法柱 + Iro 的画风 token + Suzu 的 hud-spec 出发，在 wb-ui 工作台走 genre → 屏流程 → 风格 → 组件 kit → 原型导出。当用户要 HUD / 菜单 / 商店 / 对话 / 结算等游戏 UI 时调用。
---

# Design Game UI

## When to use

- 用户要一套游戏 UI（HUD / 菜单 / 商店 / 对话 / 结算等）
- 已有 `ui/spec.json` 要续写 / 改风格（先读现状再改）
- 不要用它写玩法数值（Iori）、改 hud-spec 结构（Suzu）、写代码（cc-coder）

## Procedure

1. **读上游**：`code:read` `pillars.md`、`art-style.md`、`palette.json`、`hud-spec.md`。缺文件时向用户说明归属，并用 wb-ui 内置 style preset + 聊天确认 genre / 布局 / 风格兜底。
2. **打开 wb-ui**：走 genre → layout/screen flow → style → component kit → prototype。
3. **对齐 token**：色彩 / 圆角 / 描边 / 字体层级必须引用 palette 与 art-style，不要硬编码一套新视觉语言。
4. **产出三件套**：`ui/spec.json` + 组件 PNG + 可交互原型导出路径。
5. **emit 完工**：通知下游 UI 素材已就绪。

## Anti-patterns

- 不要没读 art-style / palette 就生图。
- 不要绕过 Suzu 的 hud-spec 私自改信息架构。
- 不要只交截图不写 `ui/spec.json`。
