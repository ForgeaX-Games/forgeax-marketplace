# 发布与验证

## groups → templates 发布（双副本同步）

### 新建时（强制）

创建模板目录时 **同时** 建立：

```
batteries/groups/<cat>/<Name>/<Name>.json      ← 可编辑主本
batteries/templates/<cat>/<Name>/<Name>.json    ← 发布镜像（初始内容相同）
```

### 定稿时

1. 在 `groups/` 完成编辑与自测。
2. **覆盖同步**到 `templates/`（json + README + icon）。
3. 更新 `TEMPLATES_INDEX.md`。
4. 重启或等待扫描后 `GET /api/v1/group-templates?scope=templates` 可见。

**禁止**只维护单侧目录（见 SKILL.md §双副本铁律）。

| API / 工具 | scope | 用途 |
|------------|-------|------|
| `GET /api/v1/group-templates?scope=groups` | groups | 开发草稿 |
| `GET /api/v1/group-templates?scope=templates` | templates | Workbench 只读目录 |
| `GET /api/v1/group-templates/:id?scope=templates` | templates | 读 exposed 契约 |
| `POST /api/v1/group-templates/:projectId/instantiate` | templates | 落图 |

**instantiate 只扫 `templates/`**（含 `.forgeax/user-content/templates/`），不读 `groups/`。

## 单元测试

```bash
cd apps/wb-scene-generator/backend
pnpm test templateInstantiate    # buildTemplateOps + LakeRegions 端到端
pnpm test groupTemplates         # 路由扫描 / list / get
```

新模板 PR 应至少：
- `splitTemplate(<Name>.json)` 非 null，deps 数量符合预期
- `buildTemplateOps` 的 createGroup 数 = 1 + nested 数，root createGroup 在最后

## 编辑器内验证

1. 从 Templates 面板拖入
2. 用运行时 **`groupId`** 接线（不是库 `id`）
3. 必接 IN 全部连上 → `pipeline.execute`
4. jq 投影单端口（**禁止**打印整图 outputs）：

```bash
forgeax pipeline execute --batteries <BATT> <G> \
  | jq '.result.outputs["<runtimeGroupId>"]["out_1"]'
```

scene 端口摘要：

```bash
... | jq '.result.outputs["<groupId>"]["out_1"][].items[0].tree.children[].name'
```

5. Preview 面板 Output 层应出现主产物名；Rest 可接下一组验证链式

## 人类/Workbench HTTP 示例

```json
{
  "method": "POST",
  "path": "/api/v1/group-templates/<projectId>/instantiate",
  "body": {
    "templateId": "PickOneBuilding",
    "x": 400,
    "y": 200
  }
}
```

返回关注：`groupId`（运行时 shadow 节点 id）、`exposedInputs`/`exposedOutputs`（portName 列表）。

## 合规失败常见原因

| 现象 | 原因 |
|------|------|
| instantiate 后 inner view 空白 | `_nestedGroups` 缺子组或与 groupId 不一致 |
| execute completed 但无图层 | 必接 Scene/POI 悬空（静默空跑） |
| Templates 面板找不到模板 | 只在 groups/ 未 promote 到 templates/ |
| 连线 port 不存在 | 用了库 templateId 而非 instantiate 返回 groupId |
| Rest 链断裂 | 未暴露 Rest out 或 grid2node 名不是 `rest` |

## 参考项目（只读验证链）

- `verified-town` `p_mqasqhsf_cmb7xe`
- 读图：`scene:projects.open` → `scene:pipeline.get`

对比已有模板的 execute 摘要 shape，新模板主产物 children 结构应同构。
