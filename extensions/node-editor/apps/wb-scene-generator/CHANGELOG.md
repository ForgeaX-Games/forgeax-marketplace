# Changelog — `wb-scene-generator`

All notable changes to this app.

Format: [Keep a Changelog](https://keepachangelog.com/) · semver. Dates are
calendar dates in the project timezone.

> **Maintenance contract (see [`AGENTS.md`](./AGENTS.md)).** Every commit that
> touches this app's source MUST add a bullet under `## Unreleased`, grouped by
> Added / Changed / Fixed / Removed / Deferred, and state the *why*. Kernel
> changes go in the root [`CHANGELOG.md`](../../../../CHANGELOG.md). History
> below is **append-only** — never rewrite past entries; corrections append a
> new entry stating the reason.
>
> The kernel is in-repo `workspace:*` packages (`packages/*` in the monorepo
> root). There is no `external/forgeax-wb-node-core` submodule, no `link:` pin,
> and no cascade SHA to cite. Reference the changed `packages/*` file directly.

## Unreleased

### Added
- **Asset Store「列表」视图新增可点击排序的表头，字段集与列序对齐 asset_manager 的 `AssetReviewTable`（索引/内外/名称/材质/朝向/题材风格/状态/类型规则/尺寸/静态/滤镜模板/变体/出现场所/几何/时间戳/大小）。** `frontend/src/surfaces/AssetStoreSurface.tsx`：新增 `LIST_COL_ORDER`/`LIST_COL_LABEL`/`LIST_COL_SLOT`（13 项经既有 `aliasName.ts` 的 `SLOT`+`fieldAt` 从 `alias` 拆列，几何取 `geometryJson` 有无、时间戳取 `updatedAt`??`createdAt`、大小复用既有 `formatBytes`），列表行改为按此列集渲染分列文本；表头按钮点击走三态排序（未排序→升序→降序→取消，逻辑对齐 asset_manager `ScenePage.handleSortColumn`）驱动纯前端 `[...assets].sort(compareListAssets(...))`（`assets` 本就是当前 zone 的全量列表，见 `assetStoreStore.ts fetchAssets` 的「整 zone 一次性加载、连续滚动」模型，client-side 排序无需分页协调）。`AssetRecord`（`frontend/src/surfaces/library/libraryApi.ts`）补充 `geometryJson?: string | null`（后端已返回，此前前端类型缺失）。新增 `AssetStoreSurface.css` 表格样式（`.asset-list-*`，CSS Grid + 共享 `--asset-list-cols` 变量对齐表头/行列宽，超宽横向滚动）。仅改列表视图展示与排序，不影响网格视图、批量操作、渲染器绑定等既有交互。*为什么：* 用户要求 Asset Store 顶部资产列表按表头方式组织展示（参照 `asset_manager/apps` 的审阅表格），并支持点击表头依据该字段排序。

- **`variantWeights` — 变体加权采样。** `FaceRule` / `randomRules[]` 可选声明与 `variantIdxs` 等长的 `variantWeights`；`randomRules` 命中且未保留 base 时经 `pickWeightedVariant` 按权重采样（缺省仍等权）。透明像素过滤后 idx/weight 成对剔除；前后端共用 `VariantPool` + `computeValidVariantPoolsByTileId`。*为什么:* common_16 中心 tile 的 4 个变体需不同出现概率（如 4:2:2:2），原先只能等概率随机。
- **`randomRules[].variantIdxs` — per-tileId 变体池。** `FaceRule.randomRules` 每条可声明独立 `variantIdxs`;缺省仍回退 face 级 `variantIdxs`。`pickFaceSpriteIndex` / `bindings` / `cookBakedScene` 经 `computeValidVariantPoolsByTileId` 共享像素过滤,前后端 parity 测试覆盖。*为什么:* 不同 base tile 需要采样不同变体 slot(如 common_16 中心 vs 内角),原先全 face 共池无法表达。

### Changed
- **资产库对齐 asset_manager 新版 13 字段契约（`@forgeax/asset-2d` SSOT）。** 新增 `backend/src/library/aliasName.ts` + `frontend/src/surfaces/library/aliasName.ts` 统一 `SLOT`/字段语义；`paintAssetBus` 修正名称=PPU 索引（name→f2、size→f8）；taxonomy `scene` 改为 **`index`**（f0 分类路径分层 drill-down）；过滤器/预览面板补齐 13 项（索引/内外/名称/材质/朝向/题材/状态/类型/尺寸/静态/滤镜/变体/出现场所）并透出 `tags`/`createdAt`/`updatedAt`/`hasError`/`isPlaceholder`；材质默认含纸/布/竹且与库内 distinct 值合并；变体改为自由输入以支持任意 ≥0 整数。*为什么：* 新版 `materials/asset-store/library.db` 与 wb-asset-manager 生成器格式打通，消除半迁移状态下的刷绘/匹配/浏览错位。

### Fixed
- **scene-export 与 baked 层 vendor 类型补全，后端 `tsc -b` 恢复通过、dev 后端可稳定拉起。**
  `backend/src/baked/vendorScene.d.ts` 补 `projectSceneToVoxelLayers` 等投影类型；
  `backend/src/scene-export/routes.ts` 预加载 rule atlas PNG 到同步 cache（`cookBakedScene` 的 `resolveRuleImage` 必须同步）。
  *为什么：* 构建失败/类型断裂时 `tsx --watch` 后端起不来，Studio iframe 能开壳但 API 全挂，表现为「插件打不开」。

- **补全缺失的 `debug/syncTrace` 模块，修复插件前后端无法启动。** `frontend/src/debug/syncTrace.ts`（浏览器 localStorage 开关）与 `backend/src/debug/syncTrace.ts`（`FORGEAX_DEBUG_SYNC=1` 环境变量开关）此前被多处引用但文件未入库；同时修复 `frontend/src/renderer/bridge/bakedApi.ts` 的自引用 type import（阻断 `pnpm build:vendor`）并重建 `vendor/dist/renderer-resolve`，恢复后端 `tileRules` 对 `computeValidVariantIdxs` 的导入。*为什么：* 克隆后场景生成器 vite 能起但后端 `ERR_MODULE_NOT_FOUND`/vendor 断裂，iframe 空白且 API 500。
- **Billboard 预览 asset 模式重新贴出贴图（此前画笔画上的格子在 color 模式显示色块、切到 asset 模式却空白无贴图）。** 根因是资产库最近把全部 2909 条 base 资产的 `zone` 由 `raw` 迁到 `staging`（见下方 Changed），而渲染器的匹配池 `useAliasMetas.ts` 固定拉 `/api/v1/library/aliases-meta?zone=raw` → 池恒为空 → `matchAssetEntry` 永远 null → billboard asset 分支对每个 cell 直接 skip（`buildVoxelMaster/paintCell.ts:89-94` 刻意「缺 binding 就不画、不退色块」）；color 分支不碰这个池，故照常显示。修复：**渲染器/导出的匹配池改为 zone-agnostic**（一个 alias 可能落在任意 zone，取图 serve 本就跨 zone，匹配池理应对齐）。
  - 后端 `GET /api/v1/library/aliases-meta` **不带 `zone` 时返回全 zone（除 trash）合并、按 alias 去重的池**（`routes.ts:129`）；带 `zone=` 仍按原 zone 作用域（现有测试不受影响）。新增 `service.ts` `listAllAliasesWithMeta()`（`WHERE zone <> 'trash' GROUP BY alias`）、`privateStore.ts` `filterPrivateAllZonesForProjectDir()`、`mergedLibraryPool.ts` `listMergedAliasMetasAllZones[/ForProjectDir]()`。
  - 前端 `renderer/bridge/useAliasMetas.ts` 改请求 `/api/v1/library/aliases-meta`（去掉 `?zone=raw`）。
  - 同根因顺带修复导出/无头预览：`scene-export/routes.ts` cook 与 `scripts/preview.mjs` 的匹配池由 `listMergedAliasMetas('raw')` 改为 all-zones 变体（否则迁移后导出/预览同样匹配不到贴图）。
  - 测试：`backend/tests/library.test.ts` 新增「no zone 返回 zone-agnostic 池」用例（raw 空、staging 非空时 no-zone 池仍非空且为单 zone 超集）。*为什么：* 把「渲染池 = raw」这个随资产迁移而失效的硬假设，改成与 serve 一致的跨 zone 匹配，从根上杜绝「某 zone 一动整屏无贴图」。
- **同一资产的多个对象图层不再被拆分成不同的 `object-type-config.json` 类型 / `obj__*` 地形模板。** `cooker.ts` 的 `objectTypeNameFor()`/`templateIdFor()` 原先在没有手填 `object_type_id`/`template_id` 时按 `assetName → nodeName` 兜底——`nodeName` 每个图层天然不同、`assetName` 也可能漏填或填法不一致，导致两个渲染出来是同一张贴图的图层（`objectGraphicId()` 已经正确按解析出的 `alias` 去重共享同一个 atlas 图格）却各自注册成独立的对象类型/独立的 `obj__` 地形模板。新增共享的 `typeIdentityFor()`：无显式属性时优先用**解析到的资源库条目自身的显示名**（`assetMatch.ts` 新导出的 `aliasDisplayName()`，即匹配逻辑本身拿来比对 `assetName` 的字段），兜底顺序变为「显式属性 → 解析别名显示名 → assetName → nodeName」——只要两个图层解析到同一个 alias 就必然合并；显式 `object_type_id`/`template_id` 仍然优先生效（保留"同贴图但故意分成不同游戏逻辑类型"的手动契约），两个不同表（sheet）恰好显示名相同时的既有分叉保护（`templateIdAlias` 冲突检测）不受影响。*为什么：* 用户要求"使用同一类资产的肯定要属于同一个对象模板，不能变成多个不同对象"；用一个可复现的最小用例验证过旧逻辑确实会分裂（同贴图、`assetName` 一个填了一个空，产出两个 `objectTypes` 键和两个 `obj__` 模板）。折叠进地形的对象丢失 `instanceId`/`direction`/`interacted` 仍是已知且暂时接受的权衡——本轮曾原型实现一个新增的 `object_instances[]` 字段来保留这些数据，但因参考查看器 `viewer.js` 是禁止修改的冻结资产、根本不会读这个新字段而回退，不引入没有消费者的 schema 面。

### Added
- **`scene-export/cook` 接口新增可选 `narrative` 字段，可依据场景叙事节点列表自动推导并覆盖 `area_L{depth}` 区域标记**（新增 `backend/src/scene-export/narrativeAreaTags.ts`；接入 `routes.ts` 的 `cookSceneForProject()`、`cooker.ts` 的 `areaTags()`）。传入 `{ locations: [{ name, parent }] }`（可直接整体传入原始叙事 JSON `scene_nodes.*.json`，多余字段如 `scale`/`adjacent`/`description` 被忽略）后：先做叙事自身结构自检（唯一名、父引用有效、无环），再按 `name` 精确匹配同名 baked 图层（0 个报 `missing`、≥2 个报 `ambiguous`），再校验叙事 `parent` 链在 baked 树里是否保持祖先/后代包含关系（允许中间插入额外层，不要求直接父子）；全部通过后按叙事深度把 `area_L{depth}`（字符串，`cooker.ts` 侧仍按原有 `[value]` 包装成数组）覆盖式写入每个匹配子树下的所有图层——同层已手填的 `area_L{depth}` 被覆盖，未被叙事覆盖到的更深层手填值保留。同时把 `cooker.ts` 原先硬编码的 `area_L0..area_L4`（i<=4）读取上限改为从 0 开始连续扫描、遇首个缺口即停，不再有层数上限。任一环节的问题（缺失/歧义/包含关系错误/叙事结构错误）都会被收集后合并成一条错误一次性返回（`POST` 400），不是報第一个就中止。*为什么：* 让叙事驱动的场景区域标记可自动化生成并强校验一致性，替代逐图层手填 `area_L0..area_L4` 的人工流程。
- **`narrative` 输入的 `sceneName` 字段自动填充所有图层的 `region` 属性**（同一 `narrativeAreaTags.ts`）。与按子树作用域的 `area_L{depth}` 不同，`region` 是全场景统一标识（参考包里全部地形模板的 `region` 都等于场景名），所以只要叙事校验整体通过、且 `sceneName` 非空白，就会覆盖式写到**全部**烘焙图层（不局限于叙事匹配到的子树），未提供或为空白 `sceneName` 时完全不改动 `region`（沿用手填值或 `cooker.ts` 的 `"default"` 兜底）。*为什么：* `region` 是导出格式里唯一还依赖人工逐图层手填、且没有自动化机制的场景元数据字段，而叙事输入本身已经携带了场景名，顺手补上成本很低。
- **新增三条 autotile 规则,切自参考图 `assets/rules/{房墙02,草坡,院墙}.png`(ppu=16,schemaVersion 2,billboard 双面 top+front):** `grass_slope_7.json`(草坡:top=草地顶面+随机点缀变体,front=泥土台地立面坡)、`courtyard_wall_18.json`(院墙:top=石压顶环形 autotile,front=米色墙身+石基座立面)、`house_wall_10.json`(房墙:top=压顶帽,front=米色压顶+青砖墙身立面)。三者均按 `wall_outer_16.json` 的面/键语义编写——top key=(u,d,l,r) 同层 4 邻、front key=(t,b,l,r) z 上下+同层左右——`sprites` 仅列实际取用格(绝对 atlas 坐标,仿 `flower_bed_11.json`),atlas 包围盒分别 80×64 / 96×144 / 48×144。*为什么:* 用户要求为这三张参考图各配一条可绑定 `autotileKind` 的瓦片规则;首版按参考图 16px 网格逐格映射,像素级效果待 Preview 校验微调。
- **新增国风仙侠资产 13 字段清单 `materials/国风仙侠资产清单-13字段.csv`(289 行)**:依 `资产库大纲.md` §4 物品 / §5 瓦片 / §3 地形把所有资产展开为编辑器 13 字段(可能区域 / 室内外 / 大区域 / 小区域 / 物体名 / 朝向 / 题材风格 / 状态 / 是否抠图 / 尺寸 / 是否静态 / 滤镜模板序号 / 变体序号)。题材风格统一「国风仙侠」;大区域 / 小区域名按国风仙侠场所规范化为 40 个大区域(门派 / 道观 / 丹房 / 仙山 / 园林 / 古镇 等),`可能区域` 用 `-` 连接且 token 均为规范大区域;`是否抠图`(物件=抠图 / 瓦片地形=未裁剪)、`尺寸`(瓦 16 / 小 32 / 中 64 / 大 128 / 建筑 256)、`是否静态`(火 / 水 / 旗幡 / 喷泉 / 水车 等=动态)按物理类目派生。已剔除与古代国风不兼容的现代 / 科幻专属物(电视 / 电脑 / ATM / 霓虹灯 / 空间站 等),少量改写为国风等价(辐射污染带→瘴气带)。*为什么:* 用户需要把大纲里的资产按编辑器 13 字段成表、风格收敛为国风仙侠并保证覆盖全面,供后续批量标注 / 生成使用。
- **新增按场所导向的资产清单 `materials/资产清单-按场所.md`**（以「场所」为单位的可勾选施工清单，配套 `资产库大纲.md` 使用）。覆盖室外自然环境（15 类生物群系）、农业聚落（农场/牧场/村镇/都市/公园）、特殊与末日（废墟/营地/避难所/遗迹/军事/工业/港口/交通）、室内居住（客厅/卧室/厨卫/书房等）、公共商业（学校/商铺/酒馆/医院/警局/教堂/寺庙等）、特殊异世界室内（魔法工坊/地牢/实验室/飞船/邪教祭坛/凶宅/工厂/监狱），并含横切资产（角色占位/天气特效/昼夜光照/季节皮肤/UI）与 P0–P3 制作优先级。每个场所按「地形/瓦片→大型结构→中型→点缀→光源→墙面→动态」七组列出具体资产，标注瓦片/地面/墙面/动态分类。*为什么：* 用户需要一份以「可出现场所」为导向、可直接对照制作的资产待办清单。
- **新增资产库大纲文档 `materials/资产库大纲.md`**（与 `materials/export_2026-06-04/meta.json` 的 13 层 `tagLayerSchema`、15 题材风格、`organizeFolders` 三大物理分类对齐）。内容含：标签 schema 复述、题材风格表（现有 15 + 建议补充）、§3 场所大纲（室外自然/农业聚落/末日特殊 + 室内居住/公共商业/异世界，按「大区域 buildingType → 小区域 roomType」组织）、§4 物品大纲（20 个功能类目的 name 词典，标注地面/墙面/瓦片物理分类）、§5 瓦片/地形规则集、§6 覆盖矩阵与 P0–P3 施工优先级。*为什么：* 用户筹备星露谷/奈斯启示录风格 PCG 2D 像素游戏，需要覆盖面广、组织严谨且可标注的资产库蓝图来指导素材采集/生成，现有素材太少。
- **`building_cluster` 小标签新增电池 `siheyuan_cluster`（四合院组群）**（`batteries/scene30/building_cluster/siheyuan_cluster/`）。按传统四合院范式生成院落组群：外围一圈贴齐 region 非零包围盒外边界的围墙（可开底墙院门），沿进深叠 `courtyards`（进数）个院落，每院由「横向房屋带（正房/厅堂/倒座房，贯穿院宽，共 N+1 条）+ 左右纵向厢房 + 环绕中庭的围廊」连接而成；房屋数量=3×进数+1（进数=1 即标准四合院 4 座房屋，控制房屋数量即调进数）。`hallDepth`/`wingWidth` 放不下时自动缩小以容纳进数与中庭。输出 `outputGrid`（合并多值：房屋各递增 id + 围廊 + 围墙各一值）/ `houses`（0/1 房屋列表，序为 正房→厅堂…→倒座房→各院西/东厢房）/ `wall` / `corridor` / `outputNameList`。已用 16×16（进数1，输出标准四合院四面房屋+中庭围廊+院门）、34×22（进数3，10 座房屋、三进院落形态）、8×8（极小仍成形）三组脚本验证。*为什么：* 用户要求一个可控房屋数量、忠实还原「矩形房屋由围墙+围廊连接、围墙贴齐外边界」的四合院组群生成电池。
- **`building_cluster` 小标签新增电池 `random_rect_scatter`（随机生成矩形）**（`batteries/scene30/building_cluster/random_rect_scatter/`）。输入 `region`（grid，定义输出尺寸）+ `points`（point2d，list），对每个点在其周围随机生成 `countPerPoint` 个矩形：随机方向、与点保持可控的大致中心距（`distance` ± `distanceJitter`）、随机宽高（`minSize..maxSize`），按 region 边界裁剪。双输出：`outputGrid`（多值网格，每矩形递增 id）+ `rects`（0/1 网格列表），可直接接 `siheyuan_wall_frame` 串成围墙。`seed` 可复现。算法已用 24×24 单点 5 矩形脚本验证：各矩形中心距点约等于设定 distance（7±），且能链入围墙电池。*为什么：* 用户需要按点位在其周围随机布置矩形（建筑），并能控制矩形与点的大致距离。
- **新增 scene30 小标签 `siheyuan`（四合院），内含电池 `siheyuan_wall_frame`（四合院围墙）**（`batteries/scene30/siheyuan/siheyuan_wall_frame/`）。输入多个矩形（`rects`，`grid`+`access:list`：0/1 网格列表，每张一个矩形；或单张多值网格，按不同非零 id 自动拆分），对每个矩形取最小包围盒、沿其长边方向画中心线（脊线），按围绕整体质心的极角排成环形，再贪心首尾相接（脊线 + 连接段）串成一条闭合折线，Bresenham 光栅化为线宽 `thickness`（默认 1）的 `wall` 网格输出。坐标约定 x→列、y→行。算法已用 12×12 四矩形（四合院四面房屋）独立脚本验证：输出为穿过每个矩形长边中心线、把四块串成的闭合方框围墙；多值网格拆分路径同样正确。*为什么：* 用户需要把若干矩形（如 `points2rects`/`bsp_rect_gen` 产出的房屋地块）用一道穿过各自长边中心线的闭合围墙串成四合院院落。

### Removed
- **资产库 `library.db` 删除 `asset_kind` 列（信息融入 alias 类型域）**（`materials/asset-store/library.db` 就地 `ALTER TABLE DROP COLUMN`+`VACUUM`；`backend/src/library/service.ts`(`AssetRecord.assetKind`/`AssetRow.asset_kind`/`rowToRecord`/`deriveAliasMeta` 入参/`optionalAssetColumns`)、`gameSandboxStore.ts`、`mergedLibraryPool.ts`、导入脚本 `scripts/{import-exported-assets,legacy-asset-overlays}.mjs`、相关测试同步去引用）。*为什么：* `asset_kind` 与 alias 类型域表达同一信息（瓦片=规则别名 / 物件=抠图），合并后 alias 自洽、消除并列真源。
- **资产库 `library.db` 再精简 2 个死列：`tags_json` / `library_path`，并剔除 `geometry_json` 里冗余的 `name` 键**（`materials/asset-store/library.db` 就地 `ALTER TABLE DROP COLUMN`+`VACUUM`，2923 资产全保留；`geometry_json.name` 逐行删除 2838 处；导入脚本 `scripts/{import-exported-assets,legacy-asset-overlays}.mjs`、`backend/src/library/service.ts`(`AssetRecord`/`AssetRow`/`rowToRecord`/`optionalAssetColumns`)、`backend/tests/import-exported-assets.test.ts` 同步去引用）。*为什么：* 调研确认 `tags_json` 的信息已可由 alias 13 字段完全派生、运行时无任何读取方；`library_path` 全仓无消费；`geometry_json.name` 只是 alias 的重复，解析从不读取。
- **资产库 `library.db` 精简 4 个冗余列：`tag_layers_json` / `organize_folder_path` / `export_path` / `crop_type_original`**（`materials/asset-store/library.db` 就地 `ALTER TABLE DROP COLUMN`+`VACUUM`，2909 资产/2900 blob 全部保留；导入脚本 `scripts/{import-exported-assets,legacy-asset-overlays}.mjs` 同步去列）。*为什么：* 用户要求合并标签 JSON、删除无用溯源列与重复的抠图判别列——`tag_layers_json` 的 label/zone/index 对每行恒等（属字段 schema 非每行数据），`tags_json` 已含其 value；`organize_folder_path`/`export_path` 运行时从不读取；`crop_type_original` 与 `asset_kind` 表达同一信息。

### Deferred
- **项目 baked 引用未随 alias 12 字段重构迁移（仅报告，未执行）。** 已烘焙的项目图层里存的旧版 alias 字符串（name 在 idx4、type 在 idx8、含 `__` 长连接、带大/小区域），在新代码下按 idx2=name / idx7=type 解析会错位 → 精确 `assetAlias` 绑定与按名匹配都可能失效，渲染/导出对这些历史图层暂时匹配不到贴图。影响面：任何在本次重构前保存的 `.forgeax` 项目 baked 快照 / cook 输入。迁移方案（待用户确认后单独执行）：对每份 baked 数据里的 `assetAlias` 用与 DB 相同的 `toRendererAlias(旧alias, 旧asset_kind)` 转换重写一遍；`assetName`（纯物体名，不含括号）不受影响，仅靠名字匹配的图层无需迁移。*为什么：* 用户明确「迁移项目 baked 引用先不做，报告即可」。

### Changed
- **alias 类型域(idx7)的物件裁剪标记由 `抠图` 改为 `asset`（承接上条 12 字段重构）**：`library.db` 就地把 2866 条物件 alias 的 idx7 `抠图` 重写为 `asset`（瓦片的规则别名不变）；`privateStore.ts`(`CUTOUT_TYPE_FIELD='asset'`)、`service.ts`(`NON_TILE_ASSET_KINDS` 增 `asset`)、`scene-export/assetMatch.ts` 与 `frontend/renderer/framework/asset/matchAssetEntry.ts`(cutout 池判据新增 `isCutoutTypeField`，同时兼容旧 `抠图`)、`legacy-asset-overlays.mjs::toRendererAlias`(非瓦片输出 `asset`) 同步。代码仍保留识别旧 `抠图`（历史/baked 数据向后兼容）。测试同步：修正上次 12 字段重构遗漏、未随之更新的前端 `buildVoxelMaster/index.test.ts`（旧布局 name@idx4/cutout@idx8 → 新 name@idx2/cutout@idx7/`asset`），后端 cutout 用例改用 `asset`。*为什么：* 用户要求把裁剪物件的类型标记语义从中文「抠图」改为通用 `asset`。
- **alias 字段契约由 13 字段重构为 12 字段（不可逆命名契约变更）**：删除 `大区域`(旧 idx2)/`小区域`(旧 idx3)、在 `物体名` 后插入空 `材质` 域(新 idx3)、`asset_kind` 融入 `类型/规则` 域(新 idx7：瓦片=规则别名如 `common_16`/物件=`抠图`)、连接符统一为单下划线 `_`。DB 就地重写全部 2909 条括号 alias（14 条无括号测试图保持原样），并同步下移所有硬编码索引：`service.ts`(`FIELD_INDEX` type8→7/style6→5/size9→8、`extractAliasTypeField` idx8→7、`deriveAliasMeta` 改读 idx7、搜索字段 idx4→2、`place` facet 降为单级 室内/室外)、`privateStore.ts`(`composeRendererAlias` 长度 13→12/name idx4→2/type idx8→7、`FIELD_INDEX`、`matchesFacet`/`facetPrivate` 单级 place)、`privateRoutes.repairAlias`(12 字段/name idx2)、`scene-export/assetMatch.ts`(name idx4→2/cutout idx8→7)、`frontend/renderer/framework/asset/matchAssetEntry.ts`(name idx4→2/cutout idx8→7/ppu idx9→8/变体组前 11 字段)、`frontend/workbench/AssetStorePanel.tsx`(FIELD_DEFS 12 字段)、导入脚本新增 `toRendererAlias()` 旧→新转换。25 个新 alias 因仅在被删的大/小区域上不同而碰撞（50 行，全部保留，匹配池按 alias `GROUP BY` 去重）。*为什么：* 用户要求去掉大/小区域、加材质域、asset_kind 回归 alias、统一下划线，收敛为单一自洽命名契约。
- **资产库 `library.db` 清理「默认圆整 anchor」：`anchor_x`、`anchor_y` 均 ≤2 位小数（如 0.5/0.38，判据 `x=round(x,2)`）的 994 条资产，其 `anchor_x/anchor_y` 置 NULL、并从 `geometry_json` 移除对应的 `pivot`（否则 pivot 会以 0.5 覆盖回 anchor）、清空该资产 collision（`collision_mask=[]`、`collision_category="None"`，541 条）**（`materials/asset-store/library.db` 就地迁移；要求 x、y 同时 ≤2dp 才清，精确计算得到的锚点/碰撞如 `0.4973…` 保留）。*为什么：* 这类圆整值是历史导出塞进去的默认占位、并非真实处理结果；渲染本就有 `?? 0.5` 兜底，且运行时发布路径已不再落默认值——留库反而与「无 anchor 即空」的语义冲突。anchor null 数 269→1263。
- **资产库 `library.db` 全部 2909 条资产 `zone` 由 `raw` 改为 `staging`**（`materials/asset-store/library.db` 就地 `UPDATE assets SET zone = 'staging'`）。*为什么：* 用户要求将现有素材库划入 staging 分区，与后续 raw 新素材区分。
- **瓦片判别由 `crop_type_original`（'瓦片组'/'wall'）改为 `asset_kind`**（`backend/src/library/service.ts`：新增 `isTileAssetKind`，`asset_kind` 非空且非 `抠图`/`object` 即视为瓦片组、其值即 autotile 规则别名）。同步清理 `service.ts`(`AssetRecord`/`AssetRow`/`rowToRecord`/`deriveAliasMeta`/`optionalAssetColumns`)、`privateStore.ts`、`gameSandboxStore.ts`、`routes.ts` 中对已删字段的引用；`PrivateAssetRecord` 去掉 `cropTypeOriginal`，发布桥仅靠 `assetKind` 绑定瓦片规则。*为什么：* 删除 `crop_type_original` 后需要等价的瓦片判别来源，避免 autotile 规则绑定失效。
- **scene30 小标签 `siheyuan` 重命名为 `building_cluster`（建筑组群）**（`batteries/scene30/siheyuan/` → `batteries/scene30/building_cluster/`，`siheyuan_wall_frame` 电池随目录迁移，id 不变）。*为什么：* 用户要求把该小标签改名为「建筑组群」。

- **interests 模板新增四个兴趣点 scene 模板：`FenceFarm`(`fence_farm`) / `ParkGenerator`(`park_generator`) / `ShrineLayout`(`shrine_layout`) / `FarmlandGrid`(`farmland_grid`)**（`batteries/templates/structures/interests/{FenceFarm,ParkGenerator,ShrineLayout,FarmlandGrid}/`）。四个电池均为标准 `inputGrid→outputGrid` 形态，按 `BspDistrictCluster` 范式包成 scene 组：输入 Scene → `scene_passthrough→node_explode→rect_grid→voxel_slice` 取顶层切片做掩码 → 电池产多值网格 → `grid_split_by_value`→`grid2node`(按 `AssetName` 命名、`asset_type=tile`)→`add_child` → `alg_region_subtract` 求 Rest → **严格 5 个固定输出**（Scene / 主产物 / Rest / 主Path / RestPath）。暴露端口：FenceFarm=FenceMode/GateCount/SectionCount/GateWidth/PlotWidth/PlotHeight；ParkGenerator=Algorithm/PathWidth/TreeCount/SpokeCount；ShrineLayout=Algorithm/DecorCount/PathWidth；FarmlandGrid=Layout/PlotWidth/PlotHeight/PathWidth/PlantDensity（`fillValue`/`z`/`schema`/`token`/`zRange` 隐藏）。已校验 JSON、无悬空边、暴露端口源有效、核心节点 inputGrid/seed/outputGrid 接线正确。*为什么：* 用户要求把这四个兴趣点电池按结构模板范式封装为可套用 scene 模板。
- **新增小标签 `structures/indoor`，封装两个室内家具放置 scene 模板：`AdaptiveRoomFurniturePlacer`(`adaptive_room_furniture_placer`) / `RoomLayoutPlacer`(`room_layout_placer`)**（`batteries/templates/structures/indoor/{AdaptiveRoomFurniturePlacer,RoomLayoutPlacer}/`）。同 `BspDistrictCluster` 范式包成 scene 组：输入 Scene → `scene_passthrough→node_explode→rect_grid→voxel_slice` 取顶层切片做房间掩码 → 电池产家具网格 → `grid_split_by_value`→`grid2node`(按 `AssetName` 命名、`asset_type=tile`)→`add_child` → `alg_region_subtract` 求 Rest → **严格 5 个固定输出**（Scene / Furniture / Rest / FurniturePath / RestPath）。两电池核心网格入口为 `roomGrid`（已据此改接 slice→核心边，区别于其它电池的 `inputGrid`）；`doorGrid`(门位置网格,可选)、`furnitureList`(家具清单,不接则无家具) 作为暴露输入由组外接入。暴露端口：AdaptiveRoomFurniturePlacer=DoorGrid/FurnitureList；RoomLayoutPlacer=DoorGrid/FurnitureList/LayoutMode/LayoutConfig（`fillValue`/`z`/`schema`/`token`/`zRange` 隐藏）。已校验 JSON、无悬空边、暴露端口源有效、核心节点 roomGrid/seed/outputGrid 接线正确。*为什么：* 用户要求把这两个室内家具电池按结构模板范式封装为可套用 scene 模板。命名沿用 `AssetName`+`str_to_list_branches`（仓内暂无「逐实例 `nameList`→按分支对齐」算子）。
- **water 模板新增两个 scene 模板：`RiverSpline`(`river_spline`) / `RiverLakeGen`(`river_lake_gen`)**（`batteries/templates/structures/water/{RiverSpline,RiverLakeGen}/`）。同 `BspDistrictCluster` 范式包成 scene 组：输入 Scene → 取顶层切片做基准 → 电池产网格 → `grid_split_by_value`→`grid2node`(按 `AssetName` 命名、`asset_type=tile`)→`add_child` → `alg_region_subtract` 求 Rest → **严格 5 个固定输出**（Scene / River(Water) / Rest / RiverPath(WaterPath) / RestPath）。`RiverLakeGen` 核心输出端口为 `waterGrid`（已据此改接核心输出边，区别于其它电池的 `outputGrid`）。暴露端口：RiverSpline=Points(必填)/Algorithm/RiverWidth/NumMidPoints/OffsetMin/OffsetMax/SegmentUniformity（`WindowSize`/`Sigma`/`BezierDegree` 隐藏）；RiverLakeGen=RiverCount/Algorithm/MinWidth/MaxWidth/LakeCount/WaterItems（`inputNameList` 隐藏）。已校验 JSON、无悬空边、暴露端口源有效、核心节点 inputGrid/seed/(out) 接线正确。*为什么：* 用户要求把这两个水系电池按装饰模板范式封装为可套用 scene 模板。
- **新增两个结构 scene 模板：`HillContourGenerate`(`hill_contour_generate`，归入 `structures/topographic`) / `TownIslandLayout`(`town_island_layout`，新建小标签 `structures/interests`)**（`batteries/templates/structures/{topographic/HillContourGenerate,interests/TownIslandLayout}/`）。同 `BspDistrictCluster` 范式包成 scene 组：输入 Scene → 取顶层切片做掩码 → 电池产多值网格 → `grid_split_by_value`→`grid2node`(按 `AssetName` 命名、`asset_type=tile`)→`add_child` → `alg_region_subtract` 求 Rest → **严格 5 个固定输出**（Scene / Hill(Town) / Rest / HillPath(TownPath) / RestPath）。暴露端口：HillContourGenerate=ContourLevels/HillCount/Roundness/PeakRadius/NoiseAmount/PeakPosition（`MinHoleSize`/`MinIslandSize` 隐藏）；TownIslandLayout=RoadWidth/BlockMinSize/ShapeType/ShapeScale/CoverageThreshold。已校验 JSON、无悬空边、暴露端口源有效、核心节点 inputGrid/seed/outputGrid 接线正确。*为什么：* 用户要求把这两个电池按装饰模板范式封装为可套用 scene 模板；`interests` 为兴趣点类结构新建小标签。
- **新增两个结构 scene 模板：`OrganicIslandShape`(`organic_island_shape`，新建小标签 `structures/topographic`) / `PointZoneGen`(`point_zone_gen`，归入现有 `structures/districts`)**（`batteries/templates/structures/{topographic/OrganicIslandShape,districts/PointZoneGen}/`）。把这两个 grid→多值网格电池按 `BspDistrictCluster` 同款流水线包成 scene 组：输入 Scene → `scene_passthrough→node_explode→rect_grid→voxel_slice` 取顶层切片做掩码 → 电池产多值网格 → `grid_split_by_value`→`grid2node`(按 `AssetName` 命名、嵌套 `TileAssetName` 写 `asset_type=tile`)→`add_child` → `alg_region_subtract` 求 Rest → **严格 5 个固定输出**（`out_0..4`：Scene / Island(Zone) / Rest / IslandPath(ZonePath) / RestPath）。暴露端口：OrganicIslandShape=NoiseScale/NoiseStrength/IslandRatio/Octaves；PointZoneGen=Regions（`[x,y,area,height]` JSON，必填否则无产物）。已校验 JSON、无悬空边、暴露端口源有效、核心节点 inputGrid/seed/outputGrid 接线正确。*为什么：* 用户要求把这两个电池按装饰模板范式封装为「输入 scene、五个固定输出」的可套用模板；`topographic` 为地形类结构新建小标签。
- **decorations 模板新增三个纹理地面 scene 模板：`IndoorTextureGround`(`indoor_texture`) / `MultiLayerGround`(`multi_layer_ground`) / `OutdoorTextureGround`(`outdoor_texture`)**（`batteries/templates/structures/decorations/{IndoorTextureGround,MultiLayerGround,OutdoorTextureGround}/`）。把 `components/decoration/{indoor_texture,multi_layer_ground,outdoor_texture}` 三个 grid→多值纹理网格电池按 `BspDistrictCluster` 同款流水线包成 scene 组：输入 Scene → `scene_passthrough→node_explode→rect_grid→voxel_slice` 取顶层切片做掩码 → 纹理电池产多值网格 → `grid_split_by_value`→`grid2node`(按 `AssetName` 命名、嵌套 `TileAssetName` 写 `asset_type=tile`)→`add_child` → `alg_region_subtract` 求 Rest → **严格 5 个固定输出**（`out_0..4`：Scene / Texture(Ground) / Rest / TexturePath(GroundPath) / RestPath，与 `NaturalDecorationDistribution`/`PoiPlace` 等装饰结构契约一致）。各模板额外暴露对应电池参数端口（indoor: Algorithm；ground: LayerCount/Threshold/Frequency/Octaves；outdoor: Temperature/Moisture）。已校验 JSON、无悬空边、暴露端口源节点/端口均有效、核心节点 inputGrid/seed/outputGrid 接线正确。*为什么：* 用户要求把这三个纹理电池按 `NaturalDecorationDistribution` 范式封装为「输入 scene、对 scene 操作、输出五个固定端口」的可一键套用模板。命名沿用已验证的 `AssetName`+`str_to_list_branches` 机制（仓内暂无「`nameList` 数组→按分支对齐的名称流」算子，故未直接消费电池 `nameList`）。
- **decorations 模板新增三个 scene 流水线模板：`DecorationBorder`(规则装饰物) / `PoiScatter`(随机POI分布) / `PoiPlace`(精准POI分布)**（`batteries/templates/structures/decorations/{DecorationBorder,PoiScatter,PoiPlace}/`，与 `NaturalDecorationDistribution` 同目录、同范式）。仿 `NaturalDecorationDistribution` 包成 scene 组：输入 Scene，内部 `scene_passthrough→node_explode→rect_grid→voxel_slice` 取区域 → 对应 `components/decoration/{decoration_border,poi_scatter,poi_place}` 电池在区域内布置 → `grid2node`+嵌套 `ObjectAssetName` 写资产名挂树 → `alg_region_subtract` 求剩余空地 → **严格 5 个输出**（`out_0..4`：Scene / 主产物 / Rest / 主Path / RestPath）。已通过真实后端 REST（instantiate + batch + execute）端到端验证：12×12 区域下 DecorationBorder 产出 decoration(20 体素)+rest(124)、PoiScatter/PoiPlace 在给定规则下产出 poi 层+rest，五件套路径句柄正确。*为什么：* 用户要求这三个装饰电池按 `NaturalDecorationDistribution` 范式封装为「输入 scene、对 scene 操作、严格五输出」的可一键套用模板，而非裸 grid 端口的薄封装。

### Changed
- **`PathConnectionLink` 模板的「道路宽度」默认值由 1 改为 2**（`batteries/templates/structures/path/PathConnectionLink/PathConnectionLink.json`：`road_connect_link` 节点 `params.roadWidth=2`）。*为什么：* 该模板期望更宽的默认道路，避免每次套用后手动调整。

### Fixed
- **`Scene Structure` 节点在组内视图（group inner view）现可正常显示逻辑树结构，不再卡在「连接 scene 端口以查看结构」占位。** `frontend/src/workbench/SceneStructureNode.tsx`：改为订阅整张 `nodeOutputs` 而非仅本节点输出——组内叶子可视化节点自身输出不会被持久化，scene 仅在异步 group-probe hydrate 上游生产者后到达，订阅全表才能在其落地后重渲染；配合内核 `nodeTooltip.tsx` `resolveInputPortValue` 现在会查 `group.edges` 追溯组内上游。*为什么：* 组内连线在 `group.edges` 而非根 edges，旧逻辑取不到输入。

### Added
- **新增 `BspDistrictCluster` district 模板（`batteries/templates/structures/districts/BspDistrictCluster/`）：输入一个点（Point）+ 矩形数量（RectCount）→ 围绕该点播撒一簇 BSP 矩形建筑地块，每块拆为独立子节点，并产出 Rest 空地。** 复用 `Regions` 同款六段流水线（passthrough→explode→rect_grid→voxel_slice→`bsp_rect_gen`→grid_split→grid2node→add_child→subtract→五件套），仅把分区算法换成 `bsp_rect_gen` 并暴露 Point/RectCount/MinSize/MaxSize 端口；嵌套 `TileAssetName` 子组写资产名。已用 `splitTemplate`+`buildTemplateOps`+`applyBatch` 验证实例化 `status:ok`。*为什么：* 缺少「点锚定的矩形建筑簇」模板（`Regions` 按方位配额、`ZoneNesting` 单块有机，均非矩形簇）。
- **`bsp_rect_gen` 新增可选 `centerPoint`（point2d）输入（`batteries/components/districts/bsp_rect_gen/`，v3.1.0）：** 连线时以精确采样点 `{x,y}`（裁剪到区域 bbox 内）作为播撒中心、覆盖九宫格 `centerPosition`；未连线时回退原九宫格行为，完全向后兼容（`index.ts:215,251` 中心定位分支 + `parsePoint`）。*为什么：* `BspDistrictCluster` 模板需要「输入一个真正的点」来锚定建筑簇，而原电池只接九宫格 1-9。
- **新增 `str_to_list_branches` 电池（`batteries/basic/trans/str_to_list_branches/`）：列表字符串 → 每元素一个独立子分支（`items`/`access:list`）。**
  容错解析：先按 JSON 解析，失败再退回「去外层方括号→顶层逗号切分→逐段 trim/数字转换」，故 `[test2,test3]`（元素不加引号）也能用；
  **非列表的裸标量（如 `TEST2`）按「单元素列表」处理、绝不返回 error**（否则单个输入会让节点失败、打断整条下游链）。空串→`[]`。
  与 `grid_split_by_value.grids` 同形态，可直接喂 item 端口逐个 fanout（如 `grid2node.name`）。
  *为什么：* `str_to_list` 只输出「单分支里的一个数组」，无法按分支与 `grid_split_by_value` 的网格分支对齐 fanout；需要一个把名称列表炸成分支、且对单值输入鲁棒的原语。

### Added
- **`PathConnection` / `PathConnectionLink` 模板新增可选 `Obstacles`(in_15, scene) 端口。** 模板内新增 `scene_passthrough→node_explode→voxel_slice→alg_region_union` 子链（`templates/structures/path/*/{PathConnection,PathConnectionLink}.json`）：接入的障碍场景在与主场景同一基准 grid/同一 z 高度上切片成障碍网格，再与内部"非可铺路区"(`alg_region_subtract`) 求并后喂给寻路节点 `obstacle`，道路据此绕行；端口悬空时 `node_explode` 返回空、并集等于原障碍，**与原行为完全一致**。*为什么：* 之前道路只能绕开"非可铺路区"，无法显式指定额外障碍场景（如特定建筑/水体）让道路避让。

### Fixed
- **`points_to_grid` 边界点不再被静默丢弃（`batteries/scene/point/points_to_grid/index.ts:21-30`）。** 原先 `c < cols && r < rows` 的硬越界判断会把「坐标==地图尺寸」的边界点（如 200 宽地图的 `x=200`）直接丢掉，导致 PathConnectionRandomWalk/Link 这类连点路网连不上该点，只能退一格输入 `x=199`。改为把越界坐标 `clamp` 到最近的边界格（`x=200`→第 199 列），落在区域外（0 格）的点仍忽略。*为什么：* 用户以地图尺寸级坐标定位边界点是自然预期，硬丢弃造成「差一格才连得上」的反直觉行为。

### Changed
- **`region_zone_generator` 改为「满铺基准」控制占地（`batteries/components/districts/region_zone_generator/`）。** 新增 `areaScale`（默认 10）参数：面积值以其为分母——加和 < 基准时各区域只占据 `面积/基准` 的比例（如 `[[3,8],[1,4]]` 加和=4 → 合计约 40%，分别约 30%/10%，区域收缩在方位种子周围、其余留空）；加和 ≥ 基准时按比例瓜分铺满（保持原行为）。改动点：`index.ts:91-101` 分母 `Math.max(areaScale, ratioSum)`；`placement.ts:220` `quotaVoronoiAssign` 在占比加和 < 1 时把各区域离种子最远的超额像素置空；`index.ts` 边界后处理改用 `effectiveMask`（仅已分配像素），避免 `rectilinear` 等风格重新铺满整张掩码抹掉留空。*为什么：* 原实现把面积权重归一化后恒满铺，无法表达「区域只占整体一部分」的需求；改为绝对面积/基准后既能部分占地又能贴合方位特征。
- **五个 interests 电池重写为 DataTree 形式（`building_generator` / `farmland_grid` / `fence_farm` / `park_generator` / `shrine_layout`）。**
  `batteries/components/interests/{building_generator,farmland_grid,fence_farm,park_generator,shrine_layout}/`：
  入参由 `gridList`(array/手动遍历) 统一改为 `inputGrid`(`grid`/`access:item`)，标量参数加 `access:item`，移除列表级 `mergeOutput`（building 的 `mergeOutput` 改为「该建筑房间地板是否合并」语义保留）；
  每次只处理单张网格，列表 fanout/重组交给引擎。输出统一为**单张多值 `outputGrid`**(`grid`/item) + `outputNameList`(array/item，仅含实际出现 id)。其中：
  `fence_farm`/`park_generator`/`shrine_layout` 各自的布局算法本就产出单张多值网格（栅栏/公园/神殿语义值），直接输出并按值生成名称清单（含 tile/asset 区分）；
  `farmland_grid` 移除「田地满铺 + 作物点位稀疏」双层拍平，合并为单张多值网格（田垄=1、田地=2、作物点位 3–6 按 `plantDensity` 稀疏，tile/asset 区分）；
  `building_generator` 移除跨建筑积累与墙体打包成 `outputGridList` 子列表的做法，墙顶=1/外墙体=2/内墙体=3/窗户=4/地板从5 写入同一张多值网格（重叠按 地板→内墙体→外墙体→窗户→墙顶 后写覆盖），`outputNameList` 保留墙体打包条目 `id=[3,2,4,1]`，大门继续由独立 `doorGrid`(item) 输出；同时把室内拆分提前到开窗前以修正自动窗数对 `roomComponents` 的引用顺序。各自的雕刻/BSP/开门窗/布局算法不变。
  版本：building 1.0.0→2.0.0、farmland 1.0.0→2.0.0、fence 1.0.0→2.0.0、park 1.0.0→2.0.0、shrine 1.0.0→2.0.0。
  *为什么：* 与 DataTree 网格电池统一数据流，列表 fanout/重组交给引擎；当前均无图/模板引用，可安全改契约。
- **四个电池重写为 DataTree 形式（`river_spline` / `town_island_layout` / `adaptive_room_furniture_placer` / `room_layout_placer`）。**
  `batteries/components/elements/{river_spline,town_island_layout}/` 与 `batteries/components/indoor/{adaptive_room_furniture_placer,room_layout_placer}/`：
  入参统一为单网格 `grid`/`access:item`，标量参数加 `access:item`；每次只处理单张网格，列表 fanout/重组交给引擎。其中：
  `river_spline` 仅端口 `grid`→`inputGrid` 并加 item 访问（本就单网格进出）；`town_island_layout` 移除列表级 `merge` 参数，
  道路+地块合并为**单张多值 `outputGrid`**（道路=1、各地块从 2 起递增 id）+ `outputNameList`(仅含实际出现 id)；
  `adaptive_room_furniture_placer`、`room_layout_placer` 本就单网格处理（roomGrid/doorGrid 进、单张多值 outputGrid 出），
  仅为各端口（含 doorGrid 同步配对）与标量加 item 访问，`furnitureList` 作为家具目录广播。各自的样条/BSP/家具放置算法不变。
  版本：river_spline 2.0.0→3.0.0、town_island_layout 1.3.0→2.0.0、adaptive 2.0.0→3.0.0、room_layout 1.5.0→2.0.0。
  顺带订正 town_island_layout / adaptive 的 README 过期端口名（mainRoad/subRoad/parcels、layoutGrid/newMaskA 等）。
  *为什么：* 与 DataTree 网格电池统一数据流，列表 fanout/重组交给引擎；当前均无图/模板引用，可安全改契约。
- **`Regions` 模板重写为「按分区 fanout 成多个同级子节点」（`batteries/templates/structures/districts/Regions/Regions.json`）。**
  数据流由「单张多值网格 → 一个 `grid2node` → 一个 district 节点」改为
  `region_zone_generator.outputGrid → grid_split_by_value(按 zone 值拆分) → grid2node(逐 zone fanout) → add_child`；
  每个 zone 生成 1 个同级子节点，节点名按顺序取 `DistrictAsset`（经 `str_to_list_branches` 解析的列表），外加 1 个 `rest` 节点。
  暴露输入修正：`DistrictAsset(in_1)` 现映射到 `rz_names.str`、`Regions(in_3)` 现直接映射到 `rz_zone.regions`（消费端输入口，连线即覆盖内部默认面板）——
  旧版 `in_3` 错误地映射到 `text_panel` 的 **output** 端口，导致外部 Regions 永远被丢弃、只用内部默认值。
  仍保持 5 个输出端口（out_0 主 scene / Rest / District / DistrictPath / RestPath），`DistrictPath` 现为各 zone 的路径列表。
  *为什么：* 用户期望 `DistrictAsset`、`Regions` 支持 datatree，在当前 focus 节点下挂载多个同级子节点、`DistrictPath` 输出为列表；
  旧模板既丢弃 Regions 输入、又只产出单个合并节点，不满足需求。
  `batteries/components/elements/{hill_contour_generate,lake_gen,river_lake_gen}/`：入参统一为 `inputGrid`(`grid`/`access:item`)，
  标量参数加 `access:item`；每次只处理单张网格，列表 fanout/重组交给引擎。其中：`hill_contour_generate` 由「每输入网格
  contourLevels 张单值层网格 `contourLayers`」合并为**单张多值 `outputGrid`**（格值=等高带层序号 1..N），`outputNameList` 仅含实际出现层；
  `lake_gen` 移除列表级 `merge` 参数，各湖泊写入同一张多值 `outputGrid`（每湖一个递增 id）+ `outputNameList`(item)；
  `river_lake_gen` 本就单网格处理，仅将端口 `grid`→`inputGrid`、`grid`/`waterGrid`/`nameList`/标量加 item 访问。各自的高斯距离场/
  随机洪泛/河流路径算法不变。版本：hill 1.0.0→2.0.0、lake 1.1.0→2.0.0、river 1.0.0→2.0.0。`region_zone_generator` 已是 DataTree 形式，未改动。
  *为什么：* 与 DataTree 网格电池统一数据流，列表 fanout/重组交给引擎；除 `region_zone_generator`(已 DataTree)外当前均无图/模板引用，可安全改契约。
- **四个 districts 电池重写为 DataTree 形式（`cliff_platform_gen` / `organic_island_shape` / `point_zone_gen` / `random_rect_zone_gen`）。**
  `batteries/components/districts/{cliff_platform_gen,organic_island_shape,point_zone_gen,random_rect_zone_gen}/`：
  入参由 `grid`/`grids`/`inputGrid`(array/手动遍历) 统一改为 `inputGrid`(`grid`/`access:item`)，标量参数加 `access:item`；
  输出统一为**单张多值 `outputGrid`**(`grid`/item) + `outputNameList`/`nameList`(array/item)，每次只处理单张网格，列表 fanout/重组交给引擎。
  其中：`organic_island_shape` 由「每输入网格 4 张单值网格」合并为单张多值网格（地面=1/浅水=2/中水=3/深水=4）；
  `point_zone_gen` 各区域写入同一张多值网格（每区域递增 id，保留 height）；`random_rect_zone_gen` 移除列表级 `merge` 参数、
  各矩形写入同一张多值网格并保留 `placedCount`；`cliff_platform_gen` 仅重命名端口 + 加 item 访问（本就单网格处理）。
  各自的圆形平台/柏林噪声海岛/BFS 生长/矩形放置算法不变。版本：cliff 1.0.0→2.0.0、organic 2.0.0→3.0.0、point 1.0.0→2.0.0、rect 1.1.0→2.0.0。
  *为什么：* 与 DataTree 网格电池统一数据流，列表 fanout/重组交给引擎；当前均无图/模板引用，可安全改契约。
- **POI/装饰/地块四电池重写为 DataTree 形式（`poi_place` / `poi_scatter` / `precise_decoration_scatter` / `bsp_rect_gen`）。**
  `batteries/components/decoration/{poi_place,poi_scatter,precise_decoration_scatter}/` 与
  `batteries/components/districts/bsp_rect_gen/`：入参由 `grid`/`inputGrid`(array，手动遍历网格列表) 统一改为
  `inputGrid`(`grid`/`access:item`)；输出从「单值网格平铺列表 `outputGridList`」改为**单张多值 `outputGrid`**
  (`grid`/item，每种 POI/装饰/地块一个递增 id)，保留 `outputNameList`(array/item，仅含实际出现条目)；
  三个散布电池保留 `placedCount`(number/item)。`bsp_rect_gen` 同时移除列表级 `merge` 参数（合并/拆分交由下游
  `grid_split_by_value`），所有地块写入同一张多值网格、重叠处后写入者覆盖。各自的 BFS 就近/随机散布/泊松/BSP 分割
  算法不变。版本：poi_place 1.0.0→2.0.0、poi_scatter 1.0.0→2.0.0、precise 1.0.0→2.0.0、bsp_rect_gen 2.1.0→3.0.0。
  *为什么：* 与 DataTree 网格电池统一数据流，列表 fanout/重组交给引擎；当前均无图/模板引用，可安全改契约。
- **四个装饰电池重写为 DataTree 形式（`indoor_texture` / `outdoor_texture` / `natural_decoration` / `multi_layer_ground`）。**
  `batteries/components/decoration/{indoor_texture,outdoor_texture,natural_decoration,multi_layer_ground}/`：
  入参从 `gridList`/`grid`/`baseGrid`(array，手动遍历 + 跨网格合并) 统一改为 `inputGrid`(`grid`/`access:item`)；
  输出从「单值网格平铺列表 `outputGridList`」改为**单张多值 `outputGrid`**(`grid`/item，每类纹理/装饰/层一个递增值)，
  保留 `nameList`/`outputNameList`(array/item，仅含实际出现的条目，映射值→名称，下游可 `grid_split_by_value` 拆分后命名)。
  各自的纹理/生物群系/散布/Perlin 多层算法不变；`multi_layer_ground` 多层合并到一张多值网格、重叠处取较高层。
  版本：indoor 1.2.0→2.0.0、outdoor 2.0.0→3.0.0、natural 3.3.0→4.0.0、multi_layer 1.1.0→2.0.0。
  *为什么：* 与 DataTree 网格电池统一数据流，列表 fanout/重组交给引擎；当前均无图/模板引用，可安全改契约。
- **`river_bridge`（河流架桥）重写为 DataTree 形式。**
  `batteries/components/Topographic/river_bridge/`：端口由 `input`(array，手动遍历网格列表)/`outputGridList`
  改为 `inputGrid`/`outputGrid`(`grid`/`access:item`)，对齐 `road_connect_link`；算子每次只处理单张网格，
  列表 fanout/重组交给引擎。保留 `outputNameList`(array/item，固定 `[{id:1,name:'桥',type:'tile'}]`)。
  PCA/连连看/对角补点等架桥算法不变。版本 1.1.0 → 2.0.0。
  *为什么：* 与同组地形电池统一为 DataTree 数据流；当前无图/模板引用，可安全改契约。
- **`decoration_border`（规则装饰物）重写为 DataTree 形式。**
  `batteries/components/decoration/decoration_border/`：入参 `baseGridList`(array) → `inputGrid`(`grid`/item)，
  输出 `outputGridList`(每种装饰物一张) → 单张多值 `outputGrid`(`grid`/item，每种装饰物一个递增 fillValue)；
  保留 `nameList`(array/item，映射 fillValue→名称，下游可 `grid_split_by_value` 拆分后命名)。fillValue 改为按本网格
  `max+1` 起算。摆放/填充/解析算法不变。版本 2.0.0 → 3.0.0。
  *为什么：* 与 DataTree 网格电池统一；多值网格+nameList 保留用户自定义资产名映射，当前无图/模板引用，可安全改契约。
- **`ramp_mask_gen`（坡道掩码生成）重写为 DataTree 形式。**
  `batteries/components/Topographic/ramp_mask_gen/`：端口由 `input/output`(array，手动遍历网格列表 + `merge` 合并)
  改为 `inputGrid`/`outputGrid`(`grid`/`access:item`)，对齐 `zone_nesting`、`zone_nesting_riverbank`；
  算子每次只处理单张网格，列表 fanout/重组交给引擎。移除 `merge` 端口与 `outputNameList` 输出（列表级语义在 DataTree 下由引擎承担），
  坡道格保留原区域值。版本 1.3.0 → 2.0.0。
  *为什么：* 与同组地形电池统一为 DataTree 数据流；当前无任何图/模板引用该算子，可安全改契约。

### Fixed
- **`EdgeGrassClusters` 模板 District/Rest 两个 scene 输出端口内容对调。**
  `batteries/templates/structures/districts/EdgeGrassClusters/EdgeGrassClusters.json`：
  `out_1`(Rest) 与 `out_2`(District) 的 `sourceNodeId` 互换（`rb_out_rest` ↔ `rb_out_zone`），
  使 District 端口输出地块本体、Rest 端口输出剩余空地。
  *为什么：* 实测该模板运行时两端口输出内容反了；按用户要求仅交换本模板这两个端口。
- **用户「保存到模板」的小标签失效——保存路径补一层「模板文件夹」使其与内置模板同构。**
  此前 save-user 写到 `templates/My templates/<smallTag>/<name>.json`（json 直接放在小标签目录下），
  与扁平内置模板 `templates/{大}/{模板}/file.json` 结构相同，前端 `getTemplateSmallLabel` 把 `<smallTag>`
  误判为模板文件夹 → 返回 null → 小标签丢失、模板被平铺。现改写到
  `templates/My templates/<smallTag>/<name>/<name>.json`（`backend/src/routes/groupTemplates.ts` save-user），
  结构与内置 `templates/{大}/{小}/{模板}/file.json` 同构，小标签正确恢复；删除路径自下而上清理变空目录。
  测试 `backend/tests/groupTemplates.test.ts` 更新断言为新路径（含模板文件夹层）。
  *为什么：* 模板支持二级标题后，用户模板因少一层目录被误判，小标签整体失效。

### Added
- **新建 `PathConnectionLink` 模板（道路连接·连连看变体）。**
  `batteries/templates/structures/path/PathConnectionLink/`：复刻 `PathConnection` 骨架，仅把中间连点算子
  从 `alg_topology_connect_points`（A* 随机游走）换成 `road_connect_link`（连连看折线，最多 2 次转弯，A* 兜底），
  输入/输出端口完全一致、连线无需改动。新 group id `group_1782300000000_pclnk`。
  *为什么：* 用户要把另一种 road 电池（连连看）也包成与随机游走版并列的模板。
- **`/api/v1/group-templates` 列表返回模板的 `version` / `author` / `createdAt`，供前端 Templates 行展示。**
  `backend/src/routes/groupTemplates.ts`：`collectCatalogItems` 从模板 JSON 顶层读 `version`（缺省 `1.0.0`）、`author`、`createdAt`（缺省回退文件 mtimeMs）；
  `GroupTemplateBattery` 接口同步新增 `author?` / `createdAt?`。保存路径（`/save`、`/save-user`）经新增 `stampTemplateMeta` 把 `version`/`createdAt`（缺省 `Date.now()`）落盘进模板 JSON（已有值保留）。
  *为什么：* 模板列表要显示版本、作者、制作时间，需后端从模板 JSON 读取并在保存时持久化。

### Changed
- **`road_connect_link` 电池重写为 datatree/item 形态（v1→v2.0.0）。**
  `batteries/components/Topographic/road_connect_link/{meta.json,index.ts}`：I/O 从「array 进 / 列表出、内部批处理」
  改为与 `alg_topology_connect_points` 完全一致的「单张 grid 进/出 + 引擎 DataTree fanout」：`poiGrid`/`obstacle`(item grid)
  进、`topology`(item grid)+`outputNameList` 出，新增 `coverPoi`；连连看算法（`linkPath`+A* 兜底+`maxTurns`）保持不变。
  *为什么：* 让连连看电池能像随机游走版一样干净地包进 `PathConnection` 模板骨架（端口对齐、可直接互换）。
- **`PathConnection` 模板显示名改为 `PathConnectionRandomWalk`**（仅 `name`/`nameEn`）。
  保留文件名 `PathConnection.json`、folder、group id `…zblc6` 不变——`instantiateTemplate` 按 group id / 文件 basename
  解析，Sino skill 文档仍以 basename `PathConnection` 实例化，故不动 basename 以**零破坏**，只改调色板显示名以与 Link 版区分。
  *为什么：* 用户要两个 road 模板分别改名、可区分随机游走 vs 连连看。
- **`EdgeTreeClusters` 模板：内部电池默认值调整。**
  `batteries/templates/structures/districts/EdgeTreeClusters/EdgeTreeClusters.json`：
  `eg_clusters`(`edge_green_cluster`) 节点 `params` 写入 `count: 17`、`clusterSize: 267`，
  覆盖算子默认值（原 12 / 18）。*为什么：* 该模板需要更多、更大的边缘树簇默认表现。
- **`LakeRegions` 模板：暴露 `LakeSize` 输入以控制单个湖的大小。**
  `batteries/templates/structures/water/LakeRegions/LakeRegions.json`：删除原本硬喂
  `alg_region_flood_grow.size` 的 `number_const`(=50) 及其连线，改为把 flood_grow 的 `size`
  端口暴露为 `in_18`（`customLabelEn: LakeSize`），并将 50 写入该节点 `params.size` 作为默认值。
  *为什么：* 用户要能从模板外部控制 lake 的 size（每个湖斑块的目标格数）。

### Added
- **新建 `RegionZoneGenerator` districts 模板（按方位+面积配额分区）。**
  `batteries/templates/structures/districts/RegionZoneGenerator/`：照 `RiverbankZone` 骨架
  （`scene→node_explode→rect_grid→voxel_slice→region_zone_generator→grid2node→add_child`，
  Rest=`占用区−分区`），把 `region_zone_generator` 包成与同目录地块模板一致的 **5 输出**
  （Main/Rest/District/DistrictPath/RestPath）。输入暴露 scene + DistrictAsset/Seed/Regions/
  BoundaryStyle/RelaxIterations/SmoothIterations，`Regions` 由内置 `text_panel`（默认
  `[[1,1],[1,5],[1,9]]`）提供可覆盖默认值。
  *为什么：* 用户要把 `region_zone_generator` 小电池包成现在的 datatree 模板形态。
- **新建 `RiverbankGreenZone` 模板（河岸侵蚀 + 边缘绿簇·叠加到同一节点）。**
  `batteries/templates/structures/districts/RiverbankGreenZone/`：把 `RiverbankZone` 与 `EdgeGreenClusters`
  合并为一个模板。同一占用区掩码分别喂 `zone_nesting_riverbank`（河岸侵蚀网格 D）与 `edge_green_cluster`
  （边缘绿簇网格 C），两张网格经 `alg_region_union` **逐格求并为一张**，再 `grid2node` 生成**唯一一个地块节点**
  （单 voxel-mass）。默认 ErosionStrength=17、Count=16、ClusterSize=267，3 输出（主产物/District/DistrictPath）。
  *为什么：* 用户要 grid 结果完全合并到同一个节点（单节点单 voxel-mass），而非父子两层或保留差集。

### Fixed
- **`edge_green_cluster`：`clusterSize` 现在如实生效。** 旧实现各簇共享全局占用图，`count` 较大时
  种子沿轮廓密集排布、后到种子落在已占用格上直接产出 0 格，存活簇也被邻簇挤死，导致即便 `clusterSize=300`
  也只生成零星小簇。改为每簇独立生长、只受区域掩码约束（相邻簇允许重叠连片，写出取并集）。脚本实测
  200×130、count=5：`clusterSize=300`→1571 格、`=30`→158 格，单簇大小随参数线性变化。
  *为什么：* 用户反馈 `clusterSize` 调大无效。

### Changed
- **`EdgeTreeClusters` 模板补齐 Rest 输出，对齐 `RiverbankZone` 的 5 输出规范。**
  `batteries/templates/structures/districts/EdgeTreeClusters/EdgeTreeClusters.json`：原来只有
  3 输出（Main/Clusters/ClustersPath）、不产 Rest。新增 `alg_region_subtract`(占用区−绿簇)→
  `grid2node`→`add_child`(rest) + `scene_merge_subtrees` + 第二个 `scene_focus_path`，
  输出改为 **3 scene + 2 path**：Main/Rest/Clusters + ClustersPath/RestPath（顺序与
  RiverbankZone 一致）。README 同步更新。
  *为什么：* 用户要 EdgeGreenClusters 系模板也输出 Rest 区域、与其他地块模板输出规范统一。
- **`region_zone_generator` 电池改为 DataTree 单网格契约（v2.0.0）。**
  `batteries/components/districts/region_zone_generator/{index.ts,meta.json}`：入参 `baseGrid`(array,
  支持网格列表)+输出 `outputGridList`/`nameList` → 改为 `inputGrid`(grid, item) 进、单张多值
  `outputGrid`(grid, item) 出（分区 k→ID `k+1`，未分配=0），网格列表交由引擎逐张 fanout，
  与 `zone_nesting`/`edge_green_cluster` 对齐；移除 `nameList` 输出。`regions` 兼容
  `[area,position]`/`[name,area,position]`/JSON 字符串（名称仅作注释）。
  *为什么：* 用户要求直接在原电池上改成可被地块模板复用的单网格形态、不再输出 nameList。
- **三个 districts 模板的资产名暴露端口 `DistrictName`/`ClusterName` → `DistrictAsset`。** 与
  `structures/water/LakeRegions` 的 `LakeAsset` 命名对齐，明确该端口为资产名称。涉及
  `ZoneNesting`/`RiverbankZone`/`EdgeGreenClusters` 的 `customLabelEn` 及对应 README。

### Added
- **新建 `edge_green_cluster` 电池（边缘绿簇）+ `EdgeGreenClusters` 模板。**
  电池 `batteries/components/Topographic/edge_green_cluster/`：沿 targetValue 区域外轮廓等距+抖动取 `count`
  个边缘种子，每个种子用「欧氏距离 + FBM 噪声」优先级 BFS 在区域内部长出 ~`clusterSize` 个像素的不规则团块
  （`irregularity` 控制破碎度，占用图防重叠），输出与输入同形状的绿簇掩码（背景 0，簇=`outputValue`）；
  输入/输出同为 `grid`/`item`（DataTree）。脚本实测 50×50：簇细胞 100% 落在距边界 ≤4 内，确实粘附边缘。
  新模板 `batteries/templates/structures/districts/EdgeGreenClusters/`：scene 输入 + 暴露 `Count`/`ClusterSize`/
  `Irregularity`/`Seed`/`ClusterName`，内部 `node_explode → rect_grid + voxel_slice → edge_green_cluster →
  grid2node → add_child`，纯装饰叠加（不消耗区域），3 输出（主产物 / Clusters / ClustersPath）。
  *为什么：* 给已成形地块/水体边缘点缀自然碎绿（灌木/苔藓/藻类）。
- **`zone_nesting` 改 DataTree 数据格式 + 新建 `ZoneNesting` 模板（templates/structures/districts）。**
  电池 `batteries/components/Topographic/zone_nesting/`：输入 `inputGrid`、输出 `outputGrid` 改为
  `type:grid`/`access:item`——每次只处理单张网格，网格列表交由引擎按 DataTree 自动 fanout / 重组；
  删除手写的 `parseInputGrids` 列表打包与 `outputGridList` / `outputNameList` 数组（命名交给下游模板），
  `meta.json` 升版 `2.0.0`。新模板 `batteries/templates/structures/districts/ZoneNesting/`（参考
  `interests/structures/LakeRegions`）：scene 输入 + 自定义参数暴露为输入端口，5 个 scene/string 输出
  （主产物 / Rest / District / DistrictPath / RestPath），内部 `node_explode → rect_grid + voxel_slice →
  zone_nesting → grid2node → add_child`，Rest = `alg_region_subtract(占用区 − 地块)`。
  *为什么：* 让 `zone_nesting` 能像其它 grid 电池一样在 DataTree 流水线里直接复用，并提供可实例化的地块模板。
- **新建 `zone_nesting_riverbank` 电池（河岸式变深度侵蚀）+ `RiverbankZone` 模板。**
  电池 `batteries/components/Topographic/zone_nesting_riverbank/`：`erosionStrength` 默认 `54`；用低频 FBM
  噪声场驱动每段边界的侵蚀深度（`depth = clamp(strength + (fbm-0.5)·2·waviness,0,1) × maxDepth`，先 padded
  多源 BFS 求内向距离再判 `d ≤ depth`），让内边界**深浅不一、忽宽忽窄**形成自然河岸，而非 `zone_nesting`
  的等距偏移内缩；新增 `waviness`/`maxDepth`/`featureScale` 参数，输入/输出同为 `grid`/`item`（DataTree）。
  新模板 `batteries/templates/structures/districts/RiverbankZone/` 与 `ZoneNesting` 同构，改用本电池并暴露
  `ErosionStrength`/`Waviness`/`MaxDepth`。脚本实测 60×40 全 1 网格：内边界 top-edge 深度 7~40 起伏，明显波动。
  *为什么：* 用户需要比均匀偏移更夸张、极不均匀的有机河岸地块边界。
- **成组电池/模板保存方式与 wb-2d 资产插件统一：区分预置（builtin）与用户内容，支持删除用户模板。**
  此前 scene 侧 `groupTemplates.ts` 虽已能把「保存到模板」写入 workspace `.forgeax`
  （`save-user` → `user-content/templates/My templates/<smallTag>/`），但列表项不带 `builtin`
  标记、也没有删除入口，导致电池栏右键菜单无法删除自己保存的用户模板（内核已支持，但 scene
  的 `HttpApiClient` 缺 `deleteUserTemplate`）。现对齐 wb-2d：(1) `collectCatalogItems` 给每项
  打 `builtin`（`root !== userTemplateRoot()`：用户内容 = `false` 可删，groups/ 与内置 templates/
  = `true` 只读）；(2) 新增 `DELETE /api/v1/group-templates/user/:id`（仅在 `.forgeax` 用户根按
  id 定位删除，删后清理变空小标签目录，预设永不可达）；(3) 前端 `HttpApiClient.deleteUserTemplate`
  打通内核右键删除链路。落点：`backend/src/routes/groupTemplates.ts`（`builtin` 字段 +
  `findUserTemplateFile` + DELETE 路由）、`frontend/src/api/HttpApiClient.ts`。测试
  `tests/groupTemplates.test.ts`（用户模板 `builtin:false`、按 id 删除消失、删缺失/预设 404）。
  *为什么：* 让 scene 与资产插件「预置只读 / 用户保存到 .forgeax 且可删」的成组电池语义完全一致。

### Fixed
- **Templates 预览图改读文件夹内任意 `.png`（与 wb-2d 资产插件一致），不再只认 `icon.png`。**
  此前 `groupTemplates.ts:readIconPng` 只 `resolve(dir, 'icon.png')`，模板里实际图片名为
  `下载.png` 等时一律「No preview」。现改为扫文件夹、优先 `icon.png` 否则取首张受支持图片
  （png/jpg/jpeg/webp/gif，按名排序），编码 data URL（`backend/src/routes/groupTemplates.ts:readIconPng`）。
  测试 `tests/groupTemplates.test.ts`（放 `下载.png` 验证 iconPng 为 data URL）。
  *为什么：* 用户的 scene 模板预览图未命名为 `icon.png`，导致电池栏 Templates 卡片无预览。

### Changed
- **模板按小标签归类（配合内核 Templates 小标签手风琴）。** `AddBaseGrid` 由
  `templates/scene/` 迁到 `templates/general/`；`LakeRegions` 由 `templates/scene/`
  迁到 `templates/interests/decoration/`（`templates/{大标签}/{小标签}/{模板}/file.json`
  结构，使 Templates 模式显示「interests › decoration」小标签）。*为什么：* 让 scene
  模板能像 Develop 一样按小标签分组（内核渲染改动见根 CHANGELOG）。

- **整治 Sino「想太多」：补「放 N 栋手动建筑」照抄食谱 + 把房子路由从「专属/非默认」改回「默认走 `dechouse_gen`」。**
  起因：用户提供的 Sino 思考轨迹显示，做一个村庄时 Sino (1) 为「怎么串多个 `PointSampleBuilding`」反复空想几十轮，(2) 房子最终走了 PART A 小 sprite、完全没调 `dechouse_gen` 装饰房屋模板。根因两条都在文档：
  - **多栋手动建筑无可照抄食谱**（`PointSampleBuilding/README.md` 只讲单栋），但 persona 又「禁止自行探索」→ 被迫硬猜。现新增 README「放 N 栋手动建筑」节（链 `out_3`(Rest)→下一栋 `in_1`、**绝不接 `out_2`**(root 0 cells→静默产空+`scene is required`)、POI=各 `out_0` merge、汇总 `tree_merge`[`ABG.out_1`...]→flatten→merge_subtrees），并同步 `compose-sino-scene/SKILL.md`「手动放置装饰性建筑」、`TEMPLATES_INDEX.md`、persona 手动放楼条。
  - **房子被路由去 PART A**：`compose-sino-scene/SKILL.md`「掩码提取」、`texture-pipeline/SKILL.md` 3.0、`building_footprint_mask/README.md`、persona 与 lessons 此前都把 `dechouse_gen` 框成「专属、非默认、仅当用户明确要 billboard 整栋贴图」。现统一改为「**要给房子/建筑出贴图/资产 → 默认走 PART C `dechouse_gen`**，唯一例外是纯结构化盖楼用内置墙材」。
  - persona 新增「工作风格：多做少想、边做边想」directive + 「路由」速查表（普通场景/手动放楼/房子贴图/tile/小物件各走哪条），前置在最显眼处，replace「先长篇推演」的元行为。
  *为什么：* 用户明确「Sino 思考时间太长不合理、要多做少想直截了当；房子生成还在 PART A/B，完全没调装饰房屋模板电池」。过度思考的结构性成因＝文档既禁止探索又不给食谱、且把正确路径 gate 成「非默认」。
- **`PointSampleBuilding` 写明装饰性建筑尺寸铁律：Width/Height 至少 `10×10`（格），常规 10×10～16×16，`4×4` 太小、别过大（≫20×20）。**
  `batteries/templates/scene/PointSampleBuilding/README.md`（in_2/in_3 表行 + 新增「尺寸铁律」note + 把示例 Width/Height 由 8/6 改 12/12）、
  `compose-sino-scene/SKILL.md`「手动放置装饰性建筑」step 2、`TEMPLATES_INDEX.md` 同节、`agent-sino/persona/zh.md` 手动放楼一条同步补上。
  *为什么：* 用户明确「装饰性房屋推荐至少 10×10，4×4 这种瞎扯淡」；太小的 Width/Height → 建筑区域墙体/门挤一团、后续 `dechouse_gen` 整栋贴图也稀碎。
- **`compose-sino-scene/SKILL.md` 与 sino persona 的「整栋建筑贴图」更正为：2D 侧一键 `asset2d:pipeline.instantiateTemplate({templateId:"dechouse_gen"})`，不再让 AI 手搭等价链。**
  上一轮文档因当时 2D 工具层缺 `instantiateTemplate`，写了「用 `asset2d:pipeline.applyBatch` 复刻等价链」；本轮 2D 插件已补齐该 op
  （见 `wb-2d-scene-asset-generator` CHANGELOG「Added」），故把 `skills/compose-sino-scene/SKILL.md`「手动放置装饰性建筑」step 6/脚注、
  `agent-sino/persona/zh.md`「整栋建筑贴图」step 4 + 「2D 侧与发布」节统一改为**一键实例化 `dechouse_gen`**（`in_0`=占地 json、`in_1`=height、
  `in_15`=roofType → `out_3`=贴图、`out_4`=碰撞掩码；`house_template`/`house_footprint`/`grid_json_to_size` 是模板内部节点、别手搭）。
  *为什么：* 用户明确「生成建筑只需一个模板电池，手搭节点链是过时错误做法」；2D 现已和场景侧对等支持模板组一键实例化，文档与 persona 必须锁步。

### Added

- **新模板组 `PointSampleBuilding`（手动点位建筑）发布到 `templates/scene/`。**
  把开发版 `batteries/groups/scene/PointSampleBuilding`（仅 Develop 可见、Sino 看不到）原样复制为
  `batteries/templates/scene/PointSampleBuilding/PointSampleBuilding.json`（templateId
  `group_1781751905067_4k92s`），使 Sino 可经 `scene:pipeline.instantiateTemplate` 实例化。它支持
  **在指定坐标手动放一栋装饰性建筑**：IN `in_0`Point(point2d)/`in_1`场景/`in_2`Width/`in_3`Height/`in_4`BuildingAsset，
  OUT `out_0`Building/`out_1`BuildingPath/`out_2`scene/`out_3`Rest/`out_4`RestPath。配套新增 `README.md`
  （完整工作流 + 可照抄 ops/CLI）。*为什么：* 与 `ArchitectureRegions`（随机撒 N 栋）互补，满足"就要在这个坐标放一栋这么大的楼"的地标/剧情/装饰诉求。
- **`manual_points`（手动点位）加入 Sino 顶层 opId 白名单。** `backend/src/routes/sinoOpGate.ts`
  的 `SINO_TOP_LEVEL_OPID_ALLOWLIST` 增加 `manual_points`（x,y→point2d），并与
  `skills/compose-sino-scene/SKILL.md`「op 白名单」「手动放置装饰性建筑」一节、`TEMPLATES_INDEX.md`
  同步（gate↔skill 锁步）。*为什么：* `manualPoint → PointSampleBuilding` 工作流的第一步要在顶层
  `createNode` 一个点位源；不入白名单则被硬门拒绝，工作流无法跑通。`sinoOpGate.test.ts` 新增对应断言。

### Changed

- **`ArchitectureStructures` 模板新增可见输入 `in_30`（z 高度）。** 用开发版
  `batteries/groups/scene/ArchitectureStructures`（含新增 z 输入，31 个 exposedInputs）覆盖发布版
  `batteries/templates/scene/ArchitectureStructures/ArchitectureStructures.json`（原 30 个）；`in_30`
  接内部 `voxel_slice.z`，控制建筑结构层高/体素切片高度。同步更新该模板 `README.md` 与 `TEMPLATES_INDEX.md`。
  *为什么：* `PointSampleBuilding.out_0`(Building) → `ArchitectureStructures`（指定 z=1）出细节结构的工作流需要显式喂层高。
- **`compose-sino-scene/SKILL.md` 打通"手动放楼 → 占地 json → 2D 建筑贴图 + 碰撞掩码"端到端。**
  在「手动放置装饰性建筑」与「整栋建筑贴图」两节写明：`PointSampleBuilding` 的 Building 经 `BuildingPath` →
  `scene_focus_path` → `building_footprint_mask`（0/1/2 占地掩码）→ `grid_to_json` 分析成 JSON 保存，这份 JSON **原样**
  作为 2D 模板 `dechouse_gen.in_0`(json_mask)（内部 = `house_template.spec`/`house_footprint.spec`/`grid_json_to_size.json`），
  配 `in_1`=height、`in_15`=roofType → `out_3`=建筑贴图、`out_4`=碰撞掩码导出；并补「闭环命名铁律」step 7：渲染按
  `asset_name` 匹配，`PointSampleBuilding.in_4`(BuildingAsset) 即写 `asset_name` 的口子，故 **BuildingAsset == PART C
  item_name == publishToGame.assetName**（assetType=object）三处同名，手动放的楼才会渲染成生成的整栋贴图，`topBillboard` 截图核对。
  *为什么：* 已核对两侧端口契约严丝合缝（见 2D 插件 PART C「C-阶段零 dechouse_gen」），让 sino 学会"生成输入 json → 生成贴图+碰撞 →
  用回场景"完整闭环（整栋 billboard 铺多格 footprint 属专属路径，首跑需截图验证）。
- **`TEMPLATES_INDEX.md` / `compose-sino-scene/SKILL.md` 增补"手动放置装饰性建筑"工作流。**
  说明坐标系（左上角 0,0 / x横 y纵）与 `manualPoint → PointSampleBuilding →（可选）ArchitectureStructures(z=1)`
  →（BuildingPath 经 `scene_focus_path` + `building_footprint_mask` + `grid_to_json` 取网格形状；
  BuildingPath `string_concat` 拼 `/outer_door` + `scene_focus_path` + `node_explode` 看 `voxels` 取门坐标）的全链。

### Fixed

- **共享沙箱资产发布后场景侧不再需要手动刷新页面。** 根因：`scene:library.useGameTextures`
  绑定沙箱 `textures/` 目录时，2D 应用的首次 `publishToGame` 往往还没创建该目录，于是
  `gameSandboxStore.startGameSandboxWatcher` 里的 `fs.watch(dir)` 抛 ENOENT 被静默吞掉，
  watcher 永远没挂上 → 之后每次发布都不广播 `library:changed` → 用户必须手动刷新才能看到
  导入/匹配结果。修复（`backend/src/library/gameSandboxStore.ts`）：① 挂 watcher 前先
  `mkdirSync(dir,{recursive:true})`，保证目录存在、watcher 必定挂上（它本就是 2D 端要写入的共享路径）；
  ② 增加 1.5s 轮询 index.json 的 mtime/size 作为**跨进程兜底**（2D 与场景是两个独立后端进程，
  `fs.watch` 跨进程/原子重命名写入本就不可靠），变更即广播 `library:changed`；fs.watch 与轮询经同一
  debounce + 广播时回填签名，避免重复刷新；轮询 `unref()` 不阻塞事件循环。*为什么：* 资产导入是
  AI 高频操作，少了热更新每次都要手刷，体验断裂。验证：`gameSandboxStore.test.ts` 新增「绑定早于目录存在」
  用例（模拟真实顺序）并通过，原用例仍过；`tsc --noEmit` 干净。
- **模板实例化保留组边界端口类型。** `backend/src/lib/templateOps.ts` 的 `remapContract`
  重建 createGroup 契约时补带 `portType`，与内核新约定（契约可携带、缺省回退派生）一致，
  避免 AI/模板实例化路径丢失用户设置的端口类型。

### Added

- **User-template save route + scan root ("Save to templates").**
  `backend/src/routes/groupTemplates.ts` gained `POST
  /api/v1/group-templates/save-user`, which writes the posted group to the
  workspace `.forgeax` area at `<workspaceRoot>/user-content/templates/My
  templates/<smallTag>/<templateName>.json` (FORGEAX_PROJECT_ROOT-derived, read
  at request time for test isolation). The user-template root is appended to the
  template scan roots (`getKinds()`/`templateRoots()`), so `GET
  /api/v1/group-templates` lists built-in + user templates uniformly under the
  fixed **"My templates"** big-label. `frontend/src/api/HttpApiClient.ts`
  implements `saveUserTemplate`. Test: `backend/tests/groupTemplates.test.ts`
  (save-user round-trip + 400 on empty smallTag). *Why:* let users persist their
  own reusable group templates as project-shared user content.

### Fixed

- **Screenshot capture WS auto-reconnect and longer default timeout.** `useScreenshotCapture.ts`
  reconnects with capped exponential backoff (aligned with wb-3d-lowpoly); agent route default
  timeout raised to 10s. `agent/routes.ts`, `useScreenshotCapture.test.tsx`.
- **AI tool handlers transparently recover project lock after backend restart.**
  `tool-handlers.ts` re-opens active project on `mutation-denied-not-open` and retries once.
- **Mutation routes forward `expectedPrevHash` and surface lock `code` on HTTP 403.**
  `mutations.ts`, `projects.ts`, `execute.ts`, `pipelineImport.ts`, `groupTemplates.ts`.

- **HttpApiClient WebSocket reconnect after drop (aligned with 3d/2d).** Exponential
  backoff 500ms→5s cap; renderer/assetstore live-sync survives backend restart without
  full page reload. Scope: `frontend/src/api/HttpApiClient.ts`.

### Added

- **Tile atlas dimension validation on publish (`autotileKind` binding).** When
  publishing a tile (`publishExternal` / shared sandbox path), PNG width×height is
  checked against `assets/rules/<autotileKind>.json` sprite bounds. `common_16`
  accepts **64×64** (no variant row) or **64×80** (with randomRules variants);
  other rules require the exact bounding box from the rule JSON. Mismatch → 400/422
  with `allowedSizes`. Files: `backend/src/library/tileRuleAtlasValidation.ts`,
  `privateStore.ts`; 2D `publish-to-game` mirrored; tests +
  `skills/texture-pipeline/SKILL.md` updated.

- **Shared-game-sandbox asset source — generated textures live in the sandbox,
  not an app-internal store, and are merged into the AssetStore view + renderer
  pool.** The two workbenches each run under an isolated `FORGEAX_PROJECT_ROOT`
  and cannot see each other's internal stores; the only cross-app common ground
  is the project's `.forgeax/games/<slug>/` sandbox. New flow: the 2D app
  publishes a finished texture into `<projectRoot>/.forgeax/games/<slug>/textures/`
  (`asset2d:publishToGame` → 2D `POST /api/v1/publish-to-game`, writing
  `blobs/<sha>.png` + a raw descriptor in `index.json`), and the scene workbench
  binds that dir as a READ-ONLY third asset source via
  `scene:library.useGameTextures` (→ `POST /api/v1/library/use-game-textures`).
  `library/gameSandboxStore.ts` composes the renderer's 13-bracket alias +
  autotile binding from the descriptor (reusing the new exported
  `composeRendererAlias` + `deriveAliasMeta`) and is merged into
  `/api/v1/library/{list,aliases-meta,serve}` alongside base ∪ private (sandbox
  records sort first, `private:true`). Binding broadcasts `library:changed` so
  the AssetStore + renderer re-pull. No app-internal store is written. Files:
  `backend/src/library/{gameSandboxStore.ts,routes.ts,privateRoutes.ts,privateStore.ts}`,
  `backend/src/tool-handlers.ts`, `forgeax-extension.json`,
  `skills/texture-pipeline/SKILL.md`; 2D side mirrored in `wb-2d-scene-asset-generator`.

### Changed

- **Texture hand-off no longer routes bytes through the agent — retires the
  base64/private-library path as the main flow.** Earlier iterations shuttled
  base64 (`scene:library.publishExternal({dataBase64})`) which auto-compaction
  dropped, causing publish retry loops; a server-to-server `from2dAlias` variant
  fixed the loop but still landed in the app-internal private store. Per the
  "files stay in the sandbox, separate from built-in assets" constraint, the
  main path is now the shared sandbox (see Added). `scene:library.publishExternal`
  is kept as a LEGACY fallback (manifest description flags it). `texture-pipeline`
  §4/§6 + Sino `lessons.md` rewritten to the `publishToGame` + `useGameTextures`
  flow.

### Fixed

- **Renderer matching pool now refreshes after a publish / project switch
  (textures applied without a manual reload).** `frontend/src/renderer/bridge/
  useAliasMetas.ts` previously fetched `/api/v1/library/aliases-meta?zone=raw`
  ONCE on mount, so a texture published via `scene:library.publishExternal`
  after the renderer mounted never matched onto voxels until a full reload, and
  switching the active project kept the stale pool. It now also opens `/ws` and
  re-pulls on `library:changed` (already broadcast by every library mutation
  incl. publish-external) and on project activation (`runtime`
  `project:activated` / `workbench:project-changed`), mirroring `useBakedLayers`.
  This was a primary cause of "the generated scene didn't show the texture
  applied".

### Added

- **`scene:library.list` AI tool — lets an agent SEE/verify the private library
  (incl. published textures).** Previously the only asset-listing tool exposed
  to AI was `scene:assets.list`, which proxies `/api/v1/assets` → the kernel
  AssetResolver over the shared **filesystem** `<workspaceRoot>/assets` dir, NOT
  the private library DB — so an agent could not confirm what
  `scene:library.publishExternal` landed (and `texture-pipeline` §6 told it to
  verify with the wrong tool). New tool proxies `/api/v1/library/list`
  (base ∪ active-project private, paginated, defaults to `zone=raw`).
  `texture-pipeline` §6 + Sino persona now verify publishes via
  `scene:library.list` and list the "texture not applied" diagnosis checklist
  (field4 == template `xxxAsset`; right active project; `asset_type=tile` →
  non-cutout pool; `raw` not `staging`). Files: `backend/src/tool-handlers.ts`,
  `forgeax-extension.json`, `skills/texture-pipeline/SKILL.md`,
  `agent-sino/persona/zh.md`. (`scene:assets.list`'s description now states it
  is filesystem-only.)

### Removed

- **Dropped the standalone `@forgeax-extension/agent-atlas` supervisor agent;
  folded the texture-pipeline capability into Sino instead.** Supersedes the
  Phase-3 "supervisor agent" entry below. Why: in testing, Atlas could not
  connect the scene graph correctly — its connection know-how lived only in the
  `compose-sino-scene` skill BODY, which (being a prompt-kind skill) is **not**
  auto-injected into context unless the skill is explicitly triggered; Atlas's
  always-on persona only covered texture orchestration. Sino, by contrast, works
  because its persona itself embeds every connection hard rule (`edgeId`, op
  schema, `in_0` wiring, PathConnection POI, `tree_merge` params). Rather than
  duplicate Sino's large skill into Atlas's persona (violating single-source /
  cleanliness), we delete Atlas and give Sino the 2D capability as an opt-in
  extension. Files removed: `packages/marketplace/extensions/agent-atlas/**`.

### Changed

- **`texture-pipeline` skill retargeted from Atlas → Sino's "freshly-generated
  textures" extension.** Frontmatter `audience`, intro, and §0.1 now address
  Sino; §0.1 keeps the "create a brand-new scene project every task" hard rule
  (`scene:projects.create` + `projects.open`, never reuse/modify the active
  graph; new id recorded in the contract `sceneProjectId`). A new top note makes
  explicit that the texture pipeline **does not change any graph-connection
  rule** — `edgeId` / op schema / `in_0` wiring / PathConnection POI /
  `tree_merge` params all defer to `/compose-sino-scene`; textures only swap the
  template `xxxAsset` from a built-in name to a contract semantic name and add
  generate→publish→verify steps.
- **Sino agent gains the 2D / texture capability (opt-in).**
  `agent-sino/forgeax-extension.json`: `tools` now `["scene:*","asset2d:*"]`;
  `defaultSkills` adds `texture-pipeline` + `generate-2d-asset`; `produces` adds
  the contract + generated-assets paths; description updated. `persona/zh.md`
  adds a clearly-scoped "扩展能力：现生成贴图（按需触发，默认不用）" section + a
  publish-bridge / asset2d tool listing, and carves the texture exception out of
  the "不画 2D" boundary. `memory/lessons.md` records the same as an additive
  capability. Pure composition tasks are unchanged (ignore the texture section).
- **Sino's persona/lessons now EMBED the 2D image-generation operational core
  (not just a skill reference).** Because `generate-2d-asset` is a prompt-kind
  skill whose body is only inlined on trigger, listing it in `defaultSkills`
  alone does not make Sino "know" how to generate — mirroring why Atlas couldn't
  connect graphs. So a distilled, always-injected "2D 生图操作核心" was added to
  `agent-sino/persona/zh.md` + `memory/lessons.md`: the three hard rules
  (op-ids/ports only from `batteries.list`; `image_gen` is manualTrigger so
  `generation.generateImage(nodeId)` once THEN `pipeline.execute`; `pipeline.get`
  after every `applyBatch`), type-driven constant batteries
  (`text_panel`/`number_const`/`toggle`), and the PART A (single/object,
  cutout) / PART B (tile atlas, tile-count = 4×(maskH÷cellW) aligned to the
  contract rule cell count) / PART C (shape-controlled house) battery chains.
  Full step-by-step sequences stay in `/generate-2d-asset` as the deep reference.

- **Texture pipeline — screenshot-vision test toggle
  (`FORGEAX_SCENE_SCREENSHOT_NO_VISION`).** New env flag (declared in
  `forgeax-extension.json::requestedEnv`, read in `backend/src/tool-handlers.ts`)
  that, when set (`1|true|yes|on`), makes `scene:screenshot.capture/latest`
  return the plain capture metadata (path + size + `visionDisabled:true`)
  **without** the `image_file` content part, so the agent never ingests the
  screenshot into its context. Default (unset) keeps vision ON (unchanged). Why:
  during texture-pipeline testing the user wants screenshot self-reading turned
  off so the agent verifies via `pipeline.execute` summaries + names projection
  while the human eyeballs the canvas. `texture-pipeline` §6 and Sino's
  persona/lessons document the off-path behaviour.

### Added

- **Texture pipeline Phase 3 — orchestration skill + supervisor agent.** New
  plugin skill `texture-pipeline` (`skills/texture-pipeline/SKILL.md`, registered
  in `forgeax-extension.json`) is the top-level conductor manual: it pins the naming
  contract carrier at `<active_game>.dir/texture-pipeline/contract.json` (a
  plugin-internal SSOT in the game workspace, since the two apps'
  `FORGEAX_PROJECT_ROOT`s are isolated), gives the 8-rule autotile alignment
  table (`floor_1`/`fence_7`/`slope_9`/`bridge_horizontal_9`/`flower_bed_11`/
  `bridge_vertical_15`/`common_16`/`wall_outer_16`, all ppu=16) tiles must match,
  the object cutout flow, the per-asset publish loop, and the `topBillboard`
  verification loop. Paired with a NEW agent plugin
  `@forgeax-extension/agent-atlas` (Atlas · map-texture supervisor) that wields BOTH
  `scene:*` and `asset2d:*` tool sets and discloses three skills on demand
  (`texture-pipeline` + `compose-sino-scene` + `generate-2d-asset`). Files:
  `skills/texture-pipeline/SKILL.md`, `forgeax-extension.json` (scene skill reg),
  `ARCHITECTURE.md`; new plugin under `packages/marketplace/extensions/agent-atlas/`.
- **Texture pipeline Phase 2 — scene-side publish bridge
  (`scene:library.publishExternal`).** New atomic, idempotent endpoint
  `POST /api/v1/library/publish-external` (+ tool + manifest tool/surface) that
  lands a 2D-generated PNG (base64) into the active scene project's private
  `raw` zone with a renderer-shaped alias in ONE call: composes the 13 bracket
  fields (field4=`assetName`, field8=type), binds a tile's autotile rule via
  `cropTypeOriginal='瓦片组'` + `assetKind=<rule>` (covers rules the field[8]
  legacy map can't, e.g. `slope_9`), marks objects as cutout (`抠图`), records
  `provenance` (`sourceBlobId`, `source='pipeline'`), and de-duplicates on
  re-publish (same `sourceBlobId` updates in place + GCs the stale blob). This
  is the single write entry-point the supervisor agent uses instead of
  hand-stitching import→repair→field-edit→move. Files: `library/privateStore.ts`
  (`publishExternalAsset` + `PublishExternalInput`), `library/privateRoutes.ts`,
  `tool-handlers.ts`, `forgeax-extension.json`; covered by
  `tests/library-publish-external.test.ts`.
- **Texture pipeline Phase 1 — renderer matching pool now merges private
  assets.** `GET /api/v1/library/aliases-meta` previously returned base-library
  aliases ONLY, so any imported / cross-app-published texture was invisible to
  the billboard renderer and could never be matched onto a voxel. The route now
  merges project-private records of the requested zone (mapped through the same
  `deriveAliasMeta` the base library uses, so a published tile binds to its
  autotile rule identically); a private record OVERRIDES a base one of the same
  alias (the user's asset wins). This is the foundational gap for the
  scene↔2D-asset texture-generation workflow — it lets a 2D-app-generated PNG,
  once published into the active scene project's private `raw` zone, enter the
  matching pool. `PrivateAssetRecord` gained optional `assetKind` /
  `cropTypeOriginal` / `geometryJson` / `sourceBlobId` fields so a published tile
  can carry an exact rule binding (`cropTypeOriginal='瓦片组'` + `assetKind=<rule>`,
  covering rules the field[8] legacy map can't, e.g. `slope_9`) and so
  re-publishing the same bytes stays idempotent. Files: `library/routes.ts`,
  `library/privateStore.ts`; covered by `tests/library-aliases-meta-merge.test.ts`.
- **AssetStore search-by-alias candidate dropdown (left pane).** Typing in the
  Basic Operations search box now opens a debounced list of current-zone alias
  candidates (thumbnail + alias + private badge) below the input
  (`AssetStorePanel.tsx`, `WorkbenchLeftPane.css`). Picking a candidate (click or
  ↑/↓ + Enter) fills the input and reveals that asset in the right-side grid —
  selecting it, jumping the continuous scroll to its page, and surfacing it in the
  left-pane Preview · Anchor · Collision section — **without** committing a
  grid-filtering search, so the rest of the grid stays put. Wired via a new
  `left → surface` reveal command on the localStorage control bus
  (`assetControlBus.ts` `requestReveal`/`subscribeReveal`) plus a `revealAlias`
  store action (`assetStoreStore.ts`) consumed by `AssetStoreSurface.tsx`.
  *Why:* the search box gave no feedback while typing; users had to scroll the
  grid manually to find a known alias.

### Changed

- **Scene export now reproduces the editor billboard render under the shipped
  viewer's own algorithm (render→export parity).** The cook no longer re-derives
  rules on a second code path — it routes terrain/object resolution through the
  renderer's shared resolvers (`pickFaceSpriteIndex` / `computeValidVariantIdxs` /
  `variantCandidates` / `compareBillboardDrawOrder`). Terrain converged per-cell:
  **per-layer** (not unioned) autotile neighbour keys, **sheet-aware `template_id`**
  so two same-named layers on different sheets don't collide variant filters, and
  region-gated wall variants (incl. gated-out door footprints). The cook still shifts
  the scene to a non-negative origin (the viewer's `cols×rows` grid can't store
  negative billboard coords) while the editor keeps raw coords — both internally
  correct, intentionally not aligned. See
  [`docs/scene-export-parity.md`](./docs/scene-export-parity.md) and the
  `backend/tests/scene-export-{renderer-parity,cooker}.test.ts` locks.
  (`9119b05`, `087cfdb`, `36b3a1d`). *Why:* a billboard 2D consumer must get the
  editor's exact image, and a parallel rule path inevitably drifts from the renderer.

- **Left-pane typography unified on the section-title style.** Projects header,
  New-project / Save-scene modal headings, the panel tabs (AssetStore / Preview /
  Scene Gen) and the group tabs are a full transplant of the computed "Node Info"
  heading (16px / weight 400 / 0.04em / uppercase / accent green). Panel tabs
  share the row width (grow from each label's width, centred, no wrap; the panel
  tabs drop to 12px + tight padding so all three fit one narrow line without
  truncation); the hero title drops its
  vertical `scaleY` stretch and gets a roomier line box so descenders (the "g")
  aren't clipped, and the hero is layered above neighbours. Body copy across the
  pane (Node Info, Data Types, History, Help, hints) is enlarged proportionally so
  relative sizes are preserved — Data Types reads name 15px > desc 12px, and the
  History toolbar (step count / Clear) plus entry timestamps sit at 12px, and the
  New-project wizard field labels (Name / Description / Template) are bumped to
  14px (`WorkbenchLeftPane.css`). *Why:* consistent heading
  identity and readable body text; the first pass approximated the title (smaller +
  bolder) and flattened the Data Types name/desc ratio.

- **Node Info stats are a responsive grid + centred empty hint.** Added a sixth
  tally (Selected: 0/1) and laid the stats out as an auto-fit grid that fills the
  width and reflows from 3-per-row to 2-per-row when cramped. The "click a battery"
  prompt now centres in the section, and the section's scrollbar chrome is hidden
  while keeping scroll (`SceneGeneratorControlsPanel.tsx`, `WorkbenchLeftPane.css`).
  *Why:* even, readable tallies and a tidy empty state without a stray scrollbar.

- **Scene Generator Help rewritten as short titled blocks.** Replaced the single
  paragraph with concise, compact titled sections (Build a scene / Inspect & edit /
  Preview & assets / Projects) carrying step-by-step guidance, EN + 中文. Titles
  are plain white (no accent, no bold, no divider) for a dense skim
  (`SceneGeneratorControlsPanel.tsx`, `WorkbenchLeftPane.css`). *Why:* the prior
  blob was hard to scan; titled steps are easier to follow.

- **AssetStore initial width decoupled from the editor battery bar.**
  `WorkbenchHost.tsx` renamed `BATTERY_BAR_WIDTH_DEFAULT` → `ASSETSTORE_WIDTH_DEFAULT`
  (now 290px) and dropped the "right edges on one vertical line" coupling.
  *Why:* the two panes are independent; tying AssetStore's default to the
  battery bar was an unnecessary cross-component constraint.

- **Merged `origin/main` into `dev`.** Integrates GitHub main-line preview inspector,
  placement projection, AI wire unwrap, and the 2d scene asset app with dev-only
  AssetStore private-library / left-pane work. *Why:* internal `dev` must track
  `main` without dropping in-flight generator features.

### Fixed

- **Dragging a layer to the very bottom now works (it no longer silently snaps
  back).** With siblings `layer 2, layer, layer`, no drag could move `layer` to the
  last position — you could only cycle between a few upper arrangements. Root
  cause: the drop translates "drag below the last row" into a move with
  `beforeName` omitted (= append last), but `moveBakedLayer` only ran
  `reorderSiblings` *when `beforeName` was set*. With it absent the moved node was
  pruned and re-inserted carrying its **stale `__order`**, so the reorder was
  skipped entirely and the displayed order never changed. Fix: `moveBakedLayer`
  now reorders **unconditionally** — `beforeName` set → just ahead of that
  sibling, omitted → appended last — and seeds the new order from the **current
  display sequence** (sorted by `__order`, via a shared `displayOrderedChildNames`)
  rather than the physical name-sorted array, so moving one node preserves the
  others' established order. Regression: `backend/tests/baked.test.ts` "move
  without beforeName appends the node last (drag-to-bottom)" (drags the middle of
  three to the bottom and asserts it ends up truly last).
  (`backend/src/baked/store.ts`).

- **Box-select now places objects (it no longer silently no-ops on object
  assets).** With an object asset selected and the Box brush active, dragging a
  rectangle did nothing — object placement existed only on the free-brush path
  (`paintAt`), while the box path (`commitBoxToKey`) hit an early
  `if (asset.type === 'object') return`. Fix: box-select on an object asset now
  **batch-places instances tiled across the dragged rectangle**, stepping by the
  object's footprint so neighbours sit edge-to-edge and skipping any cell already
  occupied (no overlap/clobber) — the most intuitive "stamp objects across where I
  dragged" behaviour. The single-placement math (footprint + column height +
  bottom-center snap + instance cells) is now a shared pure helper
  `resolveObjectPlacement` reused by both the free brush and the box fill, so the
  two paths can't drift. Regression: `renderer/framework/geometry/__tests__/objectPlacement.test.ts`
  (`resolveObjectPlacement` shape + a non-overlapping tiling-stride lock).
  (`renderer/host/RenderCanvas.tsx`, `renderer/framework/geometry/objectPlacement.ts`).

- **"+ Layer" no longer clobbers an existing layer; corrupted baked trees self-heal
  on load.** Clicking "+ Layer" could silently overwrite a populated layer (e.g. a
  913-cell layer collapsed into a fresh empty one). Root cause: a layered invariant
  break. The vendored scene tree (`vendor/shared/types/scene/tree.ts`) keeps each
  node's `children` array **strictly name-sorted** and relies on that for its
  `readNode` / `upsertCells` **binary search**. But the baked store overloaded
  *array order* and *`version`* to also encode the panel's *display order* — its
  `reorderSiblings` / `withChildren` reshuffled the children array (and renumbered
  versions) on every drag-reorder / bake, destroying the name-sorted invariant.
  Once the array was out of order, `findChildIdx`'s binary search could miss an
  existing same-name node, so `addBakedLayer`'s dedup (`uniqueChildPath` →
  `readNode('/Layer')`) reported "no collision" and `upsertCells` inserted a
  **second** `/Layer`; the frontend `buildPathTree` then mapped both to the same
  `pathKey`, the empty one winning → the populated layer "disappeared". Verified on
  the live corrupted project: stored top children were
  `["Layer","Layer 2","Layer","Layer 3","Layer 4"]` (two `Layer`s, not name-sorted).
  Fix (single source of truth, decoupled order): display order now lives in an
  explicit reserved `__order` attribute (`BAKED_ORDER_ATTR`), never in array order
  or version. `reorderSiblings` / `bakeLayers` / `addBakedLayer` / `ensurePaintTarget`
  stamp `__order` via `setAttribute` (which preserves the name-sorted array), and
  `projectBaked` sorts by `__order` (falling back to legacy `version`, then name for
  smooth migration). `version` reverts to its sole meaning — a content fingerprint
  for the renderer's dirty-check / incremental-bake contract. `withChildren` (the
  invariant-breaking array rewriter) and the now-unused `uniqueChildPath` are
  removed; `addBakedLayer` dedup gains a linear-name-scan defense
  (`uniqueChildPathSafe`). `load()` heals legacy data: it re-sorts every node's
  children by name and merges duplicate same-name siblings (keeping the richest —
  most cells, then bound asset, then highest version) while pinning the pre-merge
  display order onto `__order`; the existing corrupted project files were migrated
  in place (`*.pre-heal.bak` kept). Regression locks: `backend/tests/baked.heal.test.ts`
  (reproduces the exact on-disk corruption → asserts single merged node, preserved
  order, and that repeated "+ Layer" clicks each append a distinct node — proven to
  fail without the heal). All `backend/tests/baked.test.ts` (30) still pass.
  (`backend/src/baked/store.ts`). *Why:* sibling order and node identity must not
  share a storage channel with a structure (the sorted array / the content version)
  that another layer depends on — overloading it silently corrupted lookups.

- **Structural editable-layer changes (add / auto-sub-layer / drag-reorder /
  reparent / delete / bake / rename) now appear immediately instead of needing a
  manual reload.** Placing an object that auto-creates a sub-layer, or dragging a
  layer to a new order, often did nothing visible until refresh. Root cause: every
  structural op pulled the new backend structure with the *default*
  `refreshBakedLayers()`, which `deferIfLocalPending`-defers while ANY local paint
  edit is still dirty/persisting (the paint-protection that stops a refresh
  clobbering an in-flight stroke). A paint right before the structural op (the
  place-object → auto-sub-layer flow always has one) leaves that flag set, so the
  structural refresh was silently deferred — and its deferred replay only fires
  from a *paint* persist's settle path, which may never come, so the new layer /
  new order stayed invisible until a reload. The backend (authoritative for tree
  shape + sibling order) had already applied the change; only the frontend pull
  was lost. Fix: structural ops now **drain in-flight paint persists first, then
  force the refresh in** (`deferIfLocalPending:false`) via a shared
  `structuralBakedRefresh` helper (`surfaces/RendererSurface.tsx`); `RenderCanvas`
  publishes its `awaitPaintPersists` drain primitive through a new
  `paintPersistsRef` so the surface can flush+await without owning the paint
  pipeline. Paint-commit refresh (`handleBakedEditCommitted`) keeps the deferring
  default — only *structural* refreshes force. New locks in
  `renderer/bridge/__tests__/useBakedLayers.test.tsx`: a default refresh is still
  deferred while paint is dirty (the old "must reload" behavior), while a forced
  refresh lands the new structure (e.g. a new `/Layer/layer-1`) immediately.
  *Why:* a structural change must never collide with paint protection, and the
  panel must reflect the one authoritative backend tree without a second,
  manually-triggered sync.

- **Painting while the canvas pans/zooms no longer makes the in-progress stroke
  vanish until a refresh.** Drawing to the edge (auto/middle-button pan) or
  wheel-zooming mid-stroke would wipe everything just painted; the cells were
  safely in the store but the screen dropped them. Root cause was a *second*
  render source of truth for the baked master: an additive paint advances
  `masterRef.current` in place (a fresh master — often a grown NEW canvas) via
  `appendCellsToVoxelMaster` and deliberately does **not** bump `structuralKey`
  (so `useLayerSurface` doesn't re-bake — the O(k) draw contract), leaving the
  React-state `voxelMaster` stale. A viewport change then re-rendered and the
  full `composeFrame` redrew from that **stale** state master (old canvas/bbox),
  repainting the new cells away; only a later op that bumped `rebuildEpoch`
  ("refresh") let state catch up. Fixed by converging the render master to the
  single authoritative `masterRef.current`: `compose` now draws `masterRef`'s
  live master, and `maxRows/maxCols` are derived inline from `masterRef.current.bbox`
  each render (a ref read can't go through `useMemo`) instead of the stale
  `voxelMaster` memo (`modes/topBillboard/index.tsx`). The state `voxelMaster`
  (`useLayerSurface`) is now used only to *feed* the authoritative ref on a real
  structural rebuild, not as a parallel draw source — removing the data
  duplication that caused the desync. New lock:
  `modes/topBillboard/__tests__/billboard.paint.pan.test.tsx` paints an
  out-of-bbox cell (incremental grow → new master) then `panViewport2d`s and
  asserts the resulting full compose draws a master whose bbox spans the painted
  cell, with **no** new `buildVoxelMaster` call. *Why:* both performance
  contracts had to hold — "viewport changes only re-send the frame, never rebuild
  the surface" and "drawing is O(k) incremental, not O(N) re-bake" — so the fix
  changes only *which* master `composeFrame` reads (still one `drawImage`),
  never the bake path.


  `POST /api/v1/execute`, and the dropped group keeps its custom name.** The
  execute route (`backend/src/routes/execute.ts:13`) returns `handle.done`
  directly, so a rejected execution promise became an opaque 500 (this app runs
  Fastify with `logger:false` at `backend/src/main.ts:19`, swallowing the stack).
  The reject came from a drop-then-execute *race* in the editor: the dropped
  group's execute fired in the same tick as its `createGroup` persist, reaching
  the backend before the node existed, so the kernel's `buildExecutionClosure`
  threw `target node not found`. Fixed in the kernel (execute now resolves a
  structured `status:'error'` result instead of throwing — see root
  [`CHANGELOG.md`](../../CHANGELOG.md)) and in the editor drop path (execute now
  chains off the persist commit). New lock:
  `backend/tests/bridge.test.ts` asserts `POST /api/v1/execute` with an unknown
  `nodeId` returns `200` + `status:'error'` rather than a bare 500. *Why:* a
  client/timing input error must not present as a server fault, and the dropped
  group must round-trip its custom name.

- **Group-battery save no longer 500s on a malformed body
  (`POST /api/v1/group-templates/save`).** The save handler
  (`backend/src/routes/groupTemplates.ts:181`) had no input validation or error
  handling, so any request missing `group`/`categoryName`/`batteryName` — or
  carrying a non-string name — threw a raw `TypeError`
  (`safeName(undefined).trim` → `Cannot read properties of undefined (reading
  'trim')` at `groupTemplates.ts:101`; `req.body.group.nameEn` → `...reading
  'nameEn'` at `groupTemplates.ts:190`) which Fastify surfaced as an opaque
  **500** (the app runs `logger:false`, so the real stack was invisible). Now:
  `safeName` tolerates non-string input (`groupTemplates.ts:100`); the handler
  validates the body up front and returns a clear **400** with the offending
  field instead of a 500 (`groupTemplates.ts:183`); and the `mkdir`/`writeFile`
  are wrapped in try/catch that `log.error`s the real cause and returns a
  structured **500** carrying the message (`groupTemplates.ts:201`). The save
  still writes to `batteries/groups/<cat>/<name>/<name>.json` (unchanged落点
  semantics). Covered by `backend/tests/groupTemplates.test.ts` (200 happy path +
  three 400 validation paths). *Why:* users hit `Error:
  /api/v1/group-templates/save → 500` with no actionable message; a malformed or
  edge-case payload silently crashed the handler.

  defects fixed so the shipped (unmodified) viewer seats objects like the editor
  bake. (1) **Placement** — objects anchor via the renderer's `chooseObjectAnchor`
  (columnDz ASC, footprintDy DESC, x ASC = front row) at `(x,y)=(anchor.x,
  anchor.y−anchor.z)`, and the tsj `pivot` is emitted as the alias's **already-
  normalized** anchor fraction; `atlas.ts` previously divided that fraction by the
  tile px again, double-normalizing it and sliding multi-cell sprites (the ambulance
  "sprawl") off their cell (`e57ae13`, `a1415ad`). (2) **Occlusion** — the viewer
  paints all `objects[]` last (no per-object depth, `obj.height` unused at draw time),
  so objects could never be occluded by terrain. PPU=16 objects are now encoded as
  **elevation-keyed terrain-stack tiles** (carrier template `obj__<type>` registered
  into the terrain atlas, pushed onto the anchor cell at its footprint elevation), so
  the viewer's elevation-ascending terrain paint lets higher walls overdraw them —
  reproducing IMAGE-2-style occlusion with **no viewer change**. Coarse per-object
  (not per-pixel-sliced); PPU≠16 objects keep the legacy `objects[]` path
  (`f550e24`). See [`docs/scene-export-parity.md`](./docs/scene-export-parity.md).
  *Why:* the exported bundle must match the renderer's billboard output, including
  the multi-voxel footprint and terrain↔object occlusion.

- **Node Info "Selected" stat now reflects the real selection count.** The
  stat read the single mirrored `selectedNode` (so it was 0 or 1, and 0 for a
  marquee of ≥2). It now uses the new `stats.selectedCount` from the editor
  mirror (`SceneGeneratorControlsPanel.tsx`, `NodeInfoPanel`), so a multi-node
  marquee shows the true count. *Why:* the previous single-node source could
  never represent multi-selection.
- **Left-pane section titles: hover layout shift + drag resize cursor drift.** Draggable
  titles keep stable margin/padding in and out of `:hover`. During a drag the panel locks
  `minHeight` to its start size; height deltas cascade into sections above when the direct
  target hits its minimum (`applySectionDragDelta` + `usePanelDragMinHeight` in
  `sectionDragResize.ts`) so handles track the pointer without sticking at one boundary.
  *Why:* hover-only padding and drag math regressed after the shared `controlSections`
  chrome landed.

### Changed

- **AssetStore left pane: five English sections with Scene Generator chrome.** Menus
  are reorganized into Basic Operations (search, import, repair, batch), Asset
  Preview · Anchor · Collision, Filters, Library Info, and a dedicated Help (separate
  from Scene Generator). `AssetStorePanel.tsx` uses `editor-controls-panel` with
  shared `controlSections.tsx` (drag heights, collapse triangles, persisted state);
  `WorkbenchLeftPane` wraps the panel in `scene-left-pane__section--controls`; CSS
  aligns accent tokens with the generator panel. Private assets can PATCH
  `alias` / `anchorX` / `anchorY` via `privateStore` + `privateRoutes`. *Why:* match
  the Scene Generator UX and group related asset-library actions in one place.

### Added

- **Scene export cooker for baked workbench layers.** The backend can now cook
  the active project's baked scene into a reference-style `scene.zip` plus an
  unpacked mirror under `exports/scene/<bundleId>/`, with terrain/object JSON,
  atlas metadata, a static viewer bundle, and edit-mode attribute templates for
  export metadata. *Why:* billboard 2D engine consumers need a self-contained
  bundle that reflects the Preview baked-layer scene.
- **AssetStore left-pane menus + a writable project-private asset library.** The
  AssetStore group of the left nav (`frontend/src/workbench/AssetStorePanel.tsx`)
  gains six menus: 搜索, 过滤标签 (13-field, ported from the legacy CategoryNav),
  资产操作 (本地导入 + 资产修复), 批量操作 (移入回收站/恢复/永久删除 over the grid's
  selection), 资产预览 (缩略图 + 可编辑别名 + 单项操作), 资产库信息 (merged monitor).
  Because the shipped `library.db` is read-only, user imports/edits live in a new
  per-project store `backend/src/library/privateStore.ts`
  (`<activeProject>/private-assets/{index.json,blobs/}`); `privateRoutes.ts` adds
  `/api/v1/library/{import,private/*,monitor,field-values}`, and `routes.ts`
  merges private records into `/list`,`/zones`,`/facets`,`/serve` flagged
  `private:true` (grid badges them「私」). Left pane ↔ grid (sibling iframes) sync
  over `frontend/src/surfaces/library/assetControlBus.ts` (control / selection /
  refresh). Tests: `backend/tests/privateLibrary.test.ts`,
  `frontend/src/surfaces/library/__tests__/assetControlBus.test.ts`. *Why:* the
  new generator pane had a read-only AssetStore with no left menu, so users could
  not import their own art, fix non-standard names, bulk-clean, or inspect library
  stats the way the legacy AssetStore allowed.

- **Placement projection feedback for Billboard edit mode.** The Preview now treats
  the cursor as the target voxel's front/bottom face, highlights the actual target
  face, shows the nearest lower top-face projection (or a ground fallback), and
  connects the two with a dashed arrow. The Selected Layer inspector also has
  stronger visual grouping plus matched-asset thumbnails/fallback states. *Why:*
  authors need to see both where the voxel will be placed and what it is aligned
  above.
- **Preview panel inspector redesign.** The left Preview group now splits permanently
  into **Edit tools** (mode-aware: Z layer only in Billboard + Asset edit mode) and
  **Selected layer** (scene node summary, voxel ranges, read-only reserved attributes,
  editable custom attributes on baked layers, seed template apply). The renderer publishes
  multi-selection snapshots via `selectedLayerBus.ts`; baked custom attrs persist through
  `PATCH /api/v1/baked/layers/attributes`. *Why:* authors need full layer metadata and
  batch attribute tooling without leaving the workbench.
- **Asset mismatch confirmation for Preview edit mode.** Painting an asset onto
  an editable layer already bound to a different asset now opens a renderer-pane
  dialog showing the current layer asset and the target paint asset, lets the
  user name a new child layer, then selects that layer and continues the first
  stroke. *Why:* automatic sub-layer routing could stall the first paint and made
  layer ownership unclear.
- **Collapsible editable/output layer trees and selected-layer asset highlight.**
  Both Layers-panel sections now render a shared path tree with carets on parents
  that are real layers, and the Asset Store highlights the asset bound to the
  active editable layer. *Why:* large scenes need navigable layer hierarchy and a
  visible link between selected layer and source asset.
- **Z-layer editing for Preview edit mode.** The left pane's Preview edit tools
  now publish an integer **Z Layer** via `frontend/src/surfaces/library/editToolbarBus.ts`,
  mirrored into `frontend/src/renderer/store.ts`; `RenderCanvas` passes that z to
  the active renderer plugin's edit mapping before writing baked cells. *Why:*
  hand-editing should support authoring voxels at multiple heights, not only the
  former hard-coded z=0 plane.
- **Asset Store folder taxonomies — browse a flat zone as nested folders.** The
  store previously piled a whole zone into one continuous scroll grid; assets now
  bucket into folders by any of 5 schemes derived from the alias's bracket fields
  (`[f0]…[f12]`): **类型** (f8: 抠图/tilemap/forest/…), **场所** (two-level: f1
  室内/室外 → f3 房间), **风格** (f6), **尺寸** (f9), **适用场景** (f0, a `-`-joined
  multi-value tag list → overlapping folders). Backend adds
  `GET /api/v1/library/facets?zone=&by=&parent=` (`listFacets` groups in JS for
  multi-value + 4-sample covers) and extends `/library/list` with `by/value/parent`
  filters (`facetClause`, reusing the `bracket_value` SQLite UDF; scene matches
  whole dash-delimited tokens via `'-'||f0||'-' LIKE '%-tok-%'`). Frontend gains a
  「分类方式」titlebar dropdown, a breadcrumb, and Windows-explorer-style folder
  cards that peek up to 4 thumbnails inside. `taxonomy: null` keeps the legacy flat
  behaviour (zero regression). See `backend/src/library/{service,routes}.ts`,
  `frontend/src/surfaces/library/{libraryApi,assetStoreStore}.ts`,
  `frontend/src/surfaces/AssetStoreSurface.{tsx,css}`, with tests in
  `backend/tests/library.test.ts` and `frontend/src/surfaces/library/__tests__/
  assetStoreStore.test.ts`. *Why:* with thousands of look-alike pixel assets in one
  zone, a flat 600+-page scroll made finding anything by type/room/style hopeless.

- **"Node Info" panel above History in the Scene Generator controls.** A new top
  section shows whole-canvas tallies as plain inline text (batteries /
  connections / annotations / groups / frames) and, when a battery is clicked on
  the canvas, a faithful miniature of its node: the accent-green card with its
  title, input ports on the left edge and output ports on the right edge, each
  connected port drawing a short colour-typed wire out into the gutter to plain
  text naming the peer node + port (upstream for inputs, downstream for outputs).
  No boxes or icons around the peers — text only. Fed by the editor sync bridge's
  new `stats` / `selectedNode` snapshot fields (cross-iframe, so the side pane
  needs no pipeline store of its own); port dots use `getPortTypeColor` with the
  pane's `scenePortTypes`. The section is collapsible and its height drag-resizes
  (cascading into the sections below). See
  `apps/wb-scene-generator/frontend/src/workbench/SceneGeneratorControlsPanel.tsx`
  (`NodeInfoPanel` / `SelectedBatteryDiagram` / `PortRow`) and the `.scene-node-info*`
  / `.ni-*` styles in `WorkbenchLeftPane.css`. *Why:* users had no at-a-glance
  read of canvas composition, and inspecting a node's wiring meant tracing edges
  on the canvas.

- **Brush tools for edit mode: free brush + box-select, with per-asset
  sub-layer routing and a translucent ghost preview.** The left pane's Edit tools
  gains a **Free brush / Box select** toggle (crosses panes via the new
  `brushMode` channel on `editToolbarBus`). Painting routes by asset: an asset
  matching the active layer (or an empty layer) writes into it; a *different*
  asset auto-creates/reuses a `layer-n` **sub-layer** bound to that asset
  (backend `ensurePaintTarget` + `POST /api/v1/baked/target`; the renderer
  resolves the target synchronously when it can, else creates on first stroke).
  A dedicated overlay canvas (`mode-top-billboard-overlay`) draws a **half-opaque
  sprite** at the hovered cell (tile → its rule's base sprite, object → the whole
  image) and a rubber-band rectangle while box-selecting. **tile vs object** is
  derived from the alias's `tileType` in `aliasMetas`: a rule-bearing tile binds
  `asset_type='tile'` (autotile auto-applies via the existing render pipeline); a
  rule-less prop binds `asset_type='object'` (plain placement). Box-select fills
  every cell in the rectangle for both. *Why:* edit mode could only free-paint a
  single asset per layer; real authoring needs multi-asset layers, area fills,
  and a live preview of what you're about to drop.
- **Preview "edit mode" + a second, graph-independent "baked scene-layer"
  service.** Two independent logics now meet only in the preview canvas
  (visualisation) and at the Bake snapshot — mirroring Rhino's GH-preview vs
  bake-to-document model. *Why:* the node editor's output is a live, recomputed
  *preview* (not hand-editable); users needed real, persistent, hand-editable
  layers.
  - **New backend service** `backend/src/baked/` (`store.ts` + `routes.ts`,
    registered in `main.ts`). Persists a scene-tree JSON (`baked-scene.json`) in
    the **active project's folder** — resolved via the new `getActiveProjectDir()`
    in `runtime.ts` (handles the legacy `main` project) — completely separate
    from `state/graph.json`. Reuses the SAME vendored tree helpers + voxel
    projection the `scene_output` battery uses (`upsertCells` / `setAttribute` /
    `upsertSubtree`; ambient-typed via `baked/vendorScene.d.ts` since the dist
    bundle ships no `.d.ts`), so baked layers render identically to graph layers.
    Routes: `GET/POST /baked/layers`, `POST /baked/sublayer`,
    `PATCH /baked/layers/cells`, `PATCH /baked/move`, `DELETE /baked/layers`,
    `POST /baked/bake`; each broadcasts + logs `[baked] …`.
  - **Renderer** gains a `bakedLayers` store bucket (key `baked:<nodePath>`),
    fed by `useBakedLayers` from the new service. The graph-refresh GC
    (`retainVoxelNodes`/`retainPreviewLayers`) never touches it, so **baking does
    not remove the original Output layer — the two coexist as independent
    layers.** The billboard+asset pipeline renders both buckets through one
    master bake.
  - **Edit mode toggle** (✎, gated to Billboard view + Asset draw mode): paint
    with the AssetStore-selected tile directly on the canvas at **z=0**
    (`screenToEditCellZ0`), optimistic local update + debounced persist. Selected
    paint tile crosses panes via `paintAssetBus` (localStorage + `storage`).
  - **Layers panel split into Editable vs Output.** Editable layers support
    multi-select (click / ⌘-ctrl-toggle / shift-range), **drag-to-reorder** and
    **drag-to-reparent** (drop on a row's top/bottom edge = reorder, middle =
    nest as child; backed by `PATCH /baked/move`), `+ Layer`, `+ Sub`, and batch
    **Delete (N)**. Selected-layer detail is published to the left pane's Preview
    tab via `selectedLayerBus`.
- **"Rules" pseudo-zone in the AssetStore + rule detail in the left pane.**
  Tilemap stitching (autotile) rules — vendored JSON under `assets/rules/` and
  previously only reachable indirectly via a tile's `tileType` — are now a
  browsable category. New backend `GET /api/v1/library/rules` (normalises v1/v2
  rule schema into one `RuleListItem`); the AssetStore zone dropdown gains a
  **Rules** entry rendering metadata cards; selecting one shows its detail
  (schema/ppu/sprites/faces/regions) under the left pane's AssetStore group via
  `rulesApi`'s cross-pane bus. *Why:* rules were invisible in the UI.
- **Edit toolbar in the left pane's Preview tab (collapsed unless editing).** A
  new `editToolbarBus` (localStorage + `storage`, same pattern as the other
  cross-pane buses) carries two facts in opposite directions: the renderer pane
  publishes `editMode` (it owns the ✎ toggle) so the toolbar only expands while
  editing; the toolbar publishes `showGrid` back, mirrored into the render store.
  First tool: **Show grid lines** — an *infinite*, viewport-spanning alignment
  grid (`compose.ts` `drawInfiniteGrid`, cell-aligned to the same origin as the
  content and the coordinate readout, with the col-0/row-0 axes emphasised; it
  bails out when cells get sub-4px to avoid a dense smear). Drawn **last**, so it
  overlays every layer as a guide rather than being hidden behind content.
  *Why:* edit mode needed an alignment aid, and the toolbar gives later edit
  tools a home.

### Fixed

- **Editable layer drag-reorder now stays in the order returned by the baked
  layer service.** The shared path-tree helper no longer alphabetically sorts
  siblings after refresh. *Why:* the backend persists drag order via layer
  versions, and the frontend must not overwrite that order while rendering the
  collapsible tree.
- **The first stroke no longer disappears when changing assets.** Asset mismatch
  no longer calls the async auto-target route from the pointer path; the stroke
  waits for user confirmation and then paints into the newly selected child layer.
  *Why:* first-paint behavior must be deterministic even when a new asset layer is
  needed.
- **Preview object placement no longer lands one billboard cell above the cursor.**
  `frontend/src/renderer/framework/geometry/topBillboard.ts` now defines the edit
  conversion from selected top-face cell + z to voxel coordinates, and object
  sprites anchor to the footprint/front face in
  `modes/topBillboard/buildVoxelMaster/paintCell.ts`. *Why:* the ghost preview
  used the intended cell, but actual object rendering used the raised top face
  (`y - z - 1`), producing a one-row upward offset at z=0.
- **Painting produced nothing visible.** Two causes: (1) the AssetStore published
  the *full alias* as the paint `name`, but the renderer's `matchAssetEntry`
  (fuzzy=false) keys layers by the alias's item-name field — so no asset ever
  matched and asset-mode `paintCell` skip-renders unmatched cells; (2) the
  optimistic store update added cells but never bound the layer's `asset_name`,
  so the sprite couldn't resolve until a backend round-trip. Now the AssetStore
  publishes `name = aliasItemName(alias)` (field 4) and the paint flow
  optimistically binds `asset_name`/`asset_type` on the target layer
  (`bindBakedLayerAsset`), so strokes render immediately.

### Changed

- **Asset Store folder view honours the List view mode.** Picking a taxonomy
  (e.g. By Scene) previously forced a folder grid and ignored the View toggle;
  folders now render as wide list rows in `list` mode — left cover thumbnail,
  folder name + count on top, a sampled content preview below — while `grid`
  keeps the explorer-style cards. See `AssetStoreSurface.tsx`/`.css`
  (`FolderRow`, `.folder-row`).

- **Asset Store taxonomy selector: English, icon-only trigger, per-scheme
  icons.** The "分类方式" dropdown is now English; the titlebar trigger keeps only
  its icon (no inline label) and that icon reflects the active scheme, and each
  scheme renders as icon + label without the explanatory hint (All, By
  Type/Place/Style/Size/Scene), mirroring the View dropdown. New glyphs in
  `library/icons.tsx`; wired in `AssetStoreSurface.tsx`/`.css`.

- **Node Info miniature: English labels in EN mode, live port values, no
  sideways scrollbar.** The selected-battery diagram now honours `langMode` —
  title uses the battery's `nameEn` (falling back to an id-derived label) and
  port rows use the English port name — and each port's lead-out shows its
  *current value* (formatted host-side) instead of the connected peer's
  node/port. The connection wire is drawn **only for actually-connected ports**,
  so unconnected ports with a default value no longer look wired; unconnected
  ports show their value too (kernel falls back to the catalog default). The
  wire's slot is always reserved (painted only when connected) so wired and
  unwired values line up. The layout is **adaptive**: the node card grows to use
  the pane width (gutters bounded to ~26%), each value box fills its gutter, and
  rows grow to fit via a measuring layout effect + `ResizeObserver`. Values
  render as a **kind label + value on two lines** (`grid` / `979×979`, `Value` /
  the number), and **port names wrap at word boundaries** (zero-width breaks at
  camelCase, e.g. `mainRoad​Grid`) instead of truncating. See
  `frontend/src/workbench/SceneGeneratorControlsPanel.tsx` +
  `WorkbenchLeftPane.css`, backed by the kernel `SelectedNodeView`/
  `SelectedPortView` fields below.

- **Preview left tab now uses the Scene Generator controls-panel layout.**
  Edit tools, Selected layer, and Help render as collapsible, resizable sections
  with their own persisted layout state. *Why:* Preview and Scene Generator share
  the same left-pane shell, so their controls should feel like one UI system.
- **Preview edit mode no longer auto-creates asset-mismatch sub-layers.**
  `RenderCanvas` now paints only into an empty/same-asset active layer, or waits
  for `RendererSurface` to confirm a named child layer. *Why:* one editable layer
  should have one clear asset binding, and the user should choose when a new
  asset layer is introduced.
- **Editable baked layers now render through every Preview renderer mode.**
  `frontend/src/renderer/framework/layerKeys.ts` centralises output+editable key
  ordering, and top / billboard / iso / free3d consume the same buckets instead
  of leaving baked layers billboard-only. *Why:* the editable scene tree is shared
  scene-layer data; only the current editing interaction is billboard-specific.
- **Preview Layers panel sections are resizable.**
  `frontend/src/surfaces/RendererSurface.tsx` adds an accessible splitter between
  Editable and Output, replacing the fixed 180px editable-list cap in
  `RendererSurface.css`. *Why:* users need to freely allocate space between
  authoring layers and live output layers.
- **Open / Save relocated into the Projects panel; Save dialog restyled to match
  the pane.** The standalone left-pane Open/Save row is gone. **Open** is now a
  compact icon button immediately right of the Projects "+" glyph (`ProjectPanel`
  `headerActions` slot): it
  imports a JSON as a *brand-new project named after the file* (wrapper `name`,
  else filename sans extension) and opens it via `createProject` → inline import,
  instead of replacing whatever project was open. **Save** is now a per-project
  action button on each project card (`ProjectPanel` `renderProjectActions` slot
  → `ProjectCard` `extraActions`); it activates the target project if needed so
  `getPipeline()` reads *its* graph, then surfaces the re-importable
  kernel-graph-v1 JSON in a copyable modal whose chrome now reuses the project
  wizard/delete palette (accent-green primary `.proj-btn`, muted secondary).
  *Why:* a single global Open/Save was ambiguous in a multi-project pane and the
  modal looked foreign; tying both to projects makes intent explicit and matches
  the rest of the surface. Kernel: `packages/.../chrome/ProjectPanel.tsx` and
  `projectViews.tsx` gain backward-compatible optional slot props only.
- **Ghost preview and object placement honour PPU + anchor.** An object asset
  (no autotile rule) is no longer stretched to the cell: it renders at its real
  size — `imagePx / PPU` cells (PPU from alias field 9) — with its library anchor
  (`anchorX`/`anchorY`) aligned to the cell-footprint centre, drawn once. The
  edit-mode ghost previews exactly that, so what you see is what gets placed.
  Autotile tiles are unchanged (cell-aligned by their rule). `matchAssetEntry`
  now also surfaces `ppu`; `paintCell` gains `drawAnchoredObject`.
- **Baked layer order is now stable across mutations.** Adding a sub-layer (or
  painting an existing layer) no longer shoves the parent to the end of its
  sibling order. Root cause: the vendored `rewriteAtPath` stamps the fresh
  version onto every node on the mutated path, and `projectBaked` orders siblings
  by version. Fix: after a mutation, restore the version of every pre-existing
  node touched (ancestors always; the leaf if it already existed) — only brand-new
  nodes get the appending version (`setNodeVersion`/`restoreAncestorVersions` in
  `baked/store.ts`). This is also a prerequisite for auto-sub-layer painting.
- **AssetStore no longer hard-codes the paint asset's type as `'tile'`.** It has
  no rule metadata; the renderer now derives tile-vs-object from `aliasMetas` at
  paint time, so object props bind `asset_type='object'` instead of being
  mislabelled tiles.
- **Bake preserves the selection's parent/child hierarchy and order.** Baking a
  set of output layers grafts each at its original `nodePath` (intermediates
  auto-created) in DFS order, remapping only a colliding top-level root so
  re-bakes don't clobber existing editable layers. Previously every layer was
  flattened to a top-level node, losing the `/House → /House/Roof` nesting.
- **"Bake" moved from a per-row button to a header "Bake selected (N)" action**
  over the multi-selected Output layers.
- **Baked-layer operation failures now surface in the console** (`[baked] …`
  warnings) instead of being silently swallowed — surfaced during debugging of a
  stale-backend 404.
- **Baked-layer stacking order fixed (was inverted).** The billboard painter now
  draws baked layers in true tree z-order via `orderBakedKeysForRender`: a child
  renders **on top of** its parent, and an upper-listed sibling renders **on top
  of** a lower one (whole subtrees stack as a unit). Previously the panel's
  top-to-bottom order mapped to bottom-to-top on the canvas. Graph/Output layers
  keep their existing order and stay beneath the baked layers.
- **Billboard coordinate readout is now global.** `screenToCell` no longer clamps
  to the content bbox, so the cursor reports a grid cell anywhere on the canvas
  (may be negative) — the grid is just default alignment, not the coordinate
  domain. *Why:* coordinates vanishing the moment the cursor left the painted
  region was confusing; a stable global frame is expected.

### Removed

- **"Drag batteries into the editor and run" canvas empty-state hint.** *Why:* it
  carried no useful information and cluttered an empty preview.
- **Preview toolbar settings (gear) dropdown.** Its only non-redundant control,
  "回正视角" (reset view), is now a direct toolbar button; zoom stays on the
  canvas wheel (centered on cursor). *Why:* the dropdown wrapped one useful
  action behind an extra click.

### Added

- **Open / Save buttons in the left pane — local import/export of the canvas
  graph JSON.** Restores a direct round-trip for the node graph that does not go
  through server-side template files. **Save** reads the live graph
  (`client.getPipeline()` + `client.listGroups()`) and assembles a
  `kernel-graph-v1` payload — the *same* shape the backend `/api/v1/pipeline/export`
  route writes (`{ format, name, graph: { id, nodes, edges, groups?, metadata? } }`),
  so it is re-importable and interchangeable with server templates. The studio
  wraps each plugin pane in a sandboxed iframe **without `allow-downloads`** (and
  sandboxed popups can't escape it), so a programmatic file download is silently
  blocked here; Save therefore shows the JSON in a copyable modal
  (`.scene-left-pane__save` + a Copy button) for the user to save manually,
  rather than a (blocked) download. **Open** uploads a JSON via the browser file
  dialog and imports it **inline** (the backend `/api/v1/pipeline/import` route
  already accepts a `{ format, graph }` body) with `mode:'replace'` after a
  `window.confirm`; the kernel broadcasts `graph:applied` over `/ws`, so the
  canvas + preview refresh live (no manual reload). Buttons reuse the existing
  `editor-controls__btn` style. App-only — no kernel change here: the inline
  import is a new `importPipelineInline` method on the app's `HttpApiClient`, not
  on the kernel `ApiClient` interface. On a rejected import (HTTP 422) it reads
  the body and surfaces the kernel's `reason` + `diagnostics` (e.g. `unknown opId
  'foo'`) instead of a bare status code, so a file referencing ops this backend
  doesn't have explains itself. (The kernel side — exempting the `__relay__` wire
  sentinel from import validation so reroute graphs round-trip — is recorded in
  the root `CHANGELOG.md`.) See
  `frontend/src/workbench/WorkbenchLeftPane.tsx` (`handleSave` / `handleOpen` /
  `onFileChange`), `frontend/src/api/HttpApiClient.ts` (`importPipelineInline`),
  `WorkbenchLeftPane.css` (`.scene-left-pane__io`), and
  `frontend/src/workbench/__tests__/openSave.smoke.test.tsx`.

- **GTA / worldmap scene30 batteries migrated from legacy `wb-scene`.** Ported the
  remaining Vice City pipeline ops (`city_grid`, `coastal_*`, `connected_roads`,
  `road_trim`, `gta_land`, airport/harbor/heightmap/park/remote_island overlays)
  and refreshed existing `gta_*` / `worldmap_render_layers` implementations to
  match `origin/wb-scene` through `3747d58b`.

- **`pnpm dev` HMR launcher (`scripts/dev.mjs`).** Runs the backend
  (`tsx --watch src/main.ts`) and the frontend (Vite dev server, which proxies
  `/api`,`/ws` to the backend via `vite.config`) together — the hot-reloading
  counterpart to `serve` (built dist). Builds `vendor/dist` first if missing
  (the `tsx --watch` path skips the backend `prebuild` that `serve` gets). Both
  halves share one process group so the host can group-kill the watcher tree on
  teardown. The studio `scripts/run.sh` now prefers `pnpm dev` for standalone
  plugins by default (set `FORGEAX_PLUGIN_HMR=0` for the `serve`/dist path), so
  editing plugin/kernel source hot-reloads the iframe instead of requiring a
  rebuild.

### Changed

- **Left workbench controls migrated from the legacy dev branch.** The left pane
  now uses the resizable Projects section plus `SceneGeneratorControlsPanel`
  (History / Data Types / Help) from the standalone scene-generator dev commit,
  while keeping node-editor's newer direct Preview reset-view toolbar behaviour.
  AssetStore chrome also drops the old settings gear in favour of the simplified
  fullscreen-only right cluster.
- **Previewer toolbar slimmed (`surfaces/RendererSurface.tsx`).** Dropped the
  settings (gear) button and its dropdown — including the `- 100% +` zoom
  buttons (canvas wheel already zooms around the cursor, so no capability lost) —
  and promoted **Reset view / 回正视角** to a direct toolbar button in the gear's
  old slot (screenshot · layers · reset-view · fullscreen). Removed now-dead
  state/logic (`showSettings`, `settingsRef` + its outside-click effect, `zoomBy`,
  `zoomPct`, `scale`, `setViewport2d`), unused imports (`zoomViewportCentered`,
  `Settings`/`ZoomIn`/`ZoomOut`), and the orphaned `.renderer-settings-*` /
  `.renderer-zoom-*` CSS. Smoke test updated to assert reset-view is a direct
  button. typecheck clean, smoke 7/7.
- **Kernel source now hot-reloads in dev (no `pnpm -r build` needed).** The
  frontend imported the kernel via package `exports`→`dist`, so editing
  `node-runtime` / `node-runtime-react` only took effect after a rebuild +
  restart. `frontend/vite.config.ts` now adds a dev-only `resolve.alias` mapping
  `@forgeax/node-runtime-react` (`.`, `/editor`, `/themes`) and
  `@forgeax/node-runtime` (`.`, `/layer1`) to their `src/*.ts`, with
  `optimizeDeps.exclude` (serve unbundled) and `dedupe: [react, react-dom,
  reactflow, zustand]` (single React across app + kernel source). `scripts/dev.mjs`
  runs the backend's `tsx --watch` with `--conditions=source` so the kernel's
  new `"source"` export condition resolves backend imports to `src` too — kernel
  edits hot-restart the backend. Both verified live with zero build. `serve`
  (dist) is untouched.
- **Docs realigned to monorepo reality.** Rewrote `ARCHITECTURE.md`,
  `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, and
  `docs/architecture/{backend,frontend,extension-and-contracts}.md` to reflect
  that the kernel is `workspace:*` packages in `packages/*`, not an
  `external/forgeax-wb-node-core` submodule consumed via `link:`. Removed all
  references to `external/`, `kernel:setup`, `kernel:build`, and submodule pin
  SHAs. Updated `docs/architecture/extension-and-contracts.md` to reflect that
  `resolveBatteryScanRoots` lives in `@forgeax/editor-host/backend` and always
  resolves both roots from the monorepo (no fallback probing). Removed dead
  `.gitmodules` + `.cursor/rules/kernel-cascade.mdc` references. Repointed
  acceptance-loop CLI bin to `packages/node-runtime-cli/dist/bin.js`. Hygiene
  `external/` submodule guard removed from `scripts/hygiene-check.mjs`.

### Removed

- **Removed the obsolete `texture_bind` battery (kernel cascade: `f831fe6`).** The
  stale `asset_grid` port type is retired in lockstep with `forgeax-wb-node-core`;
  texture helpers now expose only generic `image` / `dict` outputs and no longer
  advertise a texture-grid binding node.

### Fixed

- **`batteryRoots` loads shared common batteries from `external/forgeax-wb-node-core`.**
  Monorepo / marketplace checkouts pin the kernel under `external/`; the loader
  previously only scanned a sibling `../forgeax-wb-node-core` path (forgeax-studio
  layout), so the `batteries-common` pack was missing. Tries `external/` first,
  then sibling, then plugin `batteries/`.

### Added

- **Saved group batteries default to a GROUPS tab in Develop** (kernel cascade —
  bump `external/forgeax-wb-node-core` to `afd18d0`; see its CHANGELOG Unreleased).
  - The group **Save** button now writes a normal group battery to
    `batteries/groups/<category>/` (was `batteries/templates/`), and
    `GET /api/v1/group-templates` lists **both** `groups/*` (Develop → GROUPS,
    sub-categorized by the save-time tag) and `templates/*` (Templates mode — a
    special curated subset; not every group is a template). `findTemplateFile` +
    `/categories` updated to search/list the `groups/` root too
    (`backend/src/routes/groupTemplates.ts`).
  - Kernel `isTemplateBattery` now keys off the big label (`getBigLabel !==
    'groups'`) instead of an exact `displayGroup` match, so `groups/<cat>`
    batteries stay in Develop with sub-categories while `templates/*` stay in
    Templates mode (backward compatible). This also surfaces the previously
    dormant `batteries/groups/` library (architecture / main / tools / general).

- **Multi-project management in the left pane + per-agent project lock** (kernel
  cascade — bump `external/forgeax-wb-node-core`; see its CHANGELOG Unreleased).
  - The left pane (`frontend/src/workbench/WorkbenchLeftPane.tsx`) now mounts the
    kernel **`<ProjectPanel>`** (cards: switch / create / delete) as its top section;
    it configures its own editor transport + `subscribeProjectActivation()` so it
    stays live with the center editor. The old read-only "Recent projects" list was
    removed (superseded by the interactive panel). The static workflow / preview /
    tips sections are kept.
  - New AI tool **`scene:projects.close`** (release the exclusive lock) +
    backend `POST /api/v1/projects/:id/close` (`backend/src/routes/projects.ts`).
    Open-then-operate: an agent opens (locks) a project, operates, then closes;
    it cannot open a second project until it closes the first, and cannot open a
    project another agent holds. Tool calls forward the caller via
    `x-forgeax-caller-*` headers (`backend/src/tool-handlers.ts`); the activate +
    batch/execute/import routes enforce the lock (`ensureMutationAccess`).

### Changed

- **The canvas top-right "projects" button + modal were removed** in favour of the
  left-pane `<ProjectPanel>` (`frontend/src/workbench/WorkbenchHost.tsx`). *Why:*
  one project-management surface, in the left pane, for both the human and the LLM.

### Fixed

- **`serve` now self-builds missing dist artifacts before boot.** Mirrors the
  lowpoly plugin host contract: a cold checkout with no `frontend/dist` runs
  `pnpm -C frontend build` before serving the bundled UI. Scene keeps its
  existing dist-backed backend path, so a missing `backend/dist/main.js` now
  also runs `pnpm -C backend build` instead of failing with a manual-build
  instruction.

### Changed

- **Asset store de-submoduled → built-in `materials/asset-store/`.** *Why:* the
  asset library was a git submodule pointing at an external repo
  (`dev/assetstore`); that coupled the plugin to a separate repo's
  availability/permissions and complicated clones. It is now a plain in-repo
  directory mirroring the legacy `forgeax-wb-scene` layout (`materials/asset-store/`
  with `library.db` + content-addressed `blobs/`), with **no remaining link to the
  upstream repo**. Removed the submodule from `.gitmodules`/`.git/config`/`.git/modules`,
  dropped the now-obsolete `assets:setup` script, and repointed `ASSET_STORE_DIR`
  in `backend/src/library/db.ts` from `external/asset-store` → `materials/asset-store`
  (the only code path constant; `service.ts` consumes it). SQLite WAL sidecars
  (`library.db-shm/-wal`) stay untracked via the dir's `.gitignore`.
  `external/forgeax-wb-node-core` (the kernel) remains the only submodule; SSOT
  model unchanged. Verified: build:vendor / typecheck / build / hygiene green,
  scene frontend `79 passed`, backend `32 passed`, and the `/api/v1/library/*`
  routes still serve assets from the new path.

- **Kernel cascade: bump `external/forgeax-wb-node-core` → `1441ca5`.** Picks up
  the debounced-persist editor change (`schedulePersistSession` + skippable
  `incrementalExecute({ persist:false })`) — the editor half of upstream
  `7bccdc20`. Coalesces persist storms during node/frame drags, panel resizes and
  multi-step canvas edits. Editor-only kernel change; no scene backend/frontend
  source change beyond the submodule pin. Kernel dist rebuilt under `external/`.
  Pin matches the 3d plugin. Verified: scene frontend `79 passed`, backend
  `32 passed`.

- **Kernel cascade: bump `external/forgeax-wb-node-core` → `a2a848e`.** Picks up
  the upstream `wb-scene` editor-parity batch (i18n preview labels `7c1206cd`,
  relay fork-delete `e0c567d7`, relay capsule `09388e3f`, preview-disabled ring
  `b2beda9e`, group-view overlap `1506493a`, port handle z-index `e75d91aa`,
  annotation Ctrl-drag/copy `440da6a5`, the bbox/frame chain
  `3b907c5c`/`0993136a`/`40f27e51`, favorites context-menu affordances
  `51dceee2`, and frame-persistence reconciliation `f3414fe1`). Editor-only
  kernel change; no scene backend/frontend source change required beyond the
  submodule pin. Kernel dist rebuilt under `external/`.

- **Renderer: upstream visualization parity (top mode).** Ported renderer
  changes from the legacy implicit-list upstream (`wb-scene`): `efa4f925`
  (selected layers now draw a thin solid mask outline plus a dashed
  whole-layer bbox to distinguish the two — top mode; the legacy topBillboard
  grid-layer stroke path does not exist here, see note); `c40a7ed0` (multi-value
  `wire` rendering — per-value alpha banding and per-cell outlines on sub-value
  selection — for the GTA zones batteries; the legacy `cellSource` change is a
  no-op for us since our `cellSource` already computes accurate `isMultiValue`
  directly); `b4936837` (preview bridge now also collects grids from
  `any`/`array`/`list` ports so pass-through batteries with dynamic `any`/`tree`
  outputs still render). Frontend-only, no kernel cascade.

### Added

- **Upstream batteries: worldmap + GTA series (`scene30/`).** Ported the
  converged upstream `SCENE 3.0/worldmap`, `gta`, and `gta_cities` battery
  groups (20 self-contained grid ops) from the legacy implicit-list upstream
  (`wb-scene` branch) commits `b4936837` (worldmap group), `0a646ecc` (gta group +
  worldmap fixes), `0cbed07f`/`d47b24f9` (gta main-road), `89136f0f` (gta
  aux-road), `c40a7ed0` (gta zones), `bc92857b` (gta_cities series) into
  `batteries/scene30/{worldmap,gta,gta_cities}`. Ops are self-contained (no
  `_shared`/external imports), no id collisions, and the loader reports the new
  ops with zero new skips. Pure-additive, no kernel cascade.

- **Architecture docs.** Added [`ARCHITECTURE.md`](./ARCHITECTURE.md),
  [`docs/architecture/`](./docs/architecture/) (backend · frontend ·
  extension-and-contracts) and [`AGENTS.md`](./AGENTS.md): a code-grounded map of
  the scene plugin (backend routes/runtime/library/agent, the renderer
  subsystem, the scene domain seam) and a read-before-write protocol.

### Fixed

- **Kernel bump → `483431c`** (cascade). Bumped `external/forgeax-wb-node-core`
  for the deterministic battery scan + first-wins duplicate-id guard. Scene now
  loads `290 ops (0 skipped)` with the `scenealg/*` (`alg_*` id) and legacy
  same-basename ops coexisting deterministically; documented in
  `docs/architecture/extension-and-contracts.md`.

- Bumped the shared editor kernel so grouped nodes persist as real kernel
  groups across live-sync/refetch instead of immediately expanding back to
  member nodes.
- Bumped the shared editor kernel so double-clicking a wire reliably hits the
  ReactFlow edge interaction path and inserts a typed Relay in the browser.

### Added

- Added scene group-template REST support (`/api/v1/group-templates*`) so the
  shared editor can save collapsed groups as reusable template batteries, list
  them in Templates mode, and instantiate them back onto the canvas.
- **Relay double-click parity.** Bumped the shared editor kernel to restore the
  legacy relay interactions inherited by scene-generator: double-click a wire to
  insert a typed relay, double-click a relay node to remove it and restore the
  direct wire when possible.

- **Shared editor chrome.** `WorkbenchHost` now imports `PipelineFileDialog` and
  `ProjectsDialog` from the shared kernel editor package instead of carrying
  scene-local copies. Scene-specific state remains limited to renderer/asset-store
  preview wiring, scene panel renderers, and `scene` project defaults.
- **Shared editor probe / relay affordances.** Bumped the kernel submodule so the
  inherited editor exposes the data-probe toggle directly in the toolbar and adds a
  Canvas quick-search **Relay** entry that creates the kernel `__relay__` sentinel.
  Relay remains kernel/editor infrastructure rather than a common battery pack item.
- **Shared `common` batteries.** The generic number/list/datatree/input batteries
  plus generic grid/annotation preview panels now load from the shared
  `forgeax-wb-node-core/packages/batteries-common` pack instead of living under
  this downstream's `batteries/special/**`. Existing op ids such as
  `number_const`, `range_list`, and `tree_merge` are unchanged, while the palette
  and `/api/v1/ops` now expose them under `common/*` categories. The category
  scanner now accepts multiple battery roots and treats every scan-root top-level
  folder as an automatic palette tab.
- **Keyboard Undo/Redo (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z) is now reversible
  end-to-end.** Inherited from the kernel submodule bump: the shared editor
  (`node-runtime-react`) gained `useCanvasUndoRedo`, which restores the History
  snapshot at the cursor — including the now-visible AI/CLI `batch_applied`
  entries — authoritatively through the kernel (`importPipeline` replace, actor
  `undo`/`redo` → `applyBatch → graph:applied → loadPipeline → reconcile → preview
  refresh`), with `undo`/`redo` marked history-suppressed so restores never loop or
  double-advance the cursor. See the kernel CHANGELOG for the contract.
- Added an end-to-end REST smoke (`scripts/smoke-undo.mjs`, `pnpm smoke:undo`,
  isolated temp root + alt port 9579) proving: an AI batch (`actor:'ai:test'`) is
  applied, UNDO via the canonical import/replace path with `actor:'undo'` returns
  `GET /api/v1/pipeline` to the pre-batch graph, REDO (`actor:'redo'`) moves
  forward, and `undo`/`redo` are history-suppressed.

### Fixed

- **Multi-layer scene assembly produced empty output.** Wiring two `grid2node`
  scene outputs into a `tree_merge` battery yielded empty downstream. Three
  coupled defects fixed:
  - `batteries/special/datatree/tree_merge/index.ts`: the structural-pack default
    branch used `value instanceof DataTree`, which fails across module boundaries
    (the dispatcher's `DataTree` class ≠ the dynamically-imported battery's copy).
    Now uses the same `isDataTree()` duck-type as the item-concat branch.
  - Kernel submodule bump: restores the `tree_merge` `inferredAccess` connect-hook
    in `node-runtime-react`'s `useCanvasConnect` (see kernel CHANGELOG) so
    `access:'item'` scene inputs take the item-concat branch.
  - The correct battery for assembling multi-layer scene trees is **`add_child`**
    (grafts each scene under a parent path), not `tree_merge` (DataTree
    wire-algebra). `tree_merge` now returns an actionable error pointing at
    `add_child` when scene values are wired into it, instead of silently emitting
    empty output.
- Added backend tests (`backend/tests/scene-assembly.test.ts`) covering
  `add_child` + `node_explode`, nested assembly, the `tree_merge` cross-module
  regression, and the scene-misuse guard; plus an end-to-end REST smoke
  (`scripts/smoke-scene-assembly.mjs`, `pnpm smoke:assembly`) proving a
  `grid2node → add_child → scene_output` pipeline yields a 2-child scene and 2
  non-empty voxel layers.

### Added

- **Multi-project management (new/open/delete/switch).** Faithful port of the
  legacy `forgeax-wb-scene` project flow onto the kernel `ProjectRegistry`, with an
  LLM/CLI-callable HTTP API:
  - `GET /api/v1/projects` (list), `POST /api/v1/projects` (create —
    `{ type, name, fromTemplate? }`, fromTemplate resolved against the templates dir
    and seeded via the kernel `importPipelineGraph`), `GET /api/v1/projects/:id`,
    `PUT /api/v1/projects/:id` (rename/update), `DELETE /api/v1/projects/:id`
    (`?assetPolicy=detach|delete`), `POST /api/v1/projects/:id/activate`,
    `GET/PUT /api/v1/workspace`. Registered in `backend/src/main.ts`.
  - **Activate** persists the outgoing project's graph, hot-swaps the active runtime
    to the target project's isolated `state/graph.json` + `history.jsonl` + `outputs/`,
    then forwards `graph:applied` over `/ws` so the canvas refetches live — graph swaps
    reuse the exact `applyBatch`/`loadPipeline → graph:applied → pipelineRevision++ →
    useCanvasGraphSync reconcile → preview refresh` cascade. WS subscriptions re-bind to
    the new runtime (`rebindWsSubscriptions`).
  - **Backfill:** the existing implicit `main` graph at `.forgeax-runtime/state/graph.json`
    is auto-registered as a default project on first run — current users keep their work.
  - Frontend: a `ProjectsDialog` (projects modal + new-project wizard + delete dialog)
    in `WorkbenchHost`, opened from a toolbar button showing the active project name;
    switching remounts the preview iframe and posts `workbench:project-changed` so the
    renderer clears/reloads. `activeProjectType` still filters the battery palette.
  - CLI: `forgeax project list|create|open|delete`.
  - Covered by `scripts/smoke-projects.mjs` (`pnpm smoke:projects`): backfill + two
    isolated projects (graph + history) + activate switching reflected in
    `GET /api/v1/pipeline` + the AI create/open/batch/screenshot path + safe delete.
- **Import a node-connection graph from a file.** Faithful port of the legacy
  `forgeax-wb-scene` `savePipelineAs` / `saved-files` / `load-file` flow onto the
  kernel-batch architecture, with an LLM/CLI-callable HTTP API:
  - `POST /api/v1/pipeline/import` — body is either inline `{ format, graph, options }`
    or `{ file: { path, source }, options }` (server reads from the templates dir).
    `options`: `{ mode:'replace'|'merge', remapNodeIds, idRemap, executeAfter:
    'none'|'downstream'|'full', actor, label }`. Delegates to the kernel
    `importPipelineGraph`, then on success forwards `graph:applied` over `/ws` (so the
    canvas refetches live, identical to `/api/v1/batch`) and, per `executeAfter`, runs
    the affected/whole graph so previews refresh via the existing
    `useNodePreviews`/`exec:completed` path. Replace flows through `applyBatch →
    graph:applied → loadPipeline → pipelineRevision++ → useCanvasGraphSync reconcile`,
    NOT an ad-hoc canvas wipe.
  - `GET /api/v1/pipeline/templates` — scans `<projectRoot>/templates/` and returns
    `{ path, name, source?, format? }[]`. Path traversal is rejected.
  - `POST /api/v1/pipeline/export` — writes the current graph as `kernel-graph-v1`
    (incl. `viewport`/`annotations`/`frames` metadata) to a template file, enabling a
    round-trip (export → re-import → identical graph).
  - **Frontend**: `HttpApiClient` implements `listImportTemplates` /
    `importPipelineFile` / `exportPipelineFile`; `WorkbenchHost` wires the editor
    `Toolbar` `onOpen` / `onSave` to a new `PipelineFileDialog` (open template → import
    → live cascade; save → export).
  - **Headless / LLM**: an agent can `POST /api/v1/pipeline/import` with inline JSON,
    `mode:'replace'`, `executeAfter:'full'`, `actor:'ai:import'`, `label:'…'` to swap
    the canvas + previews live; the `forgeax pipeline import` CLI wraps the same kernel
    function (see kernel CHANGELOG).
  - **Kernel submodule bump** — adds `node-runtime` `importPipelineGraph`,
    `node-runtime-react` `legacyPipelineToOps` + adapter import/export + Toolbar
    `onOpen`/`onSave`, and the `node-runtime-cli pipeline import` subcommand.
  - New `scripts/smoke-import.mjs` (`pnpm smoke:import`, isolated temp project root +
    alt port 9575): imports a saved template (replace, execute full), asserts the
    imported nodes/edges land in `GET /api/v1/pipeline`, a History entry
    (`actor:'import'`) exists, outputs were produced, the export→re-import round-trip is
    identical, and the inline `actor:'ai:import'` path lands + is history-bridgeable.
- **History panel reflects AI/CLI-driven operations.** Programmatic mutations
  (`POST /api/v1/batch` from an AI agent / CLI / another client) now surface in the
  editor's History panel, not just local UI clicks. The `/api/v1/batch` route
  forwards `opts.actor` **and** an optional `opts.label` into the kernel history
  entry, so AI callers can annotate a batch (e.g. `{ actor: 'ai:agent', label:
  'AI: 创建山脉 ×2' }`); the kernel bump (below) adds the history bridge that records
  these committed batches into the editor `useHistoryStore`, while local `editor`
  ops are skipped to avoid double-recording. New `scripts/smoke-history.mjs`
  (`pnpm smoke:history`, isolated temp project root + alt port 9577): POSTs an
  `actor:'ai:test'` batch, asserts `GET /api/v1/history` persists actor + label +
  ops + batchId and that `graph:applied` carries the batchId (the data the bridge
  needs), and that a local `editor` batch is classified as skip-by-the-bridge.
- **Kernel submodule bump** — adds the `node-runtime-react` History bridge
  (`subscribeLiveSync` records non-local committed batches into `useHistoryStore`,
  capturing the pre-batch snapshot and labelling by actor/ops) and the additive
  `node-runtime` `HistoryEntryV1`/`ApplyBatchOptions` `label` field. No regression
  to incremental canvas reconcile, external/LLM live-sync, or tree_merge/add_child
  (see kernel CHANGELOG).
- **Faithful UI replica — kernel bump.** Bump kernel submodule to the faithful
  editor build that adds `Editor` `showRunControl` / `statusBar` props, a wired
  `connectionStatus`, and a battery catalog that honours on-the-wire `category`
  hints.
- **Workbench host** (`frontend/src/workbench/`): legacy-style layout that mounts
  the kernel `Editor` (Run/Stop hidden — the scene generator auto-executes) and
  embeds the renderer + asset-store panes as same-origin iframes, with focus,
  resize, and an aggregated status bar. `App.tsx` routes by `?pane=`.
- **Renderer pane** (`surfaces/RendererSurface`): faithful Preview toolbar
  (view-mode dropdown + Wire/Color/Asset segment), empty-canvas hint, layer side
  panel, screenshot, and WS-driven refresh over the 4-mode render canvas.
- **Asset store pane** (`surfaces/AssetStoreSurface`): zone selector, search,
  grid/list views with per-asset size badges, and centered numbered pagination,
  over new read-only `/api/v1/library/{zones,list}` routes.
- **Battery category projection** (`backend/src/routes/batteryCategories.ts`):
  scans the on-disk `batteries/` tree and re-attaches each op's
  `category`/`displayGroup` to `GET /api/v1/ops`, restoring palette grouping
  (8 big categories: scene30, alg_store, special, components, basic, scenealg,
  scene, ai) that the kernel deliberately strips from `OpSpec`.
- `setLayerVisible` action on the render store for per-layer visibility toggles.

- **Stage-2a (scene battery migration).**
  - Bump kernel submodule to `node-runtime-cli-v0.1.0` (bundles
    `@forgeax/node-runtime` v0.3.0 + the implemented `forgeax` CLI).
  - Vendor `shared/types` under `vendor/` with a `build:vendor` compile step
    (emits `vendor/dist/shared/types/`), so battery `.ts` files loaded via Node
    type-stripping can resolve their `shared/types/index.js` imports.
  - Migrate in-scope scene batteries (copy + import rewrite): `special`, `scene`,
    `scenealg`, plus `scene30`, `basic`, `components`, `alg_store`, `templates`,
    `ai`, `json`, `groups`. Excludes 3D-modeling and image-processing batteries.
  - Headless loop proven: the kernel loader scans the migrated tree with 0 errors
    for the must-run set (`special` except `sort`, `scene`, `scenealg`);
    `pnpm smoke:batteries` runs `executeNode` over the loaded ops; `pnpm accept`
    drives the `forgeax` CLI end-to-end with a deterministic output hash.

- **Scaffold.**
  - Initial scaffold consuming `@forgeax/node-runtime` via git URL dependency.
  - Backend / frontend / batteries / schemas directory skeleton.
  - ForgeaX plugin manifest with split surface layout.
  - Hygiene check, ESLint, Prettier, CI workflow.

### Changed

- **Asset store UI fidelity pass** (`surfaces/AssetStoreSurface.{tsx,css}`): aligned
  the pane to the legacy AssetStore chrome (the design source of truth).
  - Titlebar: replaced the wide plain `<select>` zone field with a compact,
    zone-tinted dropdown (raw→"Ra", staging→"St", …); replaced the plain
    `Grid`/`List` text buttons with an icon-only view-mode dropdown; added the
    legacy settings gear; the search field now lives inside the gear (with a
    clear button and an active-search dot on the gear), and the gear also holds
    the relocated status (zone · total · page · selection) plus a Refresh action.
  - Icons: introduced hand-ported Lucide-style inline SVGs
    (`surfaces/library/icons.tsx`) for the gear, view-mode, fullscreen,
    pagination chevrons, search/clear and refresh glyphs, replacing the prior
    ASCII/emoji arrows and text labels.
  - Grid: dropped the non-legacy checkerboard thumbnail background in favour of
    the legacy solid `--color-bg-secondary` tile, with pixelated image rendering
    and the legacy hover-lift / accent selection treatment.
  - Status/pagination: the bottom bar is now pagination-only (centered numbered
    pages with first/last edges + ellipsis + chevron arrows) and hides on a
    single page; the old "zone · N assets" / "No selection" footer text moved
    into the gear status block.
  - Styling now consumes the shared kernel design tokens (`--color-*`,
    `--radius-*`, `--transition-*`, `--titlebar-height`).
  - Operation logic is unchanged and stays API-backed: zone switch →
    `/api/v1/library/zones` + `/library/list`, search/paging → `/library/list`,
    thumbnails → `/library/serve`; view-mode and selection remain local view
    state. Legacy gear features without a backing route in this read-only backend
    (project filter, upload, batch repair/ops, 13-field review filters, monitor)
    are intentionally omitted rather than shipped as dead buttons.
- **Asset store continuous-scroll pagination** (`surfaces/AssetStoreSurface.tsx`,
  `surfaces/library/{assetStoreStore,pagination}.ts`): replaced the discrete
  one-batch-per-page model with the legacy continuous-scroll model. The store now
  loads the WHOLE active zone (looping the page-capped `/library/list` route in
  500-row batches) into one list; the grid is a single scroll area over every
  asset. `pageSize` is derived from the live viewport (columns × visible rows via
  a `ResizeObserver`, with a window-resize fallback), the page indicator tracks
  scroll position (`setPageFromScroll`), and clicking a page number smooth-scrolls
  to that page's first card (`goToPage` → `pendingScrollToPage`) instead of
  swapping a batch. Scroll vs. programmatic-scroll fights are avoided with a
  short scroll lock. All loading stays API-backed; scroll position / current page
  / pageSize are pure local view state.
- **Renderer/preview UI fidelity + viewport interaction.**
  - **Layers panel is scene-output-only again** (`surfaces/RendererSurface.tsx`):
    removed the `GridLayerRow` that wrongly listed node grid-output previews (e.g.
    `978806ea… 128×128`) in the panel. The panel now lists ONLY `scene_output`
    voxel layers, matching the legacy `LayersSidePanel`, with the legacy empty
    state ("No scene output layers" / "Connect a Scene Output battery to see its
    layers here."). Grid previews still render live on the canvas (the `top` mode
    keeps projecting them via `useNodePreviews`); they are simply no longer listed.
    The canvas empty-state ("Drag batteries into the editor and run") and the
    status layer count still consider both buckets, matching legacy.
  - **Mouse/viewport interaction** restored to match legacy. The host
    `renderer/host/RenderCanvas.tsx` now owns the interaction layer for the 2D
    modes (top / topBillboard / iso): left-drag pan and wheel zoom centered on the
    cursor, both writing the shared `viewport2d` store so every 2D mode benefits;
    `free3d` is left to its own `OrbitControls`. Added a pure, unit-tested
    `renderer/framework/viewport2d.ts` (legacy zoom-around-cursor anchor math,
    nice-step quantization, `MIN_SCALE`/`MAX_SCALE` clamps) plus `panViewport2d` /
    `resetViewport2d` store actions. A top-left overlay shows the cursor cell +
    zoom % readout (legacy `canvas-coords`). Verified `screenToCell`/`cellToScreen`
    still invert the compose transform.
  - **Toolbar fidelity** (`surfaces/RendererSurface.{tsx,css}`): gradient "Preview"
    title, a "Ready" status pill, a scene-layers-panel toggle, a settings gear
    (View zoom −/%/+/reset + Save screenshot), and an icon fullscreen toggle —
    replacing the plain `Reset`/`Shot` text buttons and the ASCII `▾`/`⤢`/`↙`
    glyphs. Hand-ported Lucide-style inline SVGs (`surfaces/icons.tsx`: Layers,
    Settings, Maximize2/Minimize2, ZoomIn/ZoomOut, Home, Camera, Eye/EyeOff, Box,
    ChevronDown) give the legacy icon treatment with no new dependency.
  - **Layers panel row fidelity**: golden-angle value color swatch, node/path
    label, voxel cell count, Eye/EyeOff visibility toggle, hidden-row dimming, and
    a local selection highlight — matching the legacy leaf rows.
  - All styling consumes the shared kernel theme tokens (`--color-*`, `--radius-*`,
    `--spacing-*`). View state (viewport offset/scale, view/draw mode, layers-panel
    open, selection) stays local to the renderer; nothing here mutates graph or
    runtime state. Legacy gear features without a backing API in this build
    (manual refresh / clear-cache / asset-library picker / 3D params / auto-refresh
    toggle) are intentionally omitted rather than shipped as dead buttons.
- **Renderer editor-selection highlight + toolbar height/colour.**
  - **Editor-selection highlight wired end-to-end** (view-only; no graph mutation).
    The legacy renderer learns the editor selection from an `editor:selection` WS
    event → `renderStore.selectedEditorNodeIds`, then strokes the selected node's
    layers green (`SELECT_EDITOR_COLOR`) and highlights their Layers-panel rows.
    This backend emits no such WS event (kernel selection is client-side in the
    host's pipeline store), so the workbench host now reads
    `usePipelineStore.selectedNodeIds` and forwards it to the renderer iframe over
    a new `workbench:editor-selection` postMessage (seeded on iframe load, then on
    every selection change); the renderer mirrors it into a new
    `renderStore.selectedEditorNodeIds`. The highlight is applied across all modes:
    `top` (success-green outline in `compose`, for BOTH voxel layers AND grid
    previews — so selecting a preview battery highlights its grid preview), `iso`
    and `topBillboard` (per-cell green via the master surface inputs + cache key),
    and `free3d` (mesh brighten — its mesh builder has no separate green channel,
    noted as an approximation), plus the green `is-editor-selected` Layers-panel
    row (`RendererSurface.{tsx,css}`).
  - **Screenshot moved to the top toolbar** (`surfaces/RendererSurface.tsx`): the
    (non-legacy, our-addition) screenshot capture is now a `Camera` icon button on
    the toolbar instead of an entry inside the gear menu's Actions section.
  - **Toolbar height & colour matched to legacy** (`surfaces/RendererSurface.css`):
    the Preview toolbar was too tall / off-colour (`6px 8px` padding over
    `--color-bg-secondary`). It now uses the exact legacy values via shared kernel
    tokens — `height: var(--titlebar-height)` (32px, consistent with the editor
    titlebar), `padding: 0 var(--spacing-md)` (12px, no vertical padding), the
    titlebar gradient `linear-gradient(180deg, var(--color-bg-titlebar) #050806 →
    var(--color-bg-titlebar-gradient) #0b120d)`, a `rgba(255,255,255,0.06)` bottom
    border and the legacy drop shadow.
  - **Other parity audit**: implemented selection (above). Intentionally skipped,
    for lack of a data source/API in this build (not legacy-faithfulness gaps in
    intent): the Layers panel's collapsible sink/path TREE with per-value sublayer
    rows + sublayer visibility (the `scene_output` projection yields one value per
    layer key here, so there are no sublayers to nest/toggle); editor-driven
    per-node preview on/off reflected on canvas (legacy `preview:change` WS — not
    emitted here; the per-voxel-layer Eye toggle already covers local visibility);
    and the AI-agent renderer commands (set-view-mode / select-layer / open-all
    sublayers WS) which have no channel on this backend. Hover row highlighting,
    z-ordering by `updatedAt`, and the cursor cell/zoom readout were already
    present.
- **Node editor host chrome fidelity (top-right controls + status).**
  - **`frontend/src/workbench/WorkbenchHost.{tsx,css}`** aligned the kernel-Editor
    host chrome to the legacy editor (the design source of truth), whose top-right
    is just a settings gear + a fullscreen toggle, with embed toggles and status
    living inside the gear menu:
    - Moved the **Render / AssetStore embed toggles** off the top bar and into the
      gear dropdown (kernel's new `settingsActions` slot), rendered as legacy
      `.settings-action-button`s with hand-ported Lucide `Monitor` / `Package`
      inline SVGs — replacing the prior top-bar plain-text `Render` / `Assets`
      buttons.
    - **Fullscreen** now uses the kernel toolbar's Lucide `Maximize2` /
      `Minimize2` control (wired via the new `isFullscreen` / `onToggleFullscreen`
      Editor props) instead of the ad-hoc `⤢` / `↙` glyph button.
    - **Removed the bottom status bar** (`.wb-statusbar`): the legacy editor has no
      status bar and surfaces connection / selection / node-edge counts through the
      gear → Status panel. Embedded Renderer / AssetStore live status now rides into
      that same panel via the kernel's new `settingsStatusExtra` slot.
  - Bump kernel submodule to `dd9ff27` (gear-menu `settingsActions` /
    `settingsStatusExtra` slots + forwarded fullscreen control; faithful 1:1 ports
    of the BatteryBar palette, canvas grid/node cards/edges, minimap and zoom slider
    were already in place and needed no change).
  - **Develop / Templates tabs**: intentionally still not added — the new backend
    has no template system, so a Templates tab would be a dead/empty page; the
    palette stays in its single (Develop) mode and the toggle is omitted rather than
    shipped as a dead control.

### Fixed

- **Dragging in one battery reloaded ALL batteries / fully redrew the preview**
  (regression vs the legacy incremental engine). Root cause was the kernel
  editor's `pipelineRevision`-keyed *blanket* canvas rebuild: every committed
  batch — including a local drag-add's own `incrementalExecute → updatePipeline`
  persist, which the backend broadcasts as `graph:applied` — round-tripped into
  `loadPipeline() → pipelineRevision++ → setNodes(built)`, handing every node a
  fresh object so `memo(BatteryNode)` re-rendered for the whole canvas. The
  legacy editor never blanket-rebuilt on a graph mutation; it only rebuilt on a
  gated session-restore signal and drove local edits incrementally. Ported that
  contract — the canvas now diff-reconciles (`reconcileCanvasNodes` /
  `reconcileCanvasEdges`, in the kernel submodule) so only added/changed/removed
  nodes update and untouched batteries keep their identity (external/LLM/CLI
  live-sync still works). **Evidence:** adding 1 battery to a 24-node canvas now
  rebuilds 1 node object instead of 25 (0/24 unaffected re-render); the kernel
  already scopes execution to the new node's closure (full run = 6 nodes, add =
  1 node executed, 0/6 existing recomputed). Requires the kernel submodule bump.
- **Preview window fully redrew on every graph change.** `useNodePreviews`
  re-pulls every node's output on each `graph:applied` / `exec:completed` and
  re-wrote every layer object, breaking the per-layer subscription contract
  (`useGridLayer` / `useVoxelLayer` are designed so untouched layers keep a
  stable reference). The render store `setPreviewLayer` / `setLayers` now skip
  the write when the re-pulled content is identical, so only the genuinely
  changed region re-renders — the legacy "partial redraw" behaviour. Covered by
  `renderer/__tests__/store.test.ts`.
- **External / LLM-driven graph edits never appeared in the editor** (the
  North-Star "watch the AI work" loop was broken). Two root causes: (1) the
  backend `POST /api/v1/batch` route applied ops but never broadcast a WS event,
  and the kernel bus emits nothing on `applyBatch`, so a batch from any
  out-of-browser actor (CLI / LLM / another tab) produced zero live-sync traffic
  — only the originating browser self-refreshed via a local synthetic event.
  `mutations.ts` now broadcasts a real `graph:applied` RuntimeEvent to every
  connected client after a committed batch. (2) The editor canvas
  (`useCanvasGraphSync`) rebuilt its ReactFlow layer only when
  `currentPipeline.id` changed, but the id is the constant `'main'`, so every
  refetch (with new content, same id) was a no-op. The store now bumps a
  `pipelineRevision` counter on each `loadPipeline()` and the canvas keys its
  rebuild on that (selection preserved across rebuilds).
- **Editor showed an empty canvas after a refresh even though the graph was
  persisted**: on mount `loadBatteries()` and `loadPipeline()` race, and
  `buildCanvasNodes` drops any node whose battery isn't in the catalog yet. When
  the snapshot resolved first, the single rebuild produced 0 nodes and never
  recovered. The canvas now also rebuilds when the battery catalog first becomes
  available. Covered by `canvasGraphSync.rebuild.test.tsx`.
- **Duplicate first page in the Asset Store pager**: for small page counts the
  pager rendered two highlighted "1" buttons ("1 1 2 3 4"). Root cause: the
  centred page window was clamped with `Math.min(centerStart, totalPages-…)`,
  which pulled `windowStart` back to 1 so the always-rendered leading edge "1"
  and the window's first page collided. Replaced the generator with `pageItems()`
  (`surfaces/library/pagination.ts`), which emits each page exactly once — flat
  `[1..n]` for ≤7 pages, else `1 … [window clamped to 2..n-1] … n` — covered by
  new unit tests.
- **Empty preview window**: the renderer only projected `scene_output` voxel
  layers, so wiring up an intermediate chain (e.g. `cellular_noise →
  max_rectangle`) rendered nothing until a scene-output battery was connected —
  diverging from the legacy "watch as you build" preview. Restored the dense 2D
  grid-preview path: a new `previewLayers` store bucket, a `gridLayerCellSource`
  adapter, grid instances in the top render mode, and a `useNodePreviews` bridge
  that pulls every executed node's `grid` output (gated by per-node
  `previewEnabled`, default on) alongside scene-output voxels. The Layers panel
  now lists both grid and voxel layers.
- **Previews crashed / went blank on a NON-EMPTY scene** (`layer.cells is not
  iterable`): `flattenWire` unwraps only one DataTree level, but the kernel
  serializes `scene_output.layers` (`voxel_layers`) and `.names` (`name_list`)
  as `DataTree.fromItem(T[])` — i.e. the whole list is a single item, so the
  wire is DOUBLE-wrapped (`[{path, items:[[ …layers ]]}]`). `flattenWire` then
  returned a one-element array whose element was itself the layer list, and
  `setLayers(… that array)` blew up in the renderer. (Earlier tests only used
  blank scenes, so it was hidden.) Added `flattenWireList` (unwraps the DataTree
  level, then spreads the list-valued leaf) and switched the `voxel_layers` /
  `name_list` call sites (`bridge/useNodePreviews.ts`, `scripts/preview.mjs`,
  `scripts/north-star-loop.mjs`) to it. `grid` stays on `flattenWire` (its
  `fromItem(number[][])` leaf IS the entity and must not be spread), so
  single-wrap grids and double-wrap voxels no longer regress each
  other. Verified against the live 5-node demo scene (`out1`, 380 voxels): the
  preview now renders the real isometric scene instead of crashing. Covered by
  new `flattenWire`/`flattenWireList` unit tests and a non-empty-scene
  `useNodePreviews` regression test.
- **Empty BatteryBar at `:9555`**: caused by `opSpecToBattery` crashing on ops that
  ship no `params` (the whole catalog load rejected). Fixed kernel-side; the
  scene generator now loads all 290 batteries.
- **Editor StatusBar no longer stuck on "Disconnected"** (kernel now drives
  `connectionStatus` from the transport round-trips).
- **Stale preview on node deletion** (`bridge/useNodePreviews.ts`).
  - Deleting a battery/node left its grid/voxel preview on the canvas (stale).
    Root cause: `useNodePreviews` only refreshed on `exec:completed`, and its
    staleness GC (`retainPreviewLayers` / `retainVoxelNodes`) only runs inside
    `refresh()`. Deleting a node with no downstream triggers NO execution, so
    `refresh()` never ran and the orphaned layer was never pruned.
  - Fix: also subscribe to the `graph` channel and re-run `refresh()` on
    `graph:applied`. The backend emits `graph:applied` on every `applyBatch`
    (Layer-2 `apply-batch`) and forwards it over WS, so the renderer iframe
    (subscribed to `graph`/`execution`/`asset`) now re-runs the GC on any graph
    mutation: `listNodes()` is the post-mutation source of truth, so a deleted
    node's grid preview AND voxel layer are both evicted, and a node that loses
    its renderable output (disconnect → empty output) is cleared via the existing
    empty-output `clearLayers` / `retainPreviewLayers` paths. This is the faithful
    analog of the legacy eviction (`removePreviewLayer` + `clearLayers` on the
    `preview:change {remove:true}` delete path, and `clearStale*` on full-exec).
  - Bursts (a delete that also re-executes downstream) are coalesced via a 30ms
    debounce with a single-in-flight guard, so redundant refetches are avoided
    without sacrificing correctness. Live grid-preview-on-connect and the
    editor-selection highlight are unaffected (connect also fires `graph:applied`
    → re-projects; selection is a separate store field/channel).
- **Node editor wire data-probe + annotation parity (kernel)**.
  - Bump kernel submodule to `112c407`: the wire **data-probe** (`ProbeEdge`),
    port tooltips and preview nodes again show real per-connection data. The probe
    reads per-port values from the editor's `nodeOutputs` cache, but nothing
    populated that cache for server-executed nodes (only client-side AI nodes wrote
    to it), so probes rendered the type badge with an empty value. The legacy editor
    fed the cache from a bespoke WS `NODE_OUTPUT` push; the kernel now sources the
    same data through the generic `ApiClient.getNodeOutput(nodeId, portId)`:
    `subscribeLiveSync` listens for `node:output` (fetch + cache the value) and
    `exec:completed` (refresh every connected source port), and a new
    `refreshConnectedOutputs()` seeds the cache from the backend's retained values
    on load and after each graph mutation — so probes update after execution like
    the legacy. Fix lives entirely in the shared kernel editor and stays
    domain-agnostic (the scene-generator host already serves `getNodeOutput` via
    `/api/v1/nodes/:id/outputs/:portId`).
  - Same bump closes a canvas **annotation** parity gap: sticky-note annotations are
    now rebuilt by `buildCanvasNodes` (so they survive a live-sync refetch / reload
    instead of vanishing), and their drag (`moveAnnotation`) and delete
    (`removeAnnotation`) are routed to the store rather than dropped or mistaken for
    graph nodes. Other legacy canvas behaviours (edge colour-by-port-type, marquee
    multi-select with Full/Partial direction, copy/paste, groups + group-view,
    frames, snap guides, ctrl-drag duplicate, double-click search popover, node /
    selection context menus, preview toggle) were already faithfully present and
    needed no change.
