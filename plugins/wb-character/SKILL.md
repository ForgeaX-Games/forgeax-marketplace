---
name: wb-character:author-guide
description: 角色编辑器 9 条管线的 AI 调用指南
trigger: /character
---

# Character Editor · AI Skill

这个插件管 9 条角色制作管线 + 一份 manifest。资产落 `.forgeax/games/<slug>/characters/<charId>/`。

## 管线一览

| tool id | 用途 | 主要输出 |
|---|---|---|
| `character:generate-portrait` | 立绘 (可选三视图) | `portrait_front.png` (+ side/back) |
| `character:generate-sprite-sheet` | 行动小人 sprite sheet | `sprites/<action>.png` |
| `character:generate-pixel` | Q版像素 4 方向 | `pixel/<action>_<dir>.png` |
| `character:generate-spine` | 拆件绑骨 → skel/json | `spine/<charId>.skel` |
| `character:generate-vfx` | 技能特效配置 | `vfx/<skillId>.vfx.json` |
| `character:generate-monster` | 8 方向 × 5 动画怪物 | `monster/<charId>.zip` |
| `character:generate-video` | 视频片段 + 序列帧 | `video/<id>.mp4` |
| `character:generate-turnaround` | 三视图 | `turnaround/{front,side,back}.png` |
| `character:generate-vehicle` | 载具 + 动画帧 | `vehicle/<id>/*.png` |

## 调用之前要做的事

1. **先列已有角色**：调 `character:list` 看 `slug` 下有什么 —— 同名复用，别重复生成。
2. **确认 slug**：用户没说就用当前 workspace 的 active slug；空目录走 `_default`。
3. **prompt 标准格式**：用一句话描述特征（外貌 + 性格关键词），style 字段单独传，**别把 style 拼进 prompt**。
4. **怪物管线特殊**：`character:generate-monster` 调用前确认 `character:get(charId).portrait` 已存在 —— 怪物精灵从立绘衍生，没立绘会 422。

## 常见组合

- **完整新角色**：generate-portrait → list / get（确认 manifest）→ generate-pixel 或 generate-sprite-sheet
- **怪物**：generate-portrait → generate-monster
- **战斗角色**：generate-portrait → generate-spine → generate-vfx

## 失败兜底

- 422 quota-exceeded → 切下一个 vendor（seedream → gemini → azure-gpt-image）
- 500 internal-error → 读 `character:get` 看 manifest 状态，可能是 partial 写入 —— 删除中间产物重试
- monster 管线返回 503 → 后端 Python pipeline 没起；提醒用户检查 wb-character 仓的 `server/` 进程

## 写入约定

所有 asset 落到 host project root 下的 `.forgeax/games/<slug>/characters/<charId>/`。manifest schema v2 字段：

```
{ schemaVersion: 2, charId, slug, name, prompt, style,
  portrait: { front, side?, back? },
  pipelines: { pixel?, spine?, video?, vfx?[], monster?, vehicle? }
}
```

读现状用 `character:get`，别直接 fs.read —— 走 tool RPC 保证 host 和 AI 看到同一份。

## Surface 视角（DUAL-MODALITY）

除了 18 个 `character:*` tool，本插件也注册了两个 surface 让 AI 看玩家
当前在 UI 里看到/选中了什么：

- **`wb-character.list`** — 玩家在角色列表面板看到的快照
  `bus.query('ui.surface.snapshot', { surface: 'wb-character.list' })` 拿到
  `{ slug, selected, characters: [...] }`，比 `character:list` 多一个
  `selected` 字段（玩家当前焦点角色）。AI 听到「改一下狐狸属性」时优先
  把 `selected` 当默认对象，避免再问。
- **`wb-character.create`** — 玩家在生成面板看到的快照
  字段含 `armedPipeline`（玩家正打算跑哪条管线）/ `draft`（输入框里
  打到一半的 prompt 文本）/ `lastResult`。AI 在 chat 里说「帮我把这个
  prompt 跑出来」时直接读 `draft.prompt` —— 玩家不需要复制粘贴。

两 surface 的 action（list/get/rename/select 与 generate-*）跟同名 tool
1:1 对应；走 surface dispatch 跟走 tool call 写同一份文件、过同一根
ledger，区别只在 surface 路径会同步把 UI 的 `selected` / `armedPipeline`
更新到玩家眼前。

manifest 里 `requireConfirm: "destructive"`（`rename`）和
`requireConfirm: "always"`（`generate-monster`）会让 AI 路径在
`callTool` 之前先弹 confirm toast；玩家 ack 后才执行。
