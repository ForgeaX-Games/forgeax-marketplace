# `@forgeax-plugin/wb-character` — ForgeaX Workbench plugin

> 这是 `@forgeax-plugin/wb-character` 的 plugin 包装层。下层引擎仍然是 9-pipeline 的 character-editor (Three.js / Vite)，详见 `README.md`。

## 仓库定位

- **GitHub**: `ForgeaX-Games/forgeax-wb-character` (private)
- **挂载点**: `packages/marketplace/plugins/wb-character/` (二级 submodule，宿主仓 = `ForgeaX-Games/forgeax-marketplace`)
- **Plugin manifest**: `forgeax-plugin.json` — kind=workbench, 12 tools, 全部 exposedToAI

## 双模态契约

- **iframe 嵌入**: studio host 把 `dist/index.html` 当 static-serve 到 `/plugins/wb-character/`，Sidebar 一个 ⚒️ tab 起 iframe，中间是试 gameplay 视口
- **AI tool RPC**: forgeax-cli 走 `bus.call('character:<verb>', ...)` 命中 studio 主仓的 `/api/wb/character/*` handlers，再通过 `dispatchToSurface('wb-character', toolId, payload)` 推 pending 到 iframe，触发 `__ceInvoke(...)` 重渲染

两条路汇合在同一份 manifest + 同一目录 `.forgeax/games/<slug>/characters/<charId>/`。

## 本地开发

```bash
npm install         # 仅首次
npm run build       # 出 dist/，studio host 静态服务此目录
npm run dev         # vite dev 服 15173 端口（standalone 模式开发用）
npm test            # vitest
```

## AI 调用入口

`SKILL.md` 是给 AI 看的，开 `/character` 触发。

## 历史

最初是 `3rd/workbench/character-editor`，2026-05-21 收编进 ForgeaX，弃用 `wb-character-forge`。
