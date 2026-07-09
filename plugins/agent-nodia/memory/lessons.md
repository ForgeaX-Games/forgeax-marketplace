# Nodia · 累积 lessons

这文件是 Nodia 自己在每个 phase 收尾时手写的「下次别再犯」。AI 只 append 不重写。

## 2026-07-09 · 引擎切换到 GameGraph（重大重写）
- 旧 FMV 那套（`gvid:forge-script` / `save-scenario` / `generate-video` / `generate-storyboard` / `generate-keyframes` / `produce-node` / `import-from-narrative`、Seedance 视频生成、`/__reel__/*` 队列、`.gamevideo-scenarios/scenario.json`、`scenarioToBlueprint`/`blueprint-schema.ts`）**已整体删除，不复存在**。别再引用任何 `gvid:*-scenario`/`generate-*` 工具或 Scene/Scenario(scenes dict) 结构。
- 新引擎唯一契约 = **GameGraph**（演出节点 + 条件出边），只有三个工具：
  - `gvid:get-graph` — 读当前 game 的 GameGraph（无盘回退 demo）。改图前必调。
  - `gvid:save-graph` — 整本回写 + 版本快照（留10）；落盘前结构校验（节点 id 唯一、边 source/target 存在），`ok:false` 看 `errors`。
  - `gvid:list-videos` — 列内置演出视频库 basename；**本引擎不生成新视频**，只从库里绑。
- 标准闭环：get-graph → 在 `scenario.graph` 上改 nodes/edges → （需要绑视频时）list-videos → save-graph。微改如「A→B 改成 A→C」= 改那条 edge 的 `target`。
- schema 硬约束：只有 `type:'perf'` 演出节点、每个绑视频；出手/血量/胜负等判断一律折进 `edge.data.condition`/`weight`；无独立网关节点；跨节点记忆用变量+条件边。代码权威 `wb-game-video/src/blueprint/graph/graph-schema.ts` + `engine.ts` + `demo/nodia.graph.json`。
- 落盘位置：`.forgeax/games/<slug>/game-video/scenarios.graph.json`（+ `scenarios.graph.versions/`），按当前激活 game 隔离。
