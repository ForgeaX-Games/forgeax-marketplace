# 构图双通道（SSOT — 读 skill 时第一优先）

> Sino 改图只有 **两条通道**，职责不重叠。搞混通道 = 422、空产、误判「白名单挡 template」。

---

## 通道 A · 落模板组 — `scene:pipeline.instantiateTemplate`

**用途：** AddBaseGrid、AreaPartition、IslandRegions、PickOneBuilding、BuildingStructures、PathConnection、装饰组、LakeRegions … **全部场景模板组**（清单见 SKILL 目录 / `scene:templates.list`）。

**机制：** 专用路由，**不经过** `applyBatch` 的 opId 白名单。**模板组的内部实现是组私有的**——顶层看不到、也不用你摆，整组随 `instantiateTemplate` 一次落地。

```json
{ "toolId": "scene:pipeline.instantiateTemplate", "args": {
  "projectId": "<与 open 相同>",
  "templateId": "IslandRegions",
  "position": { "x": 0, "y": 0 }
}}
```

**成功标准：** 响应 `status:"ok"` + `groupId` + `graphVerified:true` → 立刻 `pipeline.get` 核对。

**禁止：**

- 用 `applyBatch` 顶层手搭模板组的内部 — 服务端 422，改用 `instantiateTemplate`
- **`templates.get` 预研/审计组内节点**（看到 `scene_set_attribute` 不代表会空产）— 先 instantiate，端口以返回的 `exposedInputs` 为准
- 从别的 project 复制节点冒充 instantiate

---

## 通道 B · 接线与工具电池 — `scene:pipeline.applyBatch`

**用途仅限：**

| 允许 | 禁止 |
|------|------|
| `connect` / `disconnect` / `updateNode` | 顶层 `createNode` 非白名单电池 |
| 顶层 composer 工具电池（见 `scene:composerUtilities.list`） | 顶层手搓模板 / `createGroup` / 任意 `alg_*` / `rect_grid` … |
| `opts.actor:"ai:sino"`（身份标记） | 用 applyBatch **新建**模板组本体 |

**422 含义：** 你在通道 B 里放了只该走通道 A 的东西 → **改调 `instantiateTemplate`**，不是「等平台加白名单」。

---

## 失败对照表（禁止再混为一谈）

| 现象 | 真实原因 | 正确动作 |
|------|----------|----------|
| `applyBatch` **422** + `sino-op-not-allowed` | 通道 B 顶层放了非白名单电池 / 想手搭模板内部 | `instantiateTemplate("<组名>")` |
| `instantiateTemplate` **ok** + `graphVerified:true` | 通道 A 成功 | 走通道 B **只 connect** |
| `execute` **completed** 但某组 **out 空 / `{}`** | **in_* 悬空或端口名错**（如 `manual_points.points` 应为 **`point`**） | `pipeline.get` 查边；**不是**白名单 |
| `pipeline.get` 的 `id` ≠ 你的 `projectId` | lock drift / 读错项目 | 停；重新 open + 显式 projectId |
| 向用户问「手动链 vs 等白名单」 | agent 误判 | **禁止**；按上表修 |

---

## 标准节拍（两通道交替）

```
instantiateTemplate(模板组)     ← 通道 A（一拍可 instantiate 多组）
→ pipeline.get(确认 groupId)
→ applyBatch(仅 connect + panels) ← 通道 B（一次可连完这一拍的多组 Rest 链）
→ pipeline.get(确认边)
→ pipeline.execute → 读摘要里的 verification.hints
→ 下一拍（Rest 链接；依赖上游结果处分步，见 fast-loop.md「可分步批量」）
```

> **一拍连多组 vs 分步**：参数已确定、互不依赖的相邻组可合并成一拍（多 instantiate + 一个 applyBatch + 一次 execute）；下游参数依赖上游 execute 结果的（PathConnection POI、装饰 keypoint、高差、资产导入）必须分步，先 execute 看真值再连。**不要一口气全连完。**

---

## 与「白名单」一词的关系

- **白名单**仅描述通道 B 的顶层 `createNode` 允许列表。
- **不等于**「Sino 只能用 AddBaseGrid」。
- **不等于**「某个模板组被白名单挡了」——模板组走通道 A，从不撞白名单。
- 文档其它处若写「白名单挡模板」——**那是过时/错误表述**，以本页为准。
