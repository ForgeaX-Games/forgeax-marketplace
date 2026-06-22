# ForgeaX Studio — forgeax-marketplace

[English](./README.md) · [简体中文](./README.zh-CN.md) · [↑ studio](https://github.com/ForgeaX-Games/forgeax-studio)

> **内容层 —— agent 用来设计与构建游戏所组合的人格、系统提示片段、技能,以及可视化 workbench 插件。一个 agent 的全部「之所以是它」,除了代码以外。**

`forgeax-marketplace` 是 agent 内核在启动时加载、从而*变成*一间游戏工作室的东西。它不是二进制
插件宿主,而是一个 **markdown + JSON 片段**库:具名 agent 人格、有序的系统提示槽、可复用技能、
长期记忆模板,以及一支 **workbench 插件**舰队(场景、角色、剧情、动画、音频、数值、短剧 reel 的
可视化编辑器)。因为内容即数据,团队与工具靠**加文件**生长——无需改动引擎或内核。

## 它为何重要

- **人格即职能(「人格层兼职能层」)。** 每个 peer agent 是一个文件,把性格(声音、身份)与职能
  契约(输入 → 输出 → 归属边界)融为一体。在 Workbench 里,每个 peer 是一张卡,**拥有项目文件的
  一部分**——于是委派与问责是可见的,而非隐含的。
- **一支真实的工作室阵容,而非无名的角色字面量。** 团队有名字、有分工:

  | 卡片 | id | 角色 | 拥有 |
  |---|---|---|---|
  | 主线制作人 | `forge` | 编排者 | 游戏的 `src/**` |
  | 核心玩法师 | `iori` | 立柱 / 核心循环 | 设计立柱文档 |
  | 体验设计师 | `suzu` | 系统设计 | 各模块设计文档 |
  | 剧情师 | `kotone` | 叙事 | 剧情 + 对白 |
  | 美术师 | `iro` | 美术 | 资产规格 |
  | 工程师 | `tsumugi` | 编码 | 实现 |

  权威阵容记在 `manifest.json#agents`。
- **提示是组装的,不是写死的。** `src/system-prompt/` 携带有序片段(`00-persona`、
  `01-platform-constraints`、`30-pillar-design-flow`、`50-question-tool`、`60-workflow`、
  `80-workbench-agents`,外加 `peers/` 与 `shared/`),插入内核按优先级排序的提示组装。改行为就是
  改一个片段。
- **workbench 插件让抽象变得可触。** `wb-*` 插件是 agent 驱动的领域编辑器——`wb-scene-generator`、
  `wb-character`、`wb-narrative`、`wb-reel`、`wb-anim`、`wb-bgm`、`wb-items`、`wb-look`、
  `wb-balance`、`wb-3d-lowpoly` 等——让人能看见并操舵 agent 正在构建的东西。
- **可插拔的模型后端。** 人格/驱动分离(`cli-*` 驱动:claude-code、codex、cursor、forgeax)让
  同一个人格能跑在不同的 agent 运行时上。
- **自我扩展。** 编写一个新插件或技能本身就是一个插件(`skill-author-plugin`、`wb-plugin-author`、
  `wb-skill`)——marketplace 教会 agent 去扩展 marketplace。

## 结构

```
manifest.json            # 注册表:id / version / schemaVersion / agents / skills
src/system-prompt/       # 有序提示片段(+ peers/、shared/)
src/skills/              # 可复用技能(如 make-game-design)
src/memory/              # 长期记忆模板
plugins/                 # 插件舰队:
  agent-*                #   具名 agent 人格
  wb-*                   #   可视化 workbench 编辑器(场景 / 角色 / 剧情 / reel / …)
  cli-*                  #   模型/运行时驱动
  skill-* / tool-* / node-editor / model-*
```

## 关键概念

人格即职能(拥有文件的 peer)· 具名阵容(`forge` / `iori` / `suzu` / `kotone` / `iro` /
`tsumugi`)· 有序系统提示槽 · `wb-*` workbench 插件 · `cli-*` 人格/驱动分离 · `manifest.json`
注册表 · 内容即数据(靠加文件扩展)。

## 它如何融入 studio

agent 启动时,内核读取 `manifest.json` 与 `src/system-prompt/` 片段,组装出 Forge 及其 peer;
Workbench UI 把人格渲染成卡片,并把 `wb-*` 插件挂载为编辑器。当你向 Forge 要一个游戏时,正是这层
内容决定了*谁*做*什么*、用*哪个工具*。

---

本仓是 **ForgeaX Studio** 的一个子模块,隶属
[`ForgeaX-Games/forgeax-studio`](https://github.com/ForgeaX-Games/forgeax-studio) ——
用 `--recurse-submodules` 克隆超级仓即可运行完整 studio。许可:Apache-2.0。
