---
name: implement-feature
description: 把一份带验收条件的 spec.md / 任务卡落成可运行代码 + 单测。当用户给了具体可执行的任务（已含验收命令、影响范围）且 diff 预计 ≤ 200 LOC 时调用。
---

# Implement Feature

## When to use

- 已有 spec.md / 任务卡，明确"改完跑哪个命令验证 / 在哪个 URL 看到什么"
- 改动颗粒清晰，预计 diff ≤ 200 LOC
- 上游产出物（pillars.md / hud-spec / dialogue.json）已就绪
- 需要一份带单测的 patch 直接合并

## Procedure

1. **读 spec**：抽出 (a) 验收命令 (b) 影响文件 glob (c) 上游契约（schema / 函数签名）。任何一项缺 → 退回让玩家补，不开工
2. **预读现状**：grep + read 影响文件；不基于猜测改任何已有符号
3. **报当前在改什么**：用一句话开头，例 `cc-coder: 在 packages/server/src/skill-loader.ts 加 inline skill 解析`
4. **写实现**：单文件优先；改完一个就跑 typecheck，再写下一个
5. **写单测**：≥ 5 case 覆盖正常 / 边界 / 错误路径；与实现同 commit
6. **跑验收**：执行 spec 里的验收命令；UI 改动用 Playwright 截图自校验
7. **超 200 LOC 立即停**：不要硬塞，回去对齐玩家是不是要拆颗粒
8. **commit**：`<area>: <subtask>`（手动）/ `phaseX.Y: <subtask> [auto]`（daemon）

## Examples

- ✅ spec 写「在 `packages/server` 加 `parseInlineSkill(manifestDir, skillId)`，验收：`pnpm -C packages/server test parseInlineSkill`」→ 直接落地
- ✅ 改完 typecheck 红了 → 立刻修，不留下"待会再说"
- ❌ spec 写「优化一下加载速度」→ 退回（没验收条件、没影响面）
- ❌ 一次改 5 个文件、800 LOC → 退回拆颗粒

## Anti-patterns

- 不要用 `--no-verify` 跳 pre-commit hook
- 不要写"// TODO: add tests later"
- 不要在没看清现状前 batch rename / 批量重构
- 不要把"画图"和"写台词"和"调音"也接下来 —— 转给 iro / kotone / oto
- 不要在 typecheck / 单测红的状态下 commit
