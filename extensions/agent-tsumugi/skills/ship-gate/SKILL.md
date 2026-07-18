---
name: ship-gate
description: 上线前最后一道工程 gate —— typecheck / 单测 / lint / bundle 大小 / 冷启动 / FPS 全部按阈值打表，任一未过就拦上线。当用户说「能上线吗 / 准备发布 / 上线前看一眼」时调用，或在改完构建配置 / CI workflow / 性能相关代码后主动跑一次。
---

# Ship Gate

## When to use

- 用户说「能上线吗 / 上线前 review / 准备发布」
- 改完 build 配置 / CI workflow / 任何标 `perf:` 的代码后，主动跑一次
- 跨大版本（schemaVersion 升、依赖大版本升）合并前
- **不要**在还没完成 feature 的 WIP 分支跑 —— gate 是给可上线分支看的

## Procedure

1. **定基线**：从 `<active_game>.dir/perf-baseline.md` 读上次基线；没有则当前值就是基线，写进去并提示「这是首次记录」。
2. **跑五项 gate**，逐项产出数值：
   - `typecheck` —— `tsc --noEmit`，必须 0 error
   - `unit` —— 项目自带 test 命令，必须全绿、无 skip 突增
   - `lint` —— eslint / biome，必须 0 error（warn 不拦）
   - `bundle` —— 产出 main bundle 大小（gzip KB），与基线 ±5% 内
   - `perf` —— cold-start ms / FPS（或项目 README 指定的 perf 指标），与基线 ±10% 内
3. **填表**：用下面的格式输出到 `<active_game>.dir/ship-gate-report.md`：

   ```
   | gate       | pass | 数值        | 阈值          |
   | ---------- | ---- | ---------- | ------------- |
   | typecheck  | ✅   | 0 errors   | = 0           |
   | unit       | ✅   | 312 / 312  | all green     |
   | lint       | ✅   | 0 errors   | = 0           |
   | bundle     | ❌   | 1.84 MB gz | ≤ 1.75 MB gz  |
   | perf-cold  | ✅   | 412 ms     | ≤ 450 ms      |
   | perf-fps   | ✅   | 60         | ≥ 58          |
   ```
4. **判决**：任一 ❌ → 在表下写「拦上线 · <gate> 超阈值」+ 一句最可能原因 + 一个最小修复路径。全 ✅ → 写「放行 · <date> <commit-sha>」并把当前数值更新进 perf-baseline.md。
5. **回滚假设**：每个 ❌ 末尾必须答「这次改动如果回滚到上一次绿色基线，会丢什么功能」—— 答不出来就把判决从 ❌ 升级为「阻断、需要 cc-coder 协同评估」。

## Examples

- ✅ 跑出 bundle 1.62MB（基线 1.60MB，+1.3%），perf-cold 408ms（基线 410ms），typecheck/unit/lint 全绿 → 放行，更新 baseline。
- ✅ bundle 涨 30%，原因是新加了 three.js 核心 —— 在表下注明「Iori 钦定的玩法支柱，不可回滚」，记录新基线后放行。
- ❌ 单测从 312 跌到 308，4 条 skip —— 拦上线，要求 cc-coder 答「为什么 skip」。

## Anti-patterns

- 不要为了让 gate 过去，改阈值 —— 阈值改动必须在 perf-baseline.md 单独 commit、说明原因
- 不要只看 typecheck 不看 perf —— 上线 gate 是工程纪律，单项绿不算绿
- 不要在 WIP 分支跑 ship-gate —— 数值会污染 baseline
- 不要把 lint warn 当 error —— warn 是给作者看的提示，error 才是 gate
- 不要省略「回滚假设」那一步 —— 它是工程纪律的最后一根弦
