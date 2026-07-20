---
name: create-scene-template
description: >-
  Author a wb-scene-generator scene template group (NodeGroup battery): mandatory
  groups+templates dual copy, scenealg four-form (region/partition/topology/field/points)
  alg_* composition, six-stage pipeline, nested subgroups, exposed port contract,
  and verification. Use when creating or reviewing scene templates; when the user
  mentions template 模板组、groups/templates 双副本、scenealg、region partition
  topology field points、instantiateTemplate、_nestedGroups.
---

# 场景模板组 · 制作 Skill（create-scene-template）

> **用途**：在 wb-scene-generator 里**从零或从现有图**制作/发布一个 scene **模板组**（成组电池），供 Sino `scene:pipeline.instantiateTemplate` 与 UI Templates 面板使用。
>
> **与 compose-sino-scene 的分工**：`compose-sino-scene` = **用**已有模板拼场景；本 skill = **做**模板本身。

---

## 开始前：必须收集的信息

在动手搭图或写 JSON 之前，逐项确认（缺一项就停下去问）：

| # | 信息 | 用途 |
|---|------|------|
| 1 | **模板英文名**（PascalCase，如 `PickOneBuilding`） | 文件夹名、JSON 文件名、`nameEn` |
| 2 | **一句话功能** + **典型管线位置**（起点 / 建筑 / 道路 / 装饰…） | README、`TEMPLATES_INDEX` 行 |
| 3 | **输入清单**：哪些必须由外部接线？（Scene / Point(s) / 宽高 / 资产名 / seed / POI…） | `exposedInputs` visible 口 |
| 4 | **输出清单**：主产物名、是否产 Rest、是否需要 Path 句柄 | `exposedOutputs` 五件套 |
| 5 | **scenealg 形态链**：Region/Partition/Topology/Field/Points 之间走哪些 `alg_*`？ | ③ 段复合设计 |
| 6 | **资产类型**：tile 还是 object？ | 嵌 `TileAssetName` vs `ObjectAssetName` |
| 7 | **链式语义**：下游接 `Rest` 还是主产物？多实例如何串联？ | 文档 + customLabelEn |
| 8 | **必接 vs 可空**：哪些 IN 悬空会**静默空跑**？ | README 警告 + visible 标注 |
| 9 | **参考模板**：最接近的现有模板（见索引） | 克隆内部拓扑再改 alg 段 |

权威模式说明见仓库内：
- [batteries/templates/scene/TEMPLATE_PATTERNS.md](../../batteries/templates/scene/TEMPLATE_PATTERNS.md)（内部六段 + 嵌套子组）
- [batteries/templates/scene/TEMPLATES_INDEX.md](../../batteries/templates/scene/TEMPLATES_INDEX.md)（已有模板选型表）
- [references/scenealg-primitives.md](references/scenealg-primitives.md)（四形态 + 转化算子矩阵）

---

## 磁盘布局与双副本规范（强制）

```
batteries/
  groups/<cat>/<Name>/          ← 【Develop 可编辑版】UI Groups 面板可自由改图
    <Name>.json
    README.md（可选，开发期）
    icon.png（可选）
  templates/<cat>/<Name>/       ← 【稳定发布版】Sino instantiateTemplate 唯一来源
    <Name>.json                 ← 与 groups 同内容快照（id/exposed 契约一致）
    README.md                   ← 必写：可见端口 + templateId + 静默空跑
    icon.png
```

| 路径 | 谁读 | 能否编辑 |
|------|------|----------|
| `groups/` | Develop → Groups 标签 | **可自由编辑**（保存默认落盘） |
| `templates/` | `scene:templates.*` / instantiate | **只读发布**（builtin，Sino 用） |

### 双副本铁律

1. **新建模板时必须同时创建 `groups/` 与 `templates/` 两份**，目录结构镜像、`<Name>.json` 初始内容一致。
2. **日常迭代只在 `groups/<cat>/<Name>/` 改图**；定稿后再同步到 `templates/`（覆盖 json + README + icon）。
3. **禁止**只在 `templates/` 有文件而 `groups/` 缺失——Develop 将无法打开可编辑副本。
4. **禁止**只在 `groups/` 有文件而未 promote——Sino `instantiateTemplate` 找不到模板。
5. 同步时保持 **`id`、`exposedInputs`、`exposedOutputs`、`_nestedGroups` 完全一致**；仅发布流程更新 README / TEMPLATES_INDEX。

```bash
# 定稿后同步（示例）
NAME=MyNewTemplate CAT=scene
SRC=batteries/groups/$CAT/$NAME
DST=batteries/templates/$CAT/$NAME
mkdir -p "$DST"
cp "$SRC/$NAME.json" "$DST/"
cp "$SRC/README.md" "$DST/" 2>/dev/null || true
cp "$SRC/icon.png" "$DST/" 2>/dev/null || true
```

| API / 工具 | scope | 说明 |
|------------|-------|------|
| `GET ?scope=groups` | groups | Develop 列表 |
| `GET ?scope=templates` | templates | Sino 发现 |
| `instantiateTemplate` | **仅 templates** | 不读 groups |

---

## 制作工作流（按顺序）

```
Task Progress:
- [ ] 1. 需求表（上文 §开始前）填完
- [ ] 2. 在 groups/<cat>/<Name>/ 创建可编辑副本（同步创建 templates/ 镜像目录）
- [ ] 3. 选定 scenealg 形态转化链（见 references/scenealg-primitives.md）
- [ ] 4. 内部六段流水线合规 + 仅用 scenealg alg_* 复合 ③ 段（见 references/internal-pipeline.md）
- [ ] 5. 嵌套子组自包含于 _nestedGroups（Tile/ObjectAssetName、MultiNames）
- [ ] 6. exposedInputs/Outputs 契约 + customLabelEn（见 references/port-contract.md）
- [ ] 7. groups 与 templates 两份 JSON 一致 → instantiate + execute 验证
- [ ] 8. 写 README + 更新 TEMPLATES_INDEX + compose-sino-scene pipelines（若 Sino 要用）
```

### Step 1–2：创建双副本 + 在 Develop 搭内部图

1. **同时**创建 `batteries/groups/<cat>/<Name>/` 与 `batteries/templates/<cat>/<Name>/`，初始 `<Name>.json` 内容相同。
2. 在 **Develop → Groups** 打开 `groups/` 下副本，自由编辑（或从最接近的参考组克隆）。
3. **不要**在大模板里手写 `scene_set_attribute` 链——嵌套 **`TileAssetName` / `ObjectAssetName` / `MultiNames`**（源码在 `batteries/groups/scene/`）。
4. 占空地类固定 front-end：`scene_passthrough` → `node_explode` → `rect_grid` → `voxel_slice` → **region 工作区**。
5. 在 Region / Partition / Topology / Field / Points 形态空间里选转化链，用 **`scenealg/alg_*` 复合** 实现 ③ 段（禁止 `alg_store`/`components` 重型电池）。
6. 挂树：`grid2node` → `add_child` → 嵌套资产组。
7. 拆分：`alg_region_subtract` → 主分支 + `grid2node(name="rest")` → 多路 `scene_passthrough` 抽头。
8. Path 句柄：`scene_focus_path` → `type_string`（**禁止**让下游猜 BaseName 拼 path）。

### Step 3–5：定稿同步 + 导出 NodeGroup JSON

groups 定稿后 **同步覆盖** templates 副本，再验证 instantiate。

- 根对象含 `id`, `name`, `nameEn`, `nodes`, `edges`, `exposedInputs`, `exposedOutputs`
- 每个 `__group__` 成员在 **`_nestedGroups`** 里有完整子组定义（nodes/edges/exposed*）
- `__group__` 节点的 `params.groupId` 与子组 `id` **一致**
- `exposedInputs[].portName` 形如 `in_N`；`exposedOutputs[].portName` 形如 `out_N`（**实例化后稳定，不 remap**）
- visible 口：`hidden: false` + 有意义的 `customLabelEn`（如 `Scene`, `Rest`, `BuildingPath`）

### Step 6–7：验证与发布

见 [references/publish-and-verify.md](references/publish-and-verify.md)。

---

## 内部实现要点（速查）

详细六段图 → [references/internal-pipeline.md](references/internal-pipeline.md)  
**scenealg 四形态 + 转化矩阵** → [references/scenealg-primitives.md](references/scenealg-primitives.md)

| 段 | 固定 ops | 备注 |
|----|----------|------|
| ① 输入 | `scene_passthrough` | 外部 scene **单点**接入 |
| ② 树→栅格 | `node_explode` → `rect_grid` → `voxel_slice` | 产出 **region** 工作区 |
| ③ 算法 | **`scenealg/alg_*` 复合** | Region/Partition/Topology/Field/Points 形态转化链 |
| ④ 栅格→树 | `grid2node` + `add_child` + Tile/ObjectAssetName | 资产名 = 渲染图层名 |
| ⑤ 主/Rest | `alg_region_subtract` | Rest **必须**成对出现 |
| ⑥ 输出 | passthrough + `scene_focus_path` + `type_string` | 推荐五件套 OUT |

**③ 段原则**：只用 `batteries/scenealg/` 下 `alg_*`；缺转化边时 **先补 scenealg 原子电池**，再在模板里引用。

### 三个嵌套子组（零件库）

| 子组 | asset_type | 用于 |
|------|------------|------|
| `TileAssetName` | `tile` | 网格/道路/湖底 |
| `ObjectAssetName` | `object` | 建筑/装饰 |
| `MultiNames` | — | Prefix+Count → 名列表（多湖/多装饰） |

子组对外：`in_0`=scene，`in_1`=资产名字符串；`out_0`=已标注 scene。

### 标准可见 OUT（占空地类）

| 语义 | customLabelEn 示例 |
|------|-------------------|
| 主产物 Scene | Building / Path / Lake / Decoration |
| Rest Scene | Rest |
| 主 Path | BuildingPath / PathPath / DecorationPath |
| Rest Path | RestPath |
| 整树（可选） | Scene |

AddBaseGrid **无 Rest**；BuildingStructures **无 Rest**（只细化已有建筑）。

---

## 合规检查清单（审查用）

设计或 PR 审查时逐项打勾（与 TEMPLATE_PATTERNS §7 对齐）：

- [ ] 入口 `scene_passthrough`（或 AddBaseGrid 等价）
- [ ] 占空地类有 explode → rect_grid → voxel_slice
- [ ] 主产物经 grid2node + add_child + 资产嵌套组
- [ ] 占空地类有 subtract + **Rest** 输出
- [ ] 可见 OUT：主产物 + Rest + 主 Path（推荐五件套）
- [ ] Rest 的 grid2node 名 = `"rest"`，与 Rest out 标签一致
- [ ] 必接 scene/POI 口在 visible IN 且 README 标注
- [ ] `_nestedGroups` 与 `__group__` member id / groupId 一致
- [ ] **`groups/` 与 `templates/` 双副本存在且 JSON 一致**
- [ ] ③ 段仅使用 `scenealg/alg_*`（无 alg_store/components 重型依赖）
- [ ] promote 到 `templates/` 后 `scene:templates.get` 可见
- [ ] instantiate + execute：主产物 children 非空，无静默空跑

---

## instantiate 机制（改 JSON 时必须懂）

实现：`backend/src/lib/templateOps.ts`（与 CLI `forgeax node create-template` 字节级对齐）。

1. `splitTemplate`：根组 + `_nestedGroups` deps
2. 所有 **内部** nodeId / groupId **重映射**；**exposed `portName` 不变**
3. Op 顺序：**子组 createGroup 先于父组**；每组内 createNode → connect → createGroup
4. 返回 `rootGroupId` = 运行时 shadow `__group__` 节点 id → **连线用这个 id，不是库里的 templateId**

```bash
# 验证 instantiate（backend 测试同款）
cd apps/wb-scene-generator/backend
pnpm test templateInstantiate
```

---

## 文档交付物

每个新模板 **groups/ 与 templates/** 目录均至少包含：

| 文件 | 内容 |
|------|------|
| `<Name>.json` | NodeGroup + `_nestedGroups` |
| `README.md` | templateId、可见 IN/OUT 表、串联示例、静默空跑条件 |
| `icon.png` | Templates 面板缩略图（可选但推荐） |

并更新：
- `batteries/templates/scene/TEMPLATES_INDEX.md` 一行
- （若 Sino 使用）`skills/compose-sino-scene/instructions/pipelines/<Name>.md`

---

## 附加资源

- [references/scenealg-primitives.md](references/scenealg-primitives.md) — **四形态定义、转化算子矩阵、现有模板对照**
- [references/internal-pipeline.md](references/internal-pipeline.md) — 六段流水线、输入提取/输出组装表
- [references/port-contract.md](references/port-contract.md) — exposed 端口 JSON 字段
- [references/publish-and-verify.md](references/publish-and-verify.md) — 双副本同步、测试、execute 验证
