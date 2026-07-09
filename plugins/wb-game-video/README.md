# wb-game-video · 视频游戏工坊

> 玩法优先的视频游戏编辑器 + 运行时：把「演出(视频) + 血条/QTE/选择 + 分支判断」拼成一张
> 声明式图（`GameScenario`），纯 TS 状态机确定性回放。

---

## 架构（先读 [`AGENTS.md`](./AGENTS.md)）

**只有 graph 引擎一套**（`src/runtime/ / src/graph/ / src/editor/`）—— 蓝图编辑 / 试玩 / 视频 / 界面 / 规则。

- 一张 `GameScenario` 图：**只有「演出节点」（每个绑视频）**，判断（出手/血量/胜负/变招…）折进**条件/加权出边**，无独立网关节点。
- **SSOT = 插件内只读 `src/runtime/ / src/graph/ / src/editor/demo/nodia.graph.json`**；主动保存的版本落盘到 `.forgeax/games/<slug>/game-video/scenarios.graph.json`（+ 版本快照），未保存草稿走 localStorage，「重置」回 demo。
- 引擎纯 TS、零 DOM、种子 RNG；一切逻辑声明式可序列化、无函数入库。
- 盖在视频上的 QTE/血条/选择等 = `src/runtime/skins/components/` 下**自闭环、可替换、带错误边界**的组件，图里只记 `component` id。
- 应用外壳 `src/GraphApp.tsx`（split-pane：`?pane=left` 侧栏 / `?pane=center` 主区，`graphViewStore` + BroadcastChannel 同步当前 tab）。
- **AI 工具**（`server/tool-handlers.ts`）：`gvid:get-graph` / `gvid:save-graph` / `gvid:list-videos` —— AI 与人共同读/改同一份 GameGraph。
- 硬性规则（Schema / Runtime / 持久化 / 皮肤组件）见 **[`AGENTS.md`](./AGENTS.md)**；组件契约见 **[`skins/CONTRACT.md`](./src/runtime/skins/components/CONTRACT.md)**；AI 调用见 **[`SKILL.md`](./SKILL.md)**。

> ⚠️ **旧 FMV 内容生产整套（剧本/图像/剧情树/Seedance 视频生成/素材库：`scenario/`、`llm/`、`media/`、`editor/`、`player/`、`forge/` 等 + 17 个 `gvid:*` 视频工具）已于 2026-07-09 一刀切物理删除**；更早的旧蓝图引擎（`scenarioToBlueprint` / `blueprint-schema` / `blueprint/runtime` / `BlueprintPlayer`）亦不存在。任何 `Scene→Blueprint 编译`、`蓝图状态机运行时`、`gvid:*-scenario`/`generate-*` 的旧说法均已作废。

---

## 1 分钟跑起来

```bash
cd packages/marketplace/plugins/wb-game-video
npm run dev            # vite dev，端口 15185
npx vitest run         # 单测（vitest + happy-dom）
npx tsc --noEmit       # 类型检查（当前全绿）
```

## 文档索引

| 你要 | 看 |
|---|---|
| 玩法引擎硬性规则 / 关键目录 / 坑 / Backlog | [`AGENTS.md`](./AGENTS.md) |
| 皮肤/HUD/QTE 组件契约（props/submit/自闭环/错误隔离） | [`src/runtime/skins/components/CONTRACT.md`](./src/runtime/skins/components/CONTRACT.md) |
| AI 工具调用（get/save/list GameGraph） | [`SKILL.md`](./SKILL.md)（trigger `/gamevideo`） |
| 引擎设计规格 + 分期 + 实施状态 | `<repo>/docs/superpowers/specs/2026-07-06-wb-game-video-blueprint-orchestration-design.md` |
| 插件声明（surface / tool / port / permissions） | `forgeax-plugin.json` |

## License

MIT
