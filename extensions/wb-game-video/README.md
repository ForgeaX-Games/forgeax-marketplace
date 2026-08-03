# @forgeax/wb-game-video

玩法优先的视频游戏蓝图编辑器与运行时。它把视频演出、血条、QTE、限时选择和热点交互组合成可序列化的 `GraphLibraryDocument`，由纯 TypeScript 状态机确定性执行。

## 当前契约

- 图文档权威文件是项目根下 `.forgeax/games/<slug>/blueprint.json`；首次保存同时补齐 `project.json`。
- 未保存草稿留在浏览器 localStorage。空项目启动为空库；内置 Nodia demo 只在用户显式选择“重置”时载入。
- `wb-game-video:save-graph` 覆盖保存整份文档，`title` 当前忽略，成功返回 `{ ok: true, versions: [], gameSlug }`。
- 运行时组件位于 [`src/runtime/component-host`](./src/runtime/component-host)，图中只保存组件 id 与可序列化输入。
- 节点私有子流程使用 `data.subProcess = { entry, graph }` 显式嵌套；可复用子蓝图继续使用 `data.subFlowPack` 引用 `manifest.packs`。父子图之间不得直接连边。
- 扩展同时提供 11 个 AI 工具：图读写、内置视频列表、镜头脚本/关键帧/视频生成、素材查询和角色/场景引用导入。完整调用契约见 [`SKILL.md`](./SKILL.md)。

## 本地开发

本仓是独立仓库，使用 Bun：

```bash
git clone https://github.com/ForgeaX-Games/forgeax-wb-game-video.git
cd forgeax-wb-game-video
bun install
bun run dev
bun run test
bun run lint
bun run build
```

`@forgeax/extension-platform` 的 peer 与开发依赖都精确固定为 `0.0.2`。后端显式适配两种宿主上下文：

- Arrival：`gameId` + `cwd`（当前游戏根）+ `extensionDir`。
- ForgeaX：`game` + `projectRoot` + `cwd`（扩展安装根）；游戏根派生为
  `projectRoot/.forgeax/games/<game>`。

两种形态会按需归一为 `boundGameId`、`gameRoot` 和 `extensionRoot`。`list-videos` 只读取
扩展自带资源，因此仅要求 `extensionRoot`，无需绑定游戏；图读写、生成和共享素材等游戏相关
工具要求 `boundGameId + gameRoot`。后端不会读取 `.forgeax/active-game.json`，也不会从
进程当前目录猜游戏。可选 `gameSlug` 必须与宿主绑定 id 逐字一致；中文和单字符 id 合法，
空值、`.`、`..` 及含 `/` 或 `\` 的值非法。

## 代码导航

| 关注点 | 位置 |
|---|---|
| 图 schema 与校验 | [`src/runtime/schema/graph-schema.ts`](./src/runtime/schema/graph-schema.ts) · [`src/runtime/validate/validate.ts`](./src/runtime/validate/validate.ts) |
| 状态机与 session | [`src/runtime/engine`](./src/runtime/engine) |
| 覆盖组件与渲染注册 | [`src/runtime/component-host`](./src/runtime/component-host) |
| 蓝图画布 | [`src/graph`](./src/graph) |
| 编辑器、持久化和 demo | [`src/editor`](./src/editor) |
| AI 工具后端 | [`server/tool-handlers.ts`](./server/tool-handlers.ts) |
| 扩展声明 | [`forgeax-extension.json`](./forgeax-extension.json) |

历史设计记录位于 [`docs/superpowers`](./docs/superpowers)；代码、manifest、schema 与本页是当前发布契约。

## License

MIT
