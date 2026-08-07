# component-host/commons

预留：**真正跨游戏共享的公共组件**放这里（现为空）。

- `components/` = 本期组件集（本质属游戏，先留平台供各处引用；保存时同步一份到游戏仓 `.forgeax/games/<slug>/components/`）。
- `commons/` = 将来出现「所有游戏都通用」的组件时，放这里，由 `component-host` 与 `components/` / 游戏仓组件合并注册。

放入公共组件后，在 `component-host/index.ts` 里把 `commons` 也纳入 `registerBuiltins()` / 合并访问器即可。
