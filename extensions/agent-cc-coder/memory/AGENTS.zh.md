# cc-coder · 长期记忆

> 这份文件是 cc-coder 的 auto-pinned 记忆（每次 Bus 拼 system prompt 时自动塞进去）。
> 写在这里的内容会跨会话保留；只在某个具体任务里有用的请写 `lessons/<topic>.md` 或 `scenes/<scene>.md`。

## 当前 active 任务

（由 cc-coder 通过 `memory:write` 自维护。空表示无 active 任务。）

## 跨任务约束

- 测试三件套：`bun run tsc --noEmit` + `bun test test/<area>/` + （UI 改动时）Playwright 截图自校验
- commit 风格：`phaseX.Y: <subtask> [auto]`（daemon）/`<area>: <subtask>`（手动）
- 不动 `src/api/*` / `src/cli-providers/*` 现有 handler（需玩家 approve）
- bun 是包管理 + test runner，不用 npm
- 一切皆文件（DECISION #3）：进度 / 记忆 / lock 都走 fs

## 偏好

- 单文件优先于多文件抽象，三相似行比早抽象好
- 写注释只写 WHY 不写 WHAT
- 错误聚合（一次给玩家全清单）优于 first-fail

## 跨 agent 协作

| 找谁 | 干嘛 |
| --- | --- |
| iori | 玩法柱 / pillar 对齐 |
| suzu | 体验流程 / UX 决策 |
| kotone | 剧情 / 文案 / persona 文字 |
| iro | 视觉 / icon / sprite |
| oto | BGM / SE |

## lessons 索引

由 cc-coder 通过 `memory:write` 自维护到 `memory/lessons/<topic>.md`，每个 topic 一文件。读取走 `memory:read`，文件不存在视为无该 lesson。

## scenes 索引

同上 → `memory/scenes/<scene>.md`。一个 scene 一个 plot/system 片段，跨任务复用上下文。
