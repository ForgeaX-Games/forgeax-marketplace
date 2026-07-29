---
name: compose-lowpoly
description: Route low-poly assets, mechanical assemblies, buildings, characters, and static scenes into the matching Geometry DSL execution flow.
trigger: /compose-lowpoly
---

# Compose Lowpoly · 短路由器

Geometry DSL 是唯一真源。禁止手工 `createNode`/`connect`，禁止 AI 使用 `batteries.*` 与 `pipeline.*`。截图是内部/人工能力，不参与 AI 完成判定。

## 1. 分诊并只读一个 execution

- A · 单物件/机械/刚性装配 → [executions/part-a-asset.md](executions/part-a-asset.md)
- B · 建筑/房间/建筑构件 → [executions/part-b-building.md](executions/part-b-building.md)
- C · 多个独立物件的静态空间组合 → [executions/part-c-scene-assembly.md](executions/part-c-scene-assembly.md)
- D · 连续表皮角色/生物/软体 → [executions/part-d-character.md](executions/part-d-character.md)

活物走跑仍走 D 的骨骼动画；刚性零件绕轴才走 A 的 joint。同一模型不得混合 joint 与 skin/skeleton。

## 2. 共同协议

### 官方工具调用

Agent 工具列表会把注册 ID 中的 `:` / `.` 规范化为下划线。调用 `lowpoly:model.apply` 时使用
`lowpoly_model_apply`，并将 `source`、`name` 等参数直接放在工具输入顶层。禁止传
`toolId` / `args` / `caller` envelope，也禁止空参数调用；若返回
`missing required property "source"`，按顶层参数形状重试一次，不改用 graph、UI、shell 或 HTTP。

### 紧凑 manifest

每个 unique part 只写：

```json
{"name":"part","shape":"轮廓/截面","dims":[1,1,1],"features":["显著细节"],"datum":"局部原点","ops":["semantic_op","csg_op"]}
```

删除不能直接驱动 DSL 的修辞。优先 semantic family：

- 机械细节：Parts / Gears
- 建筑：Architecture
- 轮廓实体：Profile → extrude/revolve/sweep + CSG
- 装配摆位：`align_centers` / `place_on_face` / `place_on_surface`
- 裸 primitive 仅用于确实简单的板、杆、球

### 两阶段

1. 每件独立 source 建模并 bake。多件可一次提交 `model.bakeBatch({items})`，但每个 item 仍是独立 DSL，不形成 mega graph。
2. 用 `<sha>.obj` + bbox 建 mesh/part 组装。机械写 joint；角色写 bone/skeleton/skin；静态场景不写 joint。

### 增量迭代

- 首次或结构变化大：`model.apply`
- 已知行号的小改：先持有 `sourceHash`，用 `model.patch({baseHash, patches})`
- hash 冲突：调用 `model.get` 后重放修改
- bake 清单：`parts.list`

## 3. 完成与收敛

`ok/valid` 语义保持既有门禁。metrics、primitive ratio、尺寸偏差、bake provenance 和 QC 建议均为非阻断信号：

1. 先修 error，再按显著特征缺失、尺寸比例、semantic op 缺失、warning/note 排序。
2. 同一问题最多 3 次修复；总 apply/patch 次数服从 execution 预算。
3. fingerprint/sourceHash 不变化时停止重复提交。
4. 达到预算后保留最好结果；建议未清零不阻塞交付。

仅用户明确要求文件时调用 `export-glb`。

## 4. 按需参考

- DSL 语法：[dsl-quickref.md](dsl-quickref.md)
- op 家族入口：[op-directory.md](op-directory.md)
- 共同行为：[shared-conventions.md](shared-conventions.md)

只读当前 execution 顶部链接的 op 分片，不一次加载全部目录。
