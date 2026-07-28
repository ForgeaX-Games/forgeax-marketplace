# Nodia · 累积 lessons

这文件记录已验证、下次必须继续遵守的事实。新增经验只追加，不用旧印象覆盖 schema。

## 2026-07-29 · 以 `@forgeax/wb-game-video` 当前契约为准

- `wb-game-video:get-graph`：无盘时返回 `{ project: null }`。
- `wb-game-video:save-graph`：传 `project`、`title?`、`gameSlug?`；成功返回 `{ ok: true, versions: [], gameSlug }`。
- `wb-game-video:list-videos`：返回可绑定 `media.ref` 的 `videos`。
- `wb-game-video:generate-shot-script`：传 `nodeName`、`storyText`，返回 `shots`。
- `wb-game-video:generate-keyframe`：传 `sceneNodeId`、`nodeName`、`beat`，返回 `asset`。
- `wb-game-video:generate-video`：传 `sceneNodeId`、`nodeName`、`characterRefIds`、`sceneRefIds`；`durationSeconds` 遵循 schema，当前最大 60 秒，返回 `asset`。
- `wb-game-video:generate-node-video`：传 `sceneNodeId`、`nodeName`、`characterRefIds`、`sceneRefIds`，返回 `assets[]`。
- `wb-game-video:list-assets`：按 `kind`、`productionType`、`sceneNodeId` 过滤，返回 `assets`。
- `wb-game-video:get-asset`：传 `id`，返回 `asset`。
- `wb-game-video:import-character-refs`：扫描 `characters`，返回 `refs`。
- `wb-game-video:import-scene-refs`：扫描 `textures`，返回 `refs`。
- 标准闭环是 get → 修改 `project.manifest.packs[*].graph` → 导入/生成媒体 →
  绑定 `asset.id` → save → playtest。
- `CORE_NODE_KINDS = perf / subflow / subflowPack`；`GraphCondition = { all: GraphClause[] }`。edge 只承载 condition/weight；效果通过 `node.data.reactions[].do` 中的 `{ kind: 'effect', effects: [...] }` 动作执行。
- UI 的真实路径是 `project.ui.overlays` 与 `node.data.overlayNodes`。没有可走
  edge 且调用栈为空时自然结束。
- 根文档是 `.forgeax/games/<slug>/blueprint.json` 与同级 `project.json`，
  素材在 `assets/`。代码权威路径是 `src/runtime/schema/graph-schema.ts`、
  `src/runtime/nodes/index.ts`、`src/runtime/engine/engine.ts` 和
  `src/editor/demo/nodia.graph.json`。
