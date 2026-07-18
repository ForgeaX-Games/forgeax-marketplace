---
name: agent-native-lowpoly-delivery
description: Build a recognizable lowpoly asset and deliver the real GLB into the session-bound game with one authorization and a final status check.
---

# Poly 的最终运行规则

本节在 `compose-lowpoly` 之后注入，是 Poly 在 ForgeaX Studio 里的**最终运行规则**。它不取消 `compose-lowpoly` 的单物件、机械、建筑与场景能力；它负责选择更合适的建模成本，并在用户要求交付当前游戏时补齐闭环。若具体运行方式冲突，以本节为准。

## 运行时事实

- `compose-lowpoly` 的 `SKILL.md` 正文已经在提示词里；链接到的 execution、quickref、op-directory 文件不会自动注入。
- 不调用 `skill_compose_lowpoly`，不尝试用 `read` 打开这些文件，也不把全量 `batteries.list` 当作预检。
- 只有 `model.apply` 对某个具体 op 报未知或参数错误时，才调用一次 `batteries.get({id})` 精确查询并修正。
- 游戏目标只来自当前会话绑定，绝不在参数中猜测或提供 `game` / `slug`。

## 根据任务选择建模策略

目标是满足用户本次任务，而不是机械执行最重流程。

1. **识别优先的常见单物件**：优先用一次完整、连贯的 `model.apply({source,name})` 建出主体、标志性细节、材质和单根装配树。宝箱、木桶、路灯、简单家具等都属于此类。
2. **复杂或可复用装配**：只有多组复杂曲面/CSG、多个需要独立复用的零件、真实可动机构，或一次完整 DSL 无法通过结构化 QC 时，才用逐件 bake → mesh 引用 → 组装的两阶段流程。
3. **失败升级而非盲目加流程**：一次 DSL 出错时先按行号和 QC 修正；若形态仍无法稳定表达，再升级到两阶段。不要为遵守流程把正常小物件拆成十几次工具调用。

## DSL 最小自包含参考

每行一条 `id = op(arg=value)`；引用必须指向前面的 id。常见签名：

- `box(size=[x,y,z])`
- `cylinder(radius=n,length=n)`
- `profile_rounded_rect(w=n,d=n,radius=n,segments=n)`
- `extrude(profile=ref,height=n,center=bool)`
- `difference(base=ref,tool=ref)`、`union(a=ref,b=ref)`
- `translate(shape=ref,offset=[x,y,z])`、`rotate(shape=ref,angle_deg=n,axis=[x,y,z])`
- `material(rgba=[r,g,b,a])`
- `part(shape=ref,material=ref,origin=[x,y,z],rpy=[r,p,y])`
- `joint(type="fixed",parent=ref,child=ref,origin=[x,y,z])`

一个可交付的常见物件至少要有：可识别主体、1–3 个标志性细节、合理配色、全部 part 接入一个根。不是追求零 warning；必须无 hard error、`qc.valid`，且明显缺件、悬空、比例错误或非预期穿模已修正。

## 按需完整交付闭环

1. `projects.list`，打开合适项目；没有才创建。
2. 简要说明轮廓、部件、颜色和尺度，然后执行建模策略。
3. `model.apply` 成功并通过结构化 QC 后，调用 `export-glb({name,animated:false})`；保存返回的确切 `path`。
4. 若用户只要建模或导出，给出真实 GLB 路径和结构化 QC 后结束；不要擅自写入游戏。
5. 若用户明确要求交付当前游戏、导入游戏资产库或确保 Edit 可用，调 `game-import-status({assetPath:path})`。若 `imported:true`，不要重复写入。
6. 若未交付，调 `import-to-game({assetPath:path})`，等待唯一一次业务授权。
7. 授权后再次查询；交付任务只有最终 `imported:true` 才算完成。
8. 交付任务的最终回复给出 `sourcePath`、游戏内 `assetPath`、`sourceHash`、`contentHash`、是否显式导入和最终状态。完成只代表 Edit 能识别，不声称已经把独立资产摆进游戏场景或修改玩法。

任何工具返回 `{ok:false}` 时，原样报告 `code`、`retryable` 和下一步；不得用 mock、占位文件或自然语言假装成功。
