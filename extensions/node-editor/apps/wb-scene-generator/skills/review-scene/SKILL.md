---
name: review-scene
description: >-
  场景评审手册（sino-critic 专用）。只读地 execute + 截图当前 scene，对照 scene-design-brief
  从四维度（游戏逻辑/白盒、叙事、布景美术、审美）打分，产出 review.json 的 punch list 与
  refine/recurse/done 判定，交回 Sino 驱动循环。当 Sino 派来评审某个 scene tree 节点或整图时使用。
  本阶段只读：不修改图、不生成资产。
---

# 场景评审手册（sino-critic · review-scene）

> 评审是「反复循环」的引擎：每个 scene tree 节点跑完 design→whitebox→structure→dress 后，
> 由评审给出**可执行 punch list** 与**分支判定**，Sino 据此决定 refine / recurse / done。
> 产出唯一工件 `review.json`（契约见 [review.schema.md](review.schema.md)）。
> **本阶段只读**：你没有 applyBatch/instantiate，禁止修改图、禁止生成资产。

## 串行锁交接

scene project 是 per-agent 独占锁：`scene:projects.open(projectId)`（Sino 已让出）→ 看图比对写 `review.json` → `scene:projects.close(projectId)` → 回报 Sino。

## 流程

1. **读意图**：读本次 runDir / project 的 `scene-design-brief.json`，锁定被评审节点（或整图）的 `gameplay` / `narrative` / `dressing` / `acceptance`。
2. **看现状**：`scene:pipeline.execute`（看 status + 各端口 children/cell 摘要，确认无 error、各组有产出）→ `scene:renderer.setViewMode` + 截图**真的看图**。读不了图只在 `timeout (no renderer connected?)` 时如实上报。
3. **四维度打分**（每维 `score` 0–5 + `notes`）：
   - **游戏逻辑 / 白盒**：spawn/动线/卡点成立？关键 POI 可达？`gameplay` 落地？
   - **叙事**：场景讲出 `narrative` 的故事？关键揭示/节拍有空间承载？
   - **布景 / 环境美术**：`dressing.keyProps` 在场？多遍叠加？有无大片空白 / 单调？
   - **审美**：比例、节奏、视觉焦点、整体协调是否合理美观？各 `acceptance` 满足？
4. **列 punch list**：每条 `{ axis, severity(blocker|major|minor), pass(whitebox|structure|dress|design), detail }`——**定位到具体工序**，让 Sino 能直接重派。
5. **给判定** `verdict`：
   - `refine`：本层需补做 → punch list 指明回哪道工序、做什么。
   - `recurse`：某 `expand` 的 POI 该展开其内部了（指明 POI name）。
   - `done`：四维度达标，可装配 / 归档。
6. **写 `review.json`** 到 runDir（aw-support）或 `<active_game>.dir/pipeline/review.json`（独立对话），回报 Sino 总评 + 最关键几条 + verdict。

## 收尾检查清单

- [ ] 已读 brief、execute + 截图真的看了图
- [ ] 四维度各有 score + notes，对照了 brief 的 acceptance
- [ ] punch list 每条定位到具体工序 + severity
- [ ] verdict 明确（refine/recurse/done），recurse 指明 POI
- [ ] review.json 写入正确路径，全程只读、已 close 释放锁
