# @forgeax-extension/wb-game-video

玩法优先的视频游戏蓝图编辑器与运行时。它把视频演出、血条、QTE、限时选择和热点交互组合成可序列化的 `GraphLibraryDocument`，由纯 TypeScript 状态机确定性执行。

## 当前契约

- 图文档权威文件是宿主绑定游戏工作区内的逻辑路径 `blueprint.json`；首次保存同时补齐
  `project.json`。物理目录布局由宿主 workspace adapter 决定。
- 未保存草稿留在浏览器 localStorage。未初始化项目由 `GameBootstrap` 引导用户显式创建
  Nodia seed；已初始化 package 读取失败会进入可重试错误页，不会自动写入空蓝图。
- 游戏身份只来自宿主：后端读取 `WorkbenchExtensionContext.gameId`，浏览器等待 nonce-bound
  handshake 后读取 `ExtensionClient.ready()` 返回的 `gameId`。11 个 AI 工具都不接受调用者提供的
  `gameSlug`。
- `wb-game-video:save-graph` 覆盖保存整份文档，`title` 当前忽略，成功返回
  `{ ok: true, versions: [], gameSlug }`，其中 `gameSlug` 是宿主绑定 id 的回显。
- 运行时组件位于 [`src/runtime/component-host`](./src/runtime/component-host)，图中只保存组件 id 与可序列化输入。
- 扩展同时提供 11 个 AI 工具：图读写、内置视频列表、镜头脚本/关键帧/视频生成、素材查询和角色/场景引用导入。完整调用契约见 [`SKILL.md`](./SKILL.md)。

## 本地开发

本仓是独立仓库，使用 Bun：

```bash
git clone https://github.com/ForgeaX-Games/forgeax-wb-game-video.git
cd forgeax-wb-game-video
bun install --frozen-lockfile
bun run dev
bun run test
bun run lint
bun run build
```

要脱离 Studio 单独运行完整编辑器，使用开发 host shell：

```bash
bun run dev:standalone
# http://localhost:15185/dev.html
```

该入口仅在 Vite 开发服务中存在。它使用官方 `WorkbenchFrame` 提供同样的 nonce-bound
handshake，并将所选游戏的数据写入 `.workbench-dev/games/<gameId>/`。它不修改生产
`index.html`、扩展 manifest 或 Studio iframe 入口；Studio 仍使用宿主注入的真实游戏工作区
和服务能力。命令会先构建一次 Node 可加载的扩展后端，再启动前端与后端 watcher；开发
host 的版本记录与媒体存储是进程内实现，模型生成能力不可用。

`bun run build` 依次跑 frontend、backend、`build:standalone` 与 `check:release`。
Standalone 播放页产物在 `dist/standalone/`；单独构建或预览：

```bash
bun run build:standalone
bun run start:standalone
```

`bun run dev` 启动 Vite 开发适配器（固定 `15185`）和后端 watch。适配器只挂载
`/__workbench__/v1` 的标准 Workbench HTTP 契约；用宿主 iframe 的 nonce-bound
handshake 注入 game id、runtime id 和端点后再打开编辑器。它不提供旧的兼容业务路由。
本地游戏包保存在被忽略的 `.workbench-dev/games/<gameId>/`，首次 `initialize` 时由
扩展的 Nodia seed 创建 `project.json`、`blueprint.json` 与 `assets/manifest.json`。
`bun test` 是无 DOM 的 server/release-contract gate；浏览器、React 与 Vite 覆盖使用
完整的 `bun run test`（Vitest）。

`/workbench-host.2.3` 通过 registry 安装。开发和 CI 使用
`bun install --frozen-lockfile`，以 `bun.lock` 固定已发布的 Host 契约；不需要也不应配置本地
tarball、路径 override 或 vendored provenance。

### Media contract release dependency

浏览器素材库使用 Host 的 `/games/:gameId/media` 可恢复上传和元数据 API；扩展不再提供
`assets/wb-game-video-media.json` 或 `media/resources` 生命周期。该契约由
`/workbench-host.2.3` 发布并以 registry tarball + integrity pin 固定。

## 宿主集成

发布包要求精确 peer：`@forgeax/extension-platform@0.0.2` 与
`/workbench-host.2.3`。包导出：

- `@forgeax-extension/wb-game-video` / `./host` — Workbench 扩展 host（seed、工具、router）
- `@forgeax-extension/wb-game-video/standalone` — standalone 播放页 HTML（`dist/standalone/wb-game-video.html`）
- `@forgeax-extension/wb-game-video/styles.css` — 编辑器样式

其中的 `host` 提供游戏包 seed、11 个工具和扩展 HTTP router。生产宿主负责加载它，并为每个已解析的游戏
创建唯一的 `WorkbenchExtensionContext`：

```ts
import { host as videoGameWorkbenchExtension } from '@forgeax-extension/wb-game-video/host'
import { createWorkbenchExtensionContext } from '@forgeax/workbench-host/node'

const response = await workspace.withGameRoot(
  resolvedGame.id,
  { create: false, versioning },
  async (scope) => {
    const context = createWorkbenchExtensionContext({
      gameId: resolvedGame.id,
      gameRoot: scope.gameRoot,
      files: scope.files,
      media: hostMedia,
      models: hostModels,
      videoGeneration: hostVideoGeneration,
      services: hostServices,
    })
    const router = videoGameWorkbenchExtension.createRouter?.(context)
    if (!router) throw new Error('wb-game-video router is unavailable')
    const routed = await router.handle(request)
    return {
      ...routed,
      ...(routed.body ? { body: new Uint8Array(routed.body) } : {}),
    }
  },
)
```

上面的 context 构造必须发生在
`workspace.withGameRoot(resolvedGame.id, { create: false, versioning }, async (scope) => …)`
回调内；router 构造、请求处理与响应字节复制也必须在该回调返回前完成。不得根据
`gameRoot` 路径临时构造 files，也不得在 scope 关闭后保留 context。
`gameId` 与 `scope.gameRoot` 在进入扩展前就由宿主解析完成。扩展后端只使用 context 注入的能力：

- `files` 提供限定在游戏根内的读写、目录枚举和跨进程 `withLocks`；
- `media` 提供素材读写、幂等落盘与回收；
- `models` 提供文本、图片和视频生成；
- `videoGeneration` 是宿主的视频生成 job facade；
- `services` 是宿主限定范围的服务访问 facade；
- `gameId` 是工具调用和 HTTP router 的唯一游戏身份。

扩展不会再适配任何宿主产品专用的请求形状，也不会读取进程环境、全局 active-game 文件或
请求中的 `gameSlug` 来选择游戏。

浏览器端在初始化前必须等待 `createExtensionClient().ready()`。这次 nonce-bound handshake
返回精确的 `gameId`、`runtimeId`、capability 列表和宿主端点；浏览器不得从 URL query、
location 或默认 slug 推导这些值。包读写和扩展请求分别使用 `gamePackage` 与
`extension.fetch()`。版本入口仅在 `versions.supported()` 为 true 时显示，组件模块仅使用
`gameComponents.moduleUrl()` 返回的 handshake 端点；缺少相应 capability 时按“不支持”处理，
不得拼接备用 URL。

### 发布顺序

发布必须按以下顺序：

1. 先发布已经过评审的 `/workbench-host.2.3`；
2. 从 registry 验证其类型与能力契约，并更新 `bun.lock`；
3. 完成 frozen install、测试、构建和 pack 检查后，最后发布
   `@forgeax-extension/wb-game-video@0.3.2`。

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
