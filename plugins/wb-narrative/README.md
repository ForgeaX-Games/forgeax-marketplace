# narrative-studio

AI 驱动的游戏叙事内容生成管线。支持 **双层路由**（Tier + Mode）+ **Planner 动态选步**，自动适配不同游戏品类的叙事需求深度，覆盖 117 个品类、9 种管线模板、29 种执行模式、6 种叙事原型。

**两条输入路径，同一套生成内核**：

1. **从需求生成**（主路径）——用户一句话需求 → Tier/Mode 路由 + Planner 组装 → D0-D4 策划 + 叙事管线，从零创作。本文档大部分篇幅描述这条路径。
2. **IP DNA 改编生成**（输入侧）——上传已有 IP 作品（小说 / 漫画 / 视频）→ 标准化建树 + scoped 提取"叙事 DNA" + 改编规划裁剪 → 复用同一套生成管线产出可玩叙事。见 [IP DNA 改编生成](#ip-dna-改编生成)。

## 目录

- [快速开始](#快速开始)
- [项目架构](#项目架构)
- [管线模板与模式](#管线模板与模式)
- [管线步骤详解](#管线步骤详解)
- [IP DNA 改编生成](#ip-dna-改编生成)
- [设计思想（tpl-rpg）](#设计思想tpl-rpg)
- [可视化特性](#可视化特性)
- [API 参考](#api-参考)
- [部署](#部署)
- [跨模块数据访问](#跨模块数据访问)
- [技术栈](#技术栈)
- [源文件结构](#源文件结构)

---

## 快速开始

### 前置条件

- Node.js 20+
- `GEMINI_API_KEY`（Google AI Studio 申请：https://aistudio.google.com/apikey）

### 方式一：CLI 命令行

```bash
git clone <git-host>:<org>/narrative-studio.git
cd narrative-studio
npm install
export GEMINI_API_KEY=your_key_here

# 自动识别品类生成
npx tsx src/cli.ts "做一个像原神的开放世界RPG"

# 指定 Tier（休闲游戏一步生成）
npx tsx src/cli.ts --tier=tier4 "做个贪食蛇"

# 指定 Mode（只生成到小说深度）
npx tsx src/cli.ts --tier=tier1 --mode=novel "赛博朋克复仇故事"

# 查看所有可用 Tier/Mode
npx tsx src/cli.ts --list-modes
```

生成结果保存在 `output/` 目录下。

### 方式二：后端 API + 前端可视化

```bash
git clone <git-host>:<org>/narrative-studio.git
cd narrative-studio
npm install
export GEMINI_API_KEY=your_key_here

# 终端 1：启动后端 API
npx tsx src/api/server.ts
# → http://localhost:8900

# 终端 2：启动前端可视化
cd viz
npm install
npm run dev
# → http://localhost:5176
```

打开 http://localhost:5176 即可使用完整的可视化界面：
- 左侧面板：选择 Tier/Mode、输入需求、控制复杂度
- 右侧预览：文本模式 / 节点模式（React Flow 剧情树可视化）
- 实时进度：管线步骤状态 + 节点生长动画

### 方式三：作为 npm 库引用

```typescript
import { NarrativePipeline } from "narrative-studio";

const pipeline = new NarrativePipeline({
  apiKey: process.env.GEMINI_API_KEY!,
  tier: "tier4",
  onProgress: (p) => console.log(`[${p.step}/${p.totalSteps}] ${p.message}`),
});

const result = await pipeline.run("做个贪食蛇");
console.log(result.narrative_card?.game_name);
```

### 环境变量

```bash
GEMINI_API_KEY=your_key             # 必须 — Google AI Studio API key
LLM_PROXY_URL=http://...:10007      # 可选 — 内部 LLM 代理地址（部署时使用）
NARRATIVE_MODEL=gemini-2.5-pro      # 可选，默认 gemini-2.5-pro
NARRATIVE_PORT=8900                 # 可选，API 端口
NARRATIVE_AGENT_DEBUG=1             # 可选，打印 universal-agent plan/eval 详情
```

#### IP DNA / RAG 向量检索（蓝图 §7.1）

IP DNA 改编生成的算子检索默认走 `knowledge_base/`（`embeddings.npy` + `methods_3_converted.jsonl` + `retrieval_config.json`）。
查询向量化器按优先级解析：**HTTP 端点 > 本地 e5(transformers.js) > ONNX**；都未配置时静默降级为 `scope+tag`
关键词检索（corpus 仍可用，不抛错）。CLI 与后端 API（`/api/narrative/ip-dna/start`）经同一 helper
（`resolveIpDnaRuntimeAdapters`）注入，行为一致。

```bash
# 三选一启用 vector 通道（不配则自动 scope+tag 降级）：
NARRATIVE_EMBED_URL=http://...:9100/embed   # 首选 — 本地嵌入 HTTP 端点
NARRATIVE_EMBED_MODEL=intfloat/multilingual-e5-small  # 可选 — HTTP 端点用模型名
NARRATIVE_EMBED_DIM=384                      # 可选 — 向量维度校验
NARRATIVE_EMBED_MODEL_DIR=/path/to/e5        # 本地 e5 模型目录（覆盖 retrieval_config.model_path_local）
NARRATIVE_EMBED_ONNX=/path/to/model.onnx     # ONNX 备选（onnxruntime-node）
FFMPEG_PATH=ffmpeg                           # 可选 — 视频抽帧/压缩 ffmpeg 路径（默认取 PATH）
ASR_ENDPOINT=http://127.0.0.1:9000/asr       # 可选 — 本地 ASR HTTP 端点（视频音轨转写；缺省则不转写）
PDFTOPPM_PATH=pdftoppm                        # 可选 — PDF 拆页 poppler pdftoppm 路径（默认取 PATH）
```

> 本地 e5 模型目录缺省取 `knowledge_base/retrieval_config.json` 的 `model_path_local`，开箱即用。

---

## 项目架构

```
用户输入
  │
  ├── Tier 路由（品类识别 → tier1/2/3/4 + genre_code）
  │
  ├── 管线组装（三选一，优先级从高到低）
  │     ├── ① 品类 skill 声明了 narrativeSteps → 直接采用（前置三步 + 该品类专属链）
  │     ├── ② 品类有 pipelineTemplate → 取对应 PIPELINE_PRESETS 预置链
  │     └── ③ 兜底：按 needs 9 维矩阵 + 叙事原型动态选步（selectStepsByNeeds）
  │           入口：src/pipeline/planner/index.ts:planPipeline()
  │
  ├── Mode 路由（深度/范围选择，可被 target_endpoint 截断）
  │
  └── Pipeline 执行（两条执行路径）
        ├── 默认 run()           ：旧 step 函数 ALL_STEPS 逐步执行
        └── runWithBlueprint()   ：assembleBlueprint 预组装 → AgentDef + AgentRunner
              （use_blueprint=true 时启用；未迁移的 step 回退 legacy step fn）

输出：叙事资产 + manifest.json + _checkpoint.json
```

> **组装与执行解耦**：`planPipeline()` 只决定"跑哪些 step、什么顺序"，`assembleBlueprint()` 把这些 step 物化成可执行蓝图（每个 step 绑定一个 `AgentDef` + 对应的 `AgentRunner`）。当前默认仍走 `run()` 旧路径；Blueprint 是新执行内核，按 step 逐个迁移中。

### 核心抽象

| 抽象 | 实现位置 | 作用 |
|------|---------|------|
| **Planner 引擎** | `src/pipeline/planner/index.ts:planPipeline` | 管线组装中枢。按 `narrativeSteps → pipelineTemplate 预置 → needs 规则` 三级优先级决定 step 序列；依赖 `planner/{presets,needs-rules,dependency-graph}.ts` |
| **Blueprint** | `src/pipeline/blueprint/assembler.ts:assembleBlueprint` | 把 Planner 选出的 step 物化为可执行蓝图（`PipelineBlueprint` / `StepBlueprint`），每步绑定 `AgentDef`。类型见 `blueprint/types.ts` |
| **AgentDef / AgentRunner** | `src/pipeline/blueprint/{agent-def-registry,runners/}` | 声明式 Agent 定义 + 5 种结构 Runner（single-turn / chunked / sequence / conditional / deterministic）。Blueprint 的执行内核 |
| **叙事原型 Archetype**（6 种） | `src/knowledge/game-narrative/skills/archetype-shared/*.md` | epic / branching / fragmented / emergent / lightweight / micro。`skill-loader.ts:getArchetypeForGenre` 按品类映射，作为缺省 step 链与提示词的共享基底 |
| **narrativeSteps** | `skill-types.ts` + `narrative-steps-defaults.ts` | 品类 skill 可声明专属 step 链（`deriveNarrativeSteps` 按 archetype+needs 派生）；`ensurePlotChainForConsumers` 在含 quest/script 但缺 plot 时自动回填情节脊柱 |
| **Pipeline Template**（9 种） | `src/pipeline/templates.ts` | 描述某品类家族的标准 step 序列形态（Planner 的二级回退）。Genre → Template 的映射在 `genre-taxonomy.ts:GENRE_TEMPLATE_OVERRIDES` |
| **Mode**（29 种） | `src/pipeline/modes.ts` | 在 Template 之上叠加"截断点"（target_endpoint），形成具体的执行计划 |
| **Universal Agent** | `src/pipeline/universal-agent/runner.ts` | 单步内的 Plan → Execute → Evaluate 三段式。注意：是**单步内**三段，不是整管线三步 |
| **Adaptive Capability** | `src/pipeline/universal-agent/chunked-capability.ts` | 同一 capability 同时承载短剧（single-shot LLM）与长剧（chunked 分幕循环）。运行时按 `target_acts` 自动路由 |
| **PromptComposer** | `src/pipeline/prompt-composer.ts` | 把 baseline prompt + skill 注入 + 上下文 slots 组装成最终 system/user prompt。vn-v2 各步已全面接入 |
| **Skill 加载** | `src/knowledge/game-narrative/skill-loader.ts` | 按 `(genreCode, stepId)` 查 skill；优先级：ts skill → md fallback → archetype → null。`long-tail-genres.ts` 启动时为全部品类补齐 stub/策划 step |
| **截断保护** | `src/pipeline/llm-client.ts:assertJsonNotTruncated` | 对所有 `responseFormat="json"` 的调用自动检测括号配平，截断时由 `callWithRetry` 自动 3 次重试 |

### 三种运行模式（Run Mode）

每次 pipeline 启动属于以下三种模式之一，前端按模式不同渲染策略：

| Mode | 触发 | 后端行为 | 前端渲染策略 |
|------|------|---------|------------|
| `start` | 从零开始 | 写新目录、跑全量 step | 节点按 `step_start/step_done` 增量出现（一步一步亮起） |
| `resume` | 断点续传 | 读 `_checkpoint.json`，从 `lastCompletedStep` 之后接着跑 | 已完成的常亮 + 后续增量 |
| `fork` | 重新生成（编辑后） | LLM 影响面分析 → 复制目录 → 仅重跑受影响 step（支持 nodeFilter 节点级重跑） | 全量预填：未受影响=绿色保留；受影响=灰色待重跑（"Git-like 分叉"） |

**Git-like 分支模型**：每次 fork 都新建独立目录，原 run 不变，可以无限分叉。`POST /api/narrative/analyze-impact` 由 LLM 判断"哪些下游 step 需要重跑"，规则参考 `src/pipeline/impact-validator.ts`。

### LLM 调用约束

- **MODEL_OUTPUT_MAX_TOKENS = 65536** — Gemini 2.5 Flash/Pro 单次输出物理硬顶，全代码库统一引用
- **callWithRetry** — 自动 3 次重试 + 指数退避 + 单次 300s 超时
- **JSON 截断保护** — `responseFormat="json"` 调用自动跑 `assertJsonNotTruncated` 检测括号配平，截断时自动重试并把错误回灌给 LLM
- **chunked 长剧** — `createAdaptiveCapability` 在 `target_acts ≥ 2` 时切到分幕循环，每幕独立 LLM 调用 + 跨幕一致性检查 + merge

---

## 管线模板与模式

### 双层路由系统

| 层 | 作用 | 决策方式 |
|----|------|---------|
| **Tier 路由** | 识别游戏品类，确定叙事强度等级 | 自动品类识别（LLM/关键词）或用户手动指定 |
| **Mode 路由** | 在 Tier 内选择生成深度/范围 | 用户手动选择或使用 Tier 默认值 |

### Tier 分级

所有 Tier 均先执行 D0-D4 策划管线，再根据叙事强度执行不同深度的叙事管线。默认模式为 `design_auto`（策划完成后根据需求矩阵动态选择叙事步骤）。

> **关于 Lore**：Lore 已**集成进通用叙事 agent 内部**，按 `needs.L` 维度由 capability 在世界观/角色/道具/剧情等步骤中内嵌产出，**不再独立成 step**。

| Tier | 名称 | 叙事占比 | 策划步骤 | 叙事深度 | 典型品类 |
|------|------|----------|---------|---------|---------|
| **Tier 1** | 叙事驱动型 | 70-95% | D0-D4 | L0-L5 全量 + 道具 + 任务 + 场景（Lore 内嵌） | JRPG, CRPG, AVG, 互动影游, 开放世界RPG |
| **Tier 2** | 叙事增强型 | 40-70% | D0-D4 | L0-L2 故事结构 + 角色 + 道具（Lore 内嵌） | ARPG, 抽卡RPG, 战棋, 生活模拟 |
| **Tier 3** | 叙事点缀型 | 15-40% | D0-D4 | 世界观 + 角色 | 塔防, RTS, MOBA, 竞速, 卡牌 |
| **Tier 4** | 无叙事型 | 0-15% | D0-D4 | 叙事卡（一步生成） | 三消, 跑酷, IO, 超休闲 |

### Pipeline Templates（9 种）

`src/pipeline/templates.ts` 定义。Genre → Template 通过 `GENRE_TEMPLATE_OVERRIDES` 显式映射，未列出的按 tier 默认（tier4 → narrative-card / tier3 → light / tier1-2 → rpg）。

| Template ID | 标签 | 适用品类（典型） | 默认 step 序列 |
|-------------|------|------------------|----------------|
| `tpl-rpg` | RPG 标准管线 | JRPG / CRPG / ARPG / 抽卡 / 仙侠 | 偏好 → 初步方案 → 世界观 → 角色 → 道具 → L0 → L1 → L2 → L3 → L4 → [L5∥场景] |
| `tpl-vn` | [已废弃] 视觉小说 v1 | — | 偏好 → 初步方案 → 世界观 → 角色 → 分支树 → 对话脚本（仅兼容历史数据，新项目请用 tpl-vn-v2） |
| `tpl-vn-v2` | 互动影游 v2（专属管线） | adv-interactive | Logline → 三幕扩写 → 世界观(借用) → 场 → 情节点 → 剧情树改造 → 剧本 → 分镜。上传剧本时 E2 旁路替换 E1 中下层 |
| `tpl-open-world` | 开放世界 RPG | rpg-open-world | 偏好 → 初步方案 → 世界观 → region_design → 角色 → emergent_event |
| `tpl-card-game` | 卡牌游戏叙事 | card-ccg / card-narrative / card-dbg / card-boardgame | 偏好 → 初步方案 → 世界观 → card_lore → event_pool |
| `tpl-fragmented` | 碎片化叙事 | Souls-like / Metroidvania / 心理恐怖 | 偏好 → 初步方案 → 世界观 → 角色 → 道具 → 场景 |
| `tpl-emergent` | 涌现性叙事 | 4X / 沙盒 / 模拟经营 | 偏好 → 初步方案 → 世界观 → 角色 → emergent_event |
| `tpl-narrative-card` | 叙事卡（Tier4） | 全部 tier4 品类 | narrative_card（一步生成） |
| `tpl-light` | 轻量管线（Tier3） | tier3 大部分品类 | 偏好 → 初步方案 → 世界观 → 角色 |

Skill 可通过 frontmatter 的 `enableSteps` 激活模板的 `optionalSteps`（例：`adv-interactive` skill 激活 `cinematic_storyboard` 步骤）。

### Mode 列表（29 种）

`src/pipeline/modes.ts` 中 `MODE_CONFIGS` 完整定义。每个 Mode 标注 `(pipeline_template, target_endpoint)` 二元组实现"模板形态 × 停止点"的正交分解。

<details>
<summary>纯叙事模式（按 RPG 链路深度递进）</summary>

| Mode | 标签 | 适用 Tier | 截断点 |
|------|------|----------|--------|
| `initial_outline` | 初步方案 | tier1-3 | initial_plan |
| `worldview` | 世界观 | tier1-3 | worldview |
| `character` | 角色档案 | tier1-2 | character_enrichment |
| `item_lore` | 道具 | tier1-2 | item_database |
| `story_framework` | 故事框架 (L0) | tier1-2 | story_framework |
| `story_outline` | 故事大纲 (L1) | tier1-2 | outline_batch |
| `detailed_outline` | 故事细纲 (L2) | tier1-2 | detailed_outline |
| `novel` | 情节 (L3) | tier1-2 | plot_generation |
| `script` | 剧本 (L4) | tier1 | script_generation |
| `quest` | 任务 (L5) | tier1 | quest_generation |
| `full` | 全量生成 | tier1 | （含 quest∥scene） |
| `scene` | 场景生成（任务 + 场景节点） | tier1-2 | scene_generation |

</details>

<details>
<summary>风格化叙事模式（不同 Pipeline Template）</summary>

| Mode | 标签 | 适用 Tier | Pipeline Template |
|------|------|----------|-------------------|
| `vn_full` | 影游 v2 全量（9 步专属管线） | tier1-2 | tpl-vn-v2 |
| `vn_script` | 影游剧本（止于 G-02 剧本创作） | tier1-2 | tpl-vn-v2 |
| `vn_storyboard_mode` | 影游分镜（含 G-03 分镜设计） | tier1-2 | tpl-vn-v2 |
| `fragmented` | 碎片化叙事（环境+物品驱动） | tier1-3 | tpl-fragmented |
| `emergent` | 涌现叙事（事件模板+世界框架） | tier2-3 | tpl-emergent |
| `card_narrative` | 卡牌叙事单品（卡面叙事+事件池） | tier1-3 | tpl-card-game |
| `open_world_narrative` | 开放世界叙事单品（区域+涌现事件） | tier1-2 | tpl-open-world |
| `narrative_auto` | 自动（根据品类需求动态组合叙事） | tier1-4 | 由 Planner 按 needs/genre 动态决定 |

</details>

<details>
<summary>Tier 直通模式</summary>

| Mode | 标签 | 适用 Tier | Pipeline Template |
|------|------|----------|-------------------|
| `tier2_enhanced` | Tier2 增强管线（道具 + 细纲） | tier2 | tpl-rpg |
| `tier3_basic` | Tier3 基础管线（世界观+角色+UI） | tier3 | tpl-light |
| `narrative_card` | Tier4 叙事卡（极简一步生成） | tier4 | tpl-narrative-card |

</details>

<details>
<summary>策划+叙事联合 Mode（design_* 前缀，UI 默认入口）</summary>

| Mode | 说明 |
|------|------|
| `design_auto` | **默认**：D0-D4 策划 → `narrative_requirements.needs` + `genreCode` 动态选择叙事步骤 |
| `design_full_narrative` | D0-D4 策划 → 全量叙事（tpl-rpg full） |
| `design_vn_full` | D0-D4 策划 → 影游 v2 全量（tpl-vn-v2） |
| `design_fragmented` | D0-D4 策划 → 碎片化叙事 |
| `design_emergent` | D0-D4 策划 → 涌现叙事 |
| `design_only` | 仅 D0-D4 策划（不进入叙事管线） |

</details>

### 品类知识库

内置 **117 个游戏品类** 的结构化数据，定义在 `src/knowledge/genre-taxonomy.ts:GENRE_TAXONOMY`，涵盖 15 个大类。

```typescript
interface GenreEntry {
  code: string;              // e.g. "rpg-jrpg"
  name: string;              // 中文显示名
  tier: TierId;              // tier1 / tier2 / tier3 / tier4
  category: GenreCategory;   // 15 大类之一（前端折叠分组用）
  narrative_ratio: string;   // e.g. "60-85%"
  needs: Record<string, 0 | 1 | 2 | 3>;   // W/C/S/D/Q/E/I/U/L 9 维需求评级
  keywords: string[];        // 关键词识别（LLM/正则双路径）
  narrative_type: NarrativeType;          // linear/branching/fragmented/emergent/minimal
  pipelineTemplate: PipelineTemplateId;   // 9 个模板之一
}
```

- **needs 9 维**：W=世界观, C=角色, S=剧情结构, D=对话, Q=任务, E=环境叙事, I=物品, U=UI 文案, L=Lore；3=核心必需，2=重要推荐，1=可选点缀，0=不需要
- **narrative_type**（5 值）：`linear / branching / fragmented / emergent / minimal`（`operational` 已移除，原运营类品类按玩法重映射，如 MMORPG→linear、SLG→emergent、Roguelike→fragmented、MOBA/格斗→minimal）
- **narrative_type → 兜底模板**：`fragmented → tpl-fragmented`，`emergent → tpl-emergent`，`minimal → tpl-light`，其它 → `tpl-rpg`
- **品类 → 模板的显式映射** 在 `genre-taxonomy.ts:GENRE_TEMPLATE_OVERRIDES`，未列出的按 `tier` 默认（tier4 → tpl-narrative-card / tier3 → tpl-light / tier1-2 → tpl-rpg）
- **Tier4 预设**：内置 **22 个休闲品类预设** + 1 个通用兜底（`src/knowledge/game-narrative/tier4-presets.ts`）

---

## 管线步骤详解

### 策划管线（D0-D4，所有 Tier 共用）

| # | 步骤 | 输出 | 说明 |
|---|------|------|------|
| D0 | 核心概念 | core_concept | 游戏核心玩法循环 + 品类定位 |
| D1 | 系统架构 | system_architecture | 6 个一批并行生成系统模块 |
| D2 | 玩法设计 | system_detail | 各系统模块细化（6 个一批） |
| D3 | 数值框架 | value_framework | 经济/成长/难度曲线 |
| D4 | 策划案整合 | design_doc + narrative_requirements | 合并为完整策划案 + 叙事需求矩阵 |

> D4 完成后，`design_auto` 模式根据 `narrative_requirements.needs` 矩阵（9 维评分：W/C/S/D/Q/E/I/U/L）动态组合叙事步骤。

### 叙事管线 — 通用前置（所有非 Tier4 模板共用）

| # | 步骤 | 输出字段 | 说明 |
|---|------|---------|------|
| 1 | `preference_summary` | user_preference_summary | 故事主题/风格基调/核心要素提取 |
| 2 | `preference_analysis` | user_preference_analysis + global_control_params | 42 维度槽位映射 + 全局控制参数 (complexity/deviation) |
| 3 | `initial_plan` | **initial_story_outline + core_settings + plot_synopsis**（合并步骤） | 单步一次性产出三个子字段。输出为 JSON，前端聚合为 InitialPlanView |
| 4 | `worldview` | worldview_structure | 基础架构层 + 交互叙事层（仅 W ≥ 1 时启用） |

### 叙事管线 — tpl-rpg（L0-L5 完整链路）

| # | 步骤 | 输出字段 | 核心机制 |
|---|------|---------|----------|
| 5 | `character_enrichment` | detailed_character_sheets | 角色丰化与弧光设计（C ≥ 2 启用） |
| 6 | `item_database` | item_database | 资源型道具数据库（I ≥ 2 启用） |
| 7 | `story_framework` | story_framework | L0 两步走（规划 → 修复 → 填充）+ 命运必然论 |
| 8 | `outline_batch` | outlines_generated + l1_validation | L1 四步走 + 六步连接修复链；**L1 结构验证已合并进本步内部** |
| 9 | `detailed_outline` | detailed_outlines_generated + l2_validation | L2 四步走（同 L1）+ 六步连接修复链；**L2 验证内嵌** |
| 10 | `plot_generation` | plots_generated + l3_validation | L3 拓扑分层执行（分支并行 + 主线串行）+ 三重约束 + 角色连续性验证 + jrpg_elements |
| 11 | `script_generation` | jrpg_script | L4 拓扑分层执行 + 滑动窗口上下文 + 剧本：7 种 content 类型 + 冲突结构 |
| 12∥13 | `quest_generation` ∥ `scene_generation` | quest_graph + scene_map | L5 任务（6 节点一批并行）∥ 场景（三阶段：骨架 → 展开 → 合并）。`full` 模式下两者并行，是 tpl-rpg 链路终点 |

<details>
<summary>tpl-vn-v2 后续步骤（互动影游 v2 专属管线）</summary>

**E1 主路径**（无上传剧本，从零创作）：

| # | 步骤 | 输出字段 | 说明 |
|---|------|---------|------|
| 1 | `vn_logline` | vn_logline | E1-01 一句话故事梗概（Logline） |
| 2 | `vn_outline_acts` | vn_outline_acts + vn_character_bios + vn_key_items | E1-02 三幕扩写：三幕大纲 + 全员人物小传 + 贯穿剧情关键道具（**单步三输出**，一次 LLM 调用产出三份子结构，伴生落盘 V1a/V1b） |
| 3 | `worldview` (借用) | worldview_structure | 借用通用世界观步骤，已注入 vn_logline / vn_outline_acts / vn_character_bios 上下文 |
| 4 | `vn_scenes` | vn_scenes | E1-03 场搭建（三维状态变化 / H-B-O 结局分类） |
| 5 | `vn_beats` | vn_beats | E1-04 情节点搭建（线性，每场内按顺序排列） |

**G 路径**（剧本游戏化改造）：

| # | 步骤 | 输出字段 | 说明 |
|---|------|---------|------|
| 6 | `vn_branched_beats` | vn_branched_beats | G-01 剧情树改造：添加分支拓扑 + 双轨 QTE |
| 7 | `vn_screenplay` | vn_screenplay | G-02 剧本创作：按场分块调用 LLM |
| 8 | `vn_storyboard` | vn_storyboard + vn_video_prompts | G-03 分镜设计：按场分块，含镜头参数/景别/运镜/AI 视频生成提示词 |

**E2 旁路**（上传剧本时自动替换 E1 中下层步骤）：

| # | 步骤 | 输出字段 | 说明 |
|---|------|---------|------|
| E2-01 | `vn_script_normalize` | vn_script_normalized | 用户剧本预处理：格式规范化 + 幕/场/情节点推断 |
| E2-02 | `vn_segment_confirm` | vn_segment_confirmed + vn_character_bios | 影游化文本段确认：分段验证 + 人物小传抽取 |

> E1 与 E2 互斥：`has_uploaded_script=true` 时将 E1 中下层替换为 E2，之后从 `vn_branched_beats` 汇合。

</details>

<details>
<summary>tpl-vn 后续步骤（[已废弃] 视觉小说 v1）</summary>

| # | 步骤 | 输出字段 | 说明 |
|---|------|---------|------|
| 5 | `character_enrichment` | detailed_character_sheets | 同 tpl-rpg |
| 6 | `branch_tree` | branch_tree | 分支树：网状汇流 + ≥4 结局。**Adaptive Capability** 自动判断短/长剧 |
| 7 | `dialogue_script` | dialogue_script | 对话脚本：每节点 12-30 行台词 |
| 8 | `cinematic_storyboard` *(可选)* | cinematic_storyboard + video_prompts | 分镜 + QTE。由 skill `enableSteps` 激活 |

</details>

<details>
<summary>其它模板的特有步骤</summary>

| 模板 | 模板专属步骤 | 输出字段 |
|------|------------|---------|
| `tpl-open-world` | `region_design` → ... → `emergent_event` | regions / emergent_events |
| `tpl-card-game` | `card_lore` → `event_pool` | card_lore / event_pool |
| `tpl-fragmented` | `character_enrichment` → `item_database` → `scene_generation` | （同名输出）|
| `tpl-emergent` | `character_enrichment` → `emergent_event` | emergent_events |
| `tpl-narrative-card` | `narrative_card`（一步生成） | narrative_card |
| `tpl-light` | `character_enrichment`（世界观 + 角色） | （同名输出）|

</details>

<details>
<summary>步骤 ID 对照表（磁盘序号 + 层级）</summary>

| 步骤 ID | 中文标签 | 层级 | 磁盘序号 |
|---------|---------|------|---------|
| `preference_summary` | 偏好总结 | 前置 | 00 |
| `preference_analysis` | 偏好分析 | 前置 | 01 |
| `initial_plan` | 初步方案 | 前置 | 02-05 |
| `worldview` | 世界观构建 | 前置 | 04 |
| `character_enrichment` | 角色档案 | L0 | 09 |
| `item_database` | 道具清单 | L0 | 10 |
| `story_framework` | L0 故事框架 | L0 | 06 |
| `outline_batch` | L1 故事大纲 | L1 | 07 |
| `detailed_outline` | L2 故事细纲 | L2 | 08 |
| `plot_generation` | L3 情节生成 | L3 | 11 |
| `script_generation` | L4 剧本生成 | L4 | 12 |
| `quest_generation` | L5 任务生成 | L5 | 13 |
| `scene_generation` | 场景生成 | L5 | 14 |
| `narrative_card` | 叙事卡 | T4 | 17 |

> **V3 变更要点**：`quest_generation` 与 `scene_generation` 在 `full` 模式下并行执行（`Promise.all`）。`structure_validation_l1/l2` 已合并进父步骤内部。`scene_generation` Phase 1 改为 L0→L1→L2 串行增量提取。`COMPLEXITY_NODE_BUDGET` 控制 L0/L1/L2 每层硬上限，前端选择优先于 LLM 输出。

</details>

---

## IP DNA 改编生成

**定位**：与"从需求生成"平行的第二条输入路径。用户上传已有 IP 作品（小说 / 漫画 / 视频 / 压缩包 / 混合模态），系统把它标准化为层级化的"最小叙事单元树"，逐层提取结构化的**叙事 DNA**（角色 / 场景 / 事件 + 叙事方法"三件套"），经改编范围裁剪后，**复用同一套生成管线**（`pipeline.run`）产出可玩游戏叙事。全程以同一 `story_timestamp` 为主键，`input/` 与 `output/` 同名关联，落盘可续跑。

实现位于 `src/ip-dna/`，编排入口 `orchestrator.ts:runIpDnaPipeline`；LLM 均以"接缝(seam)"注入——无 API key 时走确定性兜底，离线 dry-run 也能跑通整链（不抛错）。

### 相位总览

| 相位 | 实现 | 职责 |
|------|------|------|
| **Phase 0 · 输入地基** | `phase0-foundation.ts` / `phase0-compress.ts` | 多模态分家归档到各媒体 `*_original`、生成《用户资产参考清单》；压缩包/PDF 展开、媒体压缩（720p / 抽帧）|
| **Phase 1 · 标准化** | `phase1-understanding.ts` / `phase1-multimodal.ts` / `noise-filter.ts` / `unit-identity.ts` | 建**轻量层级树**（部/卷→章→最小单元）、多模态转写为叙事文本、干扰项过滤、体量水准线评估。详见下方 |
| **Phase 2 · scoped 提取** | `phase2-extract.ts` | 按最小叙事单元切片，自底向上逐层聚合出"三件套"（角色/场景/事件 + 方法）模板 |
| **Phase 2b/2c · 改编规划** | `phase2b-adapt.ts` / `phase2c-gen-adapt.ts` | 改编范围裁剪（全量/局部）、游戏单元划分（超体量成系列）、A→B 映射到目标生成管线 |
| **Phase 3 · 算子装备** | `phase3-rag.ts` / `phase3-vector.ts` / `phase3b-kag.ts` | 从 `knowledge_base/` 检索叙事方法算子（vector / scope+tag / KAG），装备到生成输入 |
| **Phase 4/5 · 精修** | `phase4-rewrite.ts` / `phase5-polish.ts` | 忠实改写与产物润色 |

### Phase 1 标准化（含最近修复项）

标准化是 Phase 1 的一小步骤集合，把"杂乱上传"收敛为可提取的规范层级树：

- **层级建树**：多文件/卷目录按结构建多层树（打包目录自动剥离），单文件散文扫标记或整篇成一单元；"看结构不看名字"——文件名叫法只决定标题，层级抽象由结构决定。
- **多模态转写**：图片/视频统一转写为带边界的层级化叙事文本，汇入同一条文本主链。
- **真实叙事序号 + 去重**（`unit-identity.ts`）：从标题/文件名提取真实序号（`第八章_一场戏` → `8_《第八章_一场戏》`，支持中文简繁体/S01E03/第N话/页码），同序号重复单元保留末次去重。
- **干扰项过滤**（`noise-filter.ts`）：剔除引言/序/作者感言/求月票/公告等非正文，保留后记/番外等特殊章节。
- **体量水准线**：按媒体维度（小说字数/漫画页数/视频时长）评估是否需拆解/系列化。

### 半自动阶段门（前端交互）

前端 `IpStageFlow` 逐步驱动，每步落盘、可中断续跑：

```
上传 → ingest（标准化+建树）→ [体量抉择] → (decompose 再标准化) →
confirm-scope/units（改编范围+游戏单元）→ extract（scoped IP DNA）→ generate（下游生成）
```

自动模式（`/ip-dna/start`）则一路走默认（全量改编 + 按体量定档），无逐步确认。IP DNA 相关 REST 端点见 [API 参考](#api-参考)。

---

## 设计思想（tpl-rpg）

> **适用范围**：本节描述 **tpl-rpg 标准管线** L0-L5 流程的核心设计原则。其它 Pipeline Template 有各自的工作模式，不全部适用。

### 核心定位

不是"讲故事"，而是"创造可玩的游戏叙事体验"。输出必须满足下游管线（任务/场景/NPC/物品）的数据需求——角色、道具、场景、剧本、故事线都是可执行的游戏资产，而非纯文学产物。node_id（结构定位）与 content_id（内容标识）双轨并行，确保结构层可视化和内容层下游兼容。

### 牵一发而动全身

修改任一节点时，LLM 分析其影响面（同层后续节点 + 所有子层级后代），自动标记需要级联重跑的范围。例如修改 L0 节点 1，会触发所有以 `1_` 开头的 L1/L2 节点及其下游 L3/L4/L5 重新生成，确保结构一致性从修改点向下完整传播。这也映射了叙事本身的规律——突如其来的变故会沿因果链向下扩散，影响所有后续情节走向。

### 命运必然论

- L0 框架层预设所有可能的命运分支和结局
- 下层（L1/L2/L3）不能动态创建新结局
- 故事结构的"大命运"在 L0 就已确定
- 最优路径选择时优先选择 'a' 分支（主线）

### 有限突变论

- 每层可产生独立新分支（Y 轴细化）
- 新分支要么在本层聚合，要么路由到 L0 预设分支
- 细节层面的变化不影响整体命运
- 突变路由不受三重约束管控（是上层机制）

### 双维度嵌套细化

- X 轴（顺序维度）：将上层 1 个节点拆解为 N 个连续子节点
- Y 轴（可能性维度）：在层内独立产生新分支
- L1 和 L2 共用完全相同的细化逻辑

### 两步走与多步走机制

结构层（L0/L1/L2）将 LLM 生成分为多个阶段，确保结构先行、内容后填：

| 层级 | 机制 | 步骤 |
|------|------|------|
| **L0** | 两步走 | Step 1: LLM 规划结构骨架 → Step 1.5: 连接修复 + 拓扑验证 → Step 2: LLM 填充内容 |
| **L1** | 四步走 | Step 1: LLM 规划子节点数 + 分支决策 → 代码构建骨架 → Step 1.5a: 六步连接修复链 → Step 1.5b: 按父节点分组 LLM 填充 → Step 2: 全局补漏 |
| **L2** | 四步走 | 同 L1，以 L1 节点为父节点 |

核心约束：**代码保持骨架不变，LLM 只能在骨架结构内填充内容。**

<details>
<summary>Step 1.5a 六步连接修复链（L1/L2 共用）</summary>

1. **跨父连接推断**（`inferCrossParentConnections`）— 基于 `extractFullBranchPath` + `areBranchesCompatible` 按分支路径路由
2. **组内结构修复**（`repairGroupConnections`）— 同父节点组内的顺序/分支连接修复
3. **悬挂分支修复**（`fixDanglingBranches`）— 无 next 的非末位分支节点 → 路由到兼容框架分支或标记 ENDING
4. **NvN 路由精炼**（`fixNvNRouting`）— 多出口→多入口精确匹配（1×N / N×1 / N×N 三种模式）
5. **跨分支过滤**（`filterCrossBranchConnections`）— 清理不兼容的跨分支连接
6. **双向一致性**（`ensureBidirectionalConsistency`）— 确保 next_node ↔ prev_node 对称

</details>

### 质量保证体系

**结构验证**（L1 后 + L2 后各执行一次）：
- **环路检测**（`detectCycles`）— DFS 三色标记，发现有向图环路
- **分支合并验证**（`validateBranchMergePairs`）— 并行分支必须有合并点或后继节点
- 验证报告（errors/warnings）注入 `NarrativeContext` 供下游感知

**三重约束 + 角色连续性验证**（L3 情节生成时，`constraint-validator.ts`）：

| 约束 | 来源 | 作用 |
|------|------|------|
| **边界约束** | L2 plot.cause / result | 确保情节不超出起止状态 |
| **范围约束** | L2 content | 确保内容不脱离父节点主题 |
| **边界校验** | L2 前后邻居 story_elements | 确保不与相邻节点内容越界 |
| **角色连续性** | detailed_character_sheets + L3 content | 确保主要角色在场景中被引用，防止角色断层 |

### 上下文传递机制（L3/L4 拓扑分层执行）

L3 情节生成与 L4 剧本生成采用**拓扑分层**执行策略（`topologicalLayers`）：

- **拓扑分层**：按 DAG 依赖将节点分为若干层，同层内并行、层间串行
- **滑动窗口摘要**（`buildSlidingWindowSummary`）：将前驱节点的实际生成内容截取尾部 N 字符，作为"上文回顾"注入当前节点 prompt
- **祖先链上下文**（`buildAncestorChainContext`）：从 L2 → L1 → L0 逐级回溯，将当前节点的结构定位信息注入 prompt
- **角色/道具/故事弧摘要**（`buildCharacterDigest` / `buildItemDigest` / `buildStoryArcDigest`）：提取精简的全局设定信息注入各层 prompt
- **相邻分组摘要**（`buildAdjacentGroupDigest`）：注入同级兄弟节点摘要，帮助 LLM 感知前后叙事衔接
- **策划上下文注入**（`buildDesignContextSnippet`）：D0-D4 策划结果摘要注入 narrative_card 等步骤

### 逐层收束与叙事熵

`complexity`（1-5）唯一主控结构复杂度，派生出 `entropy`（叙事熵）作为每一层的结构预算，逐层按 `decay` 系数衰减；`deviation`（-1 ~ +1）独立调节内容风格，两者职责分离：

```
complexity (1-5, 前端选择或由 LLM 在偏好分析步骤输出，前端优先)
  └─→ entropy = COMPLEXITY_ENTROPY[complexity]      // 叙事熵，结构复杂度总预算
        ├─→ layer_entropy = entropy × LAYER_DECAY[L] // 逐层衰减（L0=1.0, L1=0.85, L2=0.72）
        │     ├─→ gross_target = lerp(profile.min, max) // 该层分支事件频率区间
        │     ├─→ merge_tendency                    // 该层聚合倾向
        │     └─→ enforceBranchInPlan()             // 强制最低分支率 + 聚合平衡
        ├─→ deviation_bound = clamp(entropy × 1.3, 0.2, 1.0) // 偏差值对称界限（保底 ±0.2）
        └─→ node_count = calculateNodeCount(entropy) // 建议节点数

deviation (-1 ~ +1, 由 LLM 输出, clamp 到 [-deviation_bound, +deviation_bound])
  └─→ 纯内容层：控制分支间的风格差异程度
       -1 = 极度套路化，+1 = 极度反套路
```

<details>
<summary>节点预算（COMPLEXITY_NODE_BUDGET）</summary>

| 复杂度 | 名称 | L0 根节点 | L1 每L0扩展 | L2 每L1扩展 | 预期总节点 |
|--------|------|----------|------------|------------|-----------|
| 1 | 极简 | 5-7 | 1（继承L0） | 1（继承L0） | 5-10 |
| 2 | 短篇 | 4-5 | 2-3（克制） | 1（继承L1） | 15-25 |
| 3 | 标准 | 5-6 | 2-3（克制） | 1-2（克制） | 35-50 |
| 4 | 丰富 | 6-8 | 3-4（正常） | 2-3（正常） | 75-100 |
| 5 | 史诗 | 7-10 | 3-5 | 2-4 | 100+ |

硬约束链（三层防线）：
1. **偏好分析钳位**（`clampLayerToBudget`）：LLM 输出的 `layer_controls.min_nodes/max_nodes` 被钳位到预算范围
2. **子节点裁剪**（`clampChildCount`）：L1/L2 骨架构建时，每个父节点的 `child_count` 被裁剪到预算上限
3. **L0 总量截断**：L0 框架节点总数超出 `l0_max` 时，先裁剪主干、再硬截断总量

</details>

<details>
<summary>分支机制优先级</summary>

1. **决定性参数（硬约束，不可违反）**：entropy 预算、L0 已确定分支结构、层级继承规则
2. **LLM 决策（在硬约束内自由）**：has_branch / should_merge / branch_position
3. **参考性参数（软引导）**：entropy 派生阈值、分支合并难度
4. **后处理矫正（只修不改）**：连接推断、框架继承验证、悬空分支修复

原则：**硬约束不可违反，LLM 在约束内决策，软引导影响方向，后处理只修连接不改结构。**

</details>

### 内容继承原则

剧本和故事线的值直接继承自情节层，不重新生成内容：

```
情节节点 (plots)
  ├─ .content[:200]            → narration_point.summary
  ├─ .jrpg_elements.scene_location    → narration_point.scenes
  ├─ .jrpg_elements.scene_characters  → narration_point.characters
  ├─ .jrpg_elements.key_items         → narration_point.items
  ├─ .jrpg_elements.narration_hints   → narration_point.key_events
  └─ .jrpg_elements.dialogue_segments → script.scenes.content[type=dialogue]
```

### 场景设计原则

核心理念：**叙事用来创世，场景用于真正将这个世界渲染出来。**

- **又全又准**：全（不遗漏任何叙事出现的场景与物品）、准（层级与归属正确，uid 稳定可对齐）
- **六层结构**：L0 世界 → L1 区域 → L2 地域 → L3 地标点 → L4 房间区域 → L5 物品
- **三阶段生成**：
  - Phase 1: 串行增量提取骨架 — L0→L1→L2 三层顺序调用 LLM，每层将已有骨架作为上下文传入
  - Phase 2: 各故事单元并行展开 L3/L4/L5（挂载到 Phase 1 模板下）
  - Phase 3: 算法合并去重 + uid 分配
- **世界观驱动 Fallback**：当 L0/L1/L2 数据为空时（如 tpl-fragmented），自动回退到基于世界观、角色、道具生成场景骨架

---

## 可视化特性

### Detroit 终端风格

- 暗色终端风格 UI，黄绿色（`#b8ff28`）主题色
- 故事大节点（仅 tpl-rpg L0/L1/L2 出现）自动展开显示内部剧情树
- 大节点可点击收起/展开，小节点可拖拽

### 单一权威源：`pipelineOrder`

后端 SSE 帧 `pipeline_steps_announce` 下发的步骤序列存入 `narrativeStore.pipelineOrder`，作为前端三个组件渲染节点序的**唯一权威源**：`TierModeSelector → PipelineStatus`、`NarrativeCanvas`、`TextViewPanel`。

### 动画与摄像机

- 生成过程中伪实时节点生长动画（根据下一步预估时间分配动画间隔）
- 每个节点独立进度环（0→50% 5秒，51→99% 10秒，完成后打勾）
- 生成过程中自动跟随当前正在生成的步骤节点
- 用户手动交互时自动切换为手动模式，不干扰操作
- 生成完成后自动全局总览

### 布局与连接

- X 轴为拓扑深度（时间），Y 轴为分支偏移
- 故事大节点展开时自动内联布局，推开后续节点
- **场景 Phase 1 简化视图**：4 个水平 pipelineStep 节点
- **任务树镜像剧情 DAG**：任务节点按 `story_node_id` 分组，连接关系直接继承 L3 plots 的 DAG 结构
- **节点 ID 编码**：多层级 ID 以 `_` 分隔（如 `5_3c_2b`），数字表示顺序位置，字母表示分支

---

## API 参考

后端提供以下 REST API（`src/api/server.ts`），基地址默认 `http://localhost:8900`。

### 端点一览

<details>
<summary>路由 / 配置</summary>

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/narrative/modes` | 可用 Tier/Mode 列表 |
| GET | `/api/narrative/genres` | 全部 117 个品类 |

</details>

<details>
<summary>Pipeline 运行</summary>

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/narrative/start` | **start**：从零启动生成 |
| POST | `/api/narrative/resume` | **resume**：断点续传 |
| POST | `/api/narrative/regenerate` | **fork**：基于 modifications 仅重跑受影响 step |
| POST | `/api/narrative/cancel/:id` | 取消正在运行的 pipeline |

</details>

<details>
<summary>IP DNA 改编生成</summary>

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/narrative/ip-dna/start` | **全自动**：上传 → 标准化 → 提取 → 生成一路直跑（支持 `async` 返回 jobId）|
| POST | `/api/narrative/ip-dna/ingest` | **半自动**：仅摄入 + 标准化建树，停在层级确认（`async` 返回 jobId）|
| GET | `/api/narrative/ip-dna/:runId/hierarchy` | 取某次运行的层级树 + 体量 + 默认改编范围 |
| POST | `/api/narrative/ip-dna/:runId/decompose` | 超体量再标准化（按标记边界拆块）|
| POST | `/api/narrative/ip-dna/:runId/confirm-scope` | 确认改编范围（全量/裁剪）|
| POST | `/api/narrative/ip-dna/:runId/confirm-units` | 确认游戏单元划分 |
| POST | `/api/narrative/ip-dna/:runId/extract` | 生成 scoped IP DNA（三件套）|
| POST | `/api/narrative/ip-dna/:runId/generate` | 用 scoped IP DNA 驱动下游生成 |
| GET | `/api/narrative/ip-dna/job/:jobId` | 查询异步 IP DNA 任务状态/进度 |
| POST | `/api/narrative/ip-dna/job/:jobId/cancel` | 取消异步 IP DNA 任务 |
| GET | `/api/narrative/ip-dna/:runId` | 取某次 IP DNA 运行的汇总信息 |
| POST | `/api/narrative/ip-dna/analyze-impact` | IP DNA 编辑影响面分析 |

</details>

<details>
<summary>编辑 / Fork 辅助</summary>

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/narrative/analyze-impact` | LLM 影响面分析 |
| POST | `/api/narrative/save-step-edit` | 保存某 step 的编辑草稿 |
| GET | `/api/narrative/edits/:dir` | 取某次 run 的编辑历史 |
| POST | `/api/narrative/restore-original` | 撤销编辑回到原始 |
| GET | `/api/narrative/stale-steps` | 列出受编辑影响的下游 step |
| GET | `/api/narrative/review/:dir` | 取某次 run 的人工 review |
| POST | `/api/narrative/review/:dir` | 提交人工 review |

</details>

<details>
<summary>状态 / 进度 / 历史</summary>

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/narrative/status/:id` | 查询运行状态 |
| GET | `/api/narrative/result/:id` | 获取完整 NarrativeContext |
| GET | `/api/narrative/stream/:id` | **SSE** 实时进度流 |
| GET | `/api/narrative/history` | 历史记录列表（按时间倒序）|
| GET | `/api/narrative/history/:key/load` | 加载某次 run 的完整结果 |
| GET | `/api/narrative/pipeline-nodes/:id` | 管线节点（PipelineState 格式）|
| GET | `/api/narrative/story-tree/:dir` | 仅取剧情树（轻量）|

</details>

<details>
<summary>导出 / 文件访问</summary>

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/narrative/export/:id` | 导出结构化资产到指定目录 |
| GET | `/api/narrative/files/:runId` | 列某次 run 的全部输出文件 |
| GET | `/api/narrative/file/:runId/{*filePath}` | 取某个文件原始内容 |

</details>

### 调用示例

```bash
# 自动识别品类
curl -X POST http://localhost:8900/api/narrative/start \
  -H "Content-Type: application/json" \
  -d '{"user_input": "做一个像原神的开放世界RPG"}'

# 手动指定 Tier + 显式品类
curl -X POST http://localhost:8900/api/narrative/start \
  -H "Content-Type: application/json" \
  -d '{"user_input": "互动影游：你的谎言", "tier": "tier1", "genre_code": "adv-interactive"}'

# 断点续传
curl -X POST http://localhost:8900/api/narrative/resume \
  -H "Content-Type: application/json" \
  -d '{"entry_key": "2026-04-30_03-32-08-077"}'

# 重新生成（fork）
curl -X POST http://localhost:8900/api/narrative/regenerate \
  -H "Content-Type: application/json" \
  -d '{"source_entry_key": "2026-04-30_03-32-08-077", "modifications": [...]}'

# SSE 实时进度流
curl http://localhost:8900/api/narrative/stream/{run_id}
```

---

## 部署

### Docker 部署（forgeax-studio 平台）

叙事模块的 Docker 服务定义已内置于 forgeax-studio 主仓库的 `docker-compose.yml` 中。

```bash
# 启动主平台（包含 narrative-studio 服务）
docker compose up -d

# 或单独启动叙事模块
docker compose up -d gemini-for-claude-code narrative-studio

# 验证
docker exec narrative-studio curl -s http://localhost:8900/api/health

# 停止
docker compose stop narrative-studio

# 重新构建（代码有改动时）
docker compose build narrative-studio && docker compose up -d narrative-studio
```

启动后访问 **http://localhost:10019** 即可使用完整的叙事生成可视化界面。API 端口 8900 仅容器网络内可达，前端已自动代理。

<details>
<summary>获取源码与环境变量配置</summary>

**方式 A — 通过 `.packages.local`（推荐）**

```json
[
  { "path": "packages/narrative-studio", "url": "<git-host>:<org>/narrative-studio.git", "branch": "main" }
]
```

然后执行 `./full_studio.sh` 自动克隆。

**方式 B — 手动克隆**

```bash
cd packages/ && git clone <git-host>:<org>/narrative-studio.git
```

**环境变量**（`.env`）：

```bash
GEMINI_API_KEY=your_key_here           # 必须
# PORT_NARRATIVE_VIZ=10019             # 可选，默认 10019
# SMALL_MODEL=gemini-2.5-pro          # 可选
```

</details>

### 本地开发（无 Docker）

```bash
cd packages/narrative-studio
npm install
export GEMINI_API_KEY=your_key  # 或 export LLM_PROXY_URL=http://localhost:8083
npx tsx src/api/server.ts       # API → :8900
cd viz && npm install && npm run dev  # Viz → :5176
```

### 注意事项

1. **API Key 安全**：`GEMINI_API_KEY` 在 `.env` 中配置，该文件已 gitignore。切勿将密钥提交到任何仓库
2. **端口冲突**：默认端口 10019（Viz 前端宿主机映射）。API 端口 8900 仅在容器网络内可达
3. **热更新**：开发模式下后端和前端均挂载了源码 volume，修改 `src/` 下的代码会自动热更新
4. **数据持久化**：生成结果保存在容器内 `/app/output/`。重建容器会丢失历史记录

---

## 跨模块数据访问

其他模块（如美术管线、逻辑管线）需要获取叙事模块生成的故事、角色、场景等数据时，有三种方式。

### 方式 1：HTTP API（推荐）

叙事模块 API 在 Docker 内网通过 `http://narrative-studio:8900` 可达。

```typescript
const resp = await fetch("http://narrative-studio:8900/api/narrative/history");
const items = await resp.json();
if (items.length > 0) {
  const latest = await fetch(
    `http://narrative-studio:8900/api/narrative/history/${items[0].key}/load`
  );
  const { result } = await latest.json();
  // result.detailed_character_sheets — 角色档案
  // result.scene_map — 场景数据
  // result.jrpg_script — 剧本
  // result.worldview_structure — 世界观
  // result.plots_generated — 情节节点树
}
```

定向导出到指定目录（管线间联动）：

```typescript
await fetch("http://narrative-studio:8900/api/narrative/export/run-id", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ target_dir: "/app/shared/game-project-1" }),
});
// → target_dir/assets/narrative/ 下生成所有资产文件
```

### 方式 2：文件系统（持久化资产）

当 Docker 卷挂载 `./packages/narrative-studio/output:/app/output` 时，生成的资产文件直接持久化到宿主机。

<details>
<summary>输出目录结构</summary>

```
output/
└── 2026-04-16_12-53-48-742/
    ├── manifest.json              ← 元信息（runId, tier, mode, 文件列表）
    ├── full_result.json           ← NarrativeContext 完整快照
    ├── _checkpoint.json           ← 断点续传数据
    ├── 00_偏好总结.md
    ├── 01_偏好分析.json
    ├── 02_初步大纲.md
    ├── ...
    ├── 11_情节节点.json
    ├── 11_情节节点/               ← 按节点拆分的原子文件
    ├── 12_剧本节点.json
    ├── 12_剧本节点/               ← 按节点拆分的原子文件
    ├── 13_任务节点.json           ← quest_generation（与场景并行）
    ├── 13_任务节点/               ← 按节点拆分的原子文件
    ├── 14_场景节点.json           ← scene_generation（与任务并行）
    ├── 14_场景节点/
    │   ├── skeleton_fw_*.json     ← P1 L0(框架)骨架提取
    │   ├── skeleton_ol_*.json     ← P1 L1(大纲)增量提取
    │   ├── skeleton_do_*.json     ← P1 L2(细纲)增量提取
    │   ├── skeleton_merged.json   ← P1 合并骨架
    │   ├── *_场景.json            ← P2 按节点展开
    │   └── merged_场景.json       ← P3 最终合并
    ├── 16_UI文案.json
    └── 17_叙事卡.json             ← 仅 tier4 极简模式
```

</details>

### 平台集成架构

```
vag_web (主 IDE)
  └─ workbench-ui (iframe)
       ├─ AgentWorkspace → 生产执行 (kojima)
       │    ├─ 域选择器 (叙事/美术/逻辑)
       │    ├─ NarrativePanel (管线概览 + viz iframe)
       │    │    └─ narrative-viz (React Flow 可视化)
       │    └─ NarrativeStatusCard (域状态卡)
       ├─ PipelineBoard (Overlook 视图)
       └─ features/narrative-studio/ (集成层)
```

| 层 | 路径 | 职责 |
|---|------|------|
| **内核** | `packages/narrative-studio/` (本仓库) | 叙事生成后端 + 可视化前端 |
| **集成** | `workbench-ui/src/features/narrative-studio/` | 平台门面 + 事件桥接 + 管线节点映射 |
| **配置** | `docker-compose.yml`（narrative-studio 段） + `.env` | Docker 部署 + 环境变量 |

完成后自动导出结构化资产到 `output/assets/narrative/`，也可通过 `POST /api/narrative/export/:id` 导出到任意项目目录。

### 方式 3：postMessage 桥接（前端 UI 联动）

平台内通过 iframe postMessage 协议接收叙事模块的实时状态事件：

```
narrative-viz → narrative:step-changed → useNarrativeFeature hook
  ├─→ narrativeFeatureStore.updateStep() → externalNodes → PipelineBoard/EntityCard
  └─→ sendToHost(workbench:node-status-changed) → vag_web
```

管线节点映射为标准 `PipelineState.nodes` 格式：

```
pipelineId: "narrative"
entityId:   "main_story"
phaseId:    <step_id>  (e.g. "core_settings", "story_framework")
status:     "not_started" | "ai_producing" | "done" | "needs_rework"
```

### NarrativeContext 关键字段表

| 字段 | 类型 | 对应步骤 | 说明 |
|------|------|----------|------|
| `user_preference_summary` | string (MD) | preference_summary | 用户偏好总结 |
| `user_preference_analysis` | object | preference_analysis | 偏好分析结构化数据 |
| `initial_story_outline` | string (MD) | initial_plan | 初步故事大纲 |
| `core_settings` | object | initial_plan | 核心设定（主题/背景/基调） |
| `plot_synopsis` | object | initial_plan | 剧情简介 |
| `worldview_structure` | object | worldview | 世界观架构 |
| `story_framework` | object | story_framework | L0 故事框架（含节点树） |
| `outlines_generated` | object | outline_batch | L1 故事大纲 |
| `detailed_outlines_generated` | object | detailed_outline | L2 故事细纲 |
| `detailed_character_sheets` | object | character_enrichment | 角色档案（含属性/关系/台词风格） |
| `item_database` | GameItem[] | item_database | 道具清单（类别/稀有度/效果/归属） |
| `plots_generated` | object | plot_generation | L3 情节节点树 |
| `jrpg_script` | object | script_generation | L4 剧本（章节/场景/对白） |
| `quest_graph` | QuestGraph | quest_generation | L5 任务图（主线/支线/触发/奖励） |
| `scene_map` | object | scene_generation | 场景数据（位置/氛围/关联角色） |
| `narrative_card` | object | narrative_card | 叙事卡（极简模式） |

**互动影游 v2 专属字段（tpl-vn-v2）**：

| 字段 | 对应步骤 | 说明 |
|------|----------|------|
| `vn_logline` | vn_logline | E1-01 一句话故事梗概 |
| `vn_outline_acts` / `vn_character_bios` / `vn_key_items` | vn_outline_acts | E1-02 三幕大纲 / 人物小传 / 关键道具（单步三输出） |
| `vn_scenes` / `vn_beats` | vn_scenes / vn_beats | E1-03 场 / E1-04 情节点 |
| `vn_script_normalized` / `vn_segment_confirmed` | vn_script_normalize / vn_segment_confirm | E2 上传剧本旁路 |
| `vn_branched_beats` / `vn_screenplay` / `vn_storyboard` / `vn_video_prompts` | vn_branched_beats / vn_screenplay / vn_storyboard | G-01 剧情树 / G-02 剧本 / G-03 分镜 + 视频提示词 |

---

## 技术栈

- TypeScript + ESM
- Google Gemini API (`@google/genai`, 默认 gemini-2.5-pro)
- Express (HTTP API, CORS, SSE)
- React 18 + React Flow (可视化前端)
- Zustand (状态管理)
- Vite (前端构建)

---

## 源文件结构

```
src/                                          # 后端 — 叙事生成管线
├── types/
│   ├── index.ts                              # NarrativeContext + Tier/Mode + 9 维 needs
│   └── game-design.ts                        # D0-D4 策划数据类型 + NarrativeRequirements
│
├── knowledge/
│   ├── genre-taxonomy.ts                     # 117 品类知识库 + GENRE_TEMPLATE_OVERRIDES
│   ├── genre-narrative-type.ts               # 品类 → 叙事类型映射
│   └── game-narrative/                       # Skill 体系（按 tier × genre 组织）
│       ├── skill-loader.ts                   # 入口：loadSkill / getStepSkill + getArchetypeForGenre（6 原型映射）
│       ├── md-skill-loader.ts                # md skill 解析
│       ├── skill-bootstrap.ts                # 自动注册全部 ts skill
│       ├── skill-types.ts                    # NarrativeSkill / StepSkillBlock / narrativeSteps 接口
│       ├── tier1-presets.ts / tier2-/ tier3- # 各 tier 的 ts skill 索引
│       ├── tier4-presets.ts                  # 休闲品类预设
│       └── skills/                           # 品类专属 skill（tier1/2/3 手写 + tier4 卡片）+ 共享原型
│           ├── archetype-shared/*.md         # 6 种叙事原型基底（epic/branching/fragmented/emergent/lightweight/micro）
│           ├── narrative-steps-defaults.ts   # ★ deriveNarrativeSteps + ensurePlotChainForConsumers（情节脊柱回填）
│           └── long-tail-genres.ts           # ★ 启动时为全部品类补齐 stub/策划 step（augmentPlanningSkills）
│
├── pipeline/
│   ├── llm-client.ts                         # ★ MODEL_OUTPUT_MAX_TOKENS + callWithRetry + 截断保护
│   ├── modes.ts                              # ★ STEP_IDS / MODE_CONFIGS / STEP_OUTPUT_FIELDS
│   ├── templates.ts                          # ★ 9 个 PIPELINE_TEMPLATES + resolveTemplateSteps
│   ├── tier-router.ts                        # 品类识别 + Tier 判定
│   ├── pipeline.ts                           # ★ NarrativePipeline 主流程（start/resume/fork）
│   ├── prompt-composer.ts                    # baseline + skill 注入 + slot 填充
│   ├── pipeline-knowledge.ts                 # 每步的 metadata 知识库
│   ├── narrative-scale.ts                    # 短/长剧判定
│   ├── impact-validator.ts                   # 影响面分析结构校验
│   ├── node-merge.ts                         # 节点级 fork
│   ├── node-dependency.ts                    # DAG 父子关系
│   ├── topo-sort.ts                          # 拓扑排序工具
│   ├── parallel-runner.ts                    # 并行批处理
│   ├── scene-aggregator.ts                   # 场景三阶段合并
│   ├── layer-threshold-config.ts             # COMPLEXITY_PROFILES + 节点预算表
│   │
│   ├── planner/                              # ★ Planner 引擎（管线组装中枢）
│   │   ├── index.ts                          # planPipeline：narrativeSteps → preset → needs 三级优先级
│   │   ├── presets.ts                        # PIPELINE_PRESETS 模板预置链
│   │   ├── needs-rules.ts                    # selectStepsByNeeds 按 9 维 needs 选步
│   │   ├── dependency-graph.ts               # step 依赖拓扑排序
│   │   └── types.ts                          # PlannerInput / PlannerOutput
│   │
│   ├── blueprint/                            # ★ Blueprint 执行内核（声明式）
│   │   ├── assembler.ts                      # assembleBlueprint：Planner 选步 → 可执行蓝图
│   │   ├── agent-def-registry.ts             # AgentDef 注册表
│   │   ├── agent-def-registrations.ts        # 各 step 的 AgentDef 声明
│   │   ├── runners/                          # 5 种结构 Runner（single-turn/chunked/sequence/conditional/deterministic）
│   │   └── types.ts / index.ts               # PipelineBlueprint / StepBlueprint / AgentRunner
│   │
│   ├── universal-agent/                      # ★ Universal Agent 框架（单步内三段式）
│   │   ├── runner.ts                         # plan → execute → evaluate
│   │   ├── planner.ts / evaluator.ts
│   │   ├── chunked-capability.ts             # ★ 短/长剧自适应
│   │   └── types.ts / index.ts
│   │
│   ├── design-steps/                         # 策划管线 D0-D4
│   │   ├── core-concept.ts                   # D0
│   │   ├── system-architecture.ts            # D1
│   │   ├── system-detail.ts                  # D2
│   │   ├── value-framework.ts                # D3
│   │   ├── design-doc.ts                     # D4 + narrative_requirements
│   │   └── auto-narrative-builder.ts         # ★ 按 template + needs 动态组装 step list
│   │
│   ├── steps/                                # 叙事步骤实现（每文件一个 step）
│   │   ├── user-preference-summary.ts        # 偏好总结
│   │   ├── user-preference-analysis.ts       # 偏好分析
│   │   ├── initial-plan.ts                   # ★ 合并步骤：大纲 + 核心设定 + 剧情简介
│   │   ├── worldview-construction.ts
│   │   ├── character-enrichment.ts
│   │   ├── item-database.ts
│   │   ├── story-framework.ts                # L0
│   │   ├── outline-batch.ts                  # L1（含验证）
│   │   ├── detailed-outline-batch.ts         # L2（含验证）
│   │   ├── plot-generation.ts                # L3（含验证 + 三重约束）
│   │   ├── script-generation.ts              # L4
│   │   ├── quest-generation.ts               # L5
│   │   ├── scene-generation.ts               # 场景三阶段
│   │   ├── narrative-card.ts                 # Tier4 一步生成
│   │   ├── context-helpers.ts                # ★ 上下文工具：摘要/祖先链/滑动窗口/拓扑分层
│   │   ├── design-context-helper.ts          # 策划上下文注入
│   │   ├── vn-v2/                            # tpl-vn-v2 专属步骤（9 step）
│   │   │   ├── vn-logline.ts                 # E1-01
│   │   │   ├── vn-outline-acts.ts            # E1-02（三幕+人物小传+关键道具，单步三输出）
│   │   │   ├── vn-scenes.ts                  # E1-03
│   │   │   ├── vn-beats.ts                   # E1-04
│   │   │   ├── vn-script-normalize.ts        # E2-01
│   │   │   ├── vn-segment-confirm.ts         # E2-02
│   │   │   ├── vn-branched-beats.ts          # G-01
│   │   │   ├── vn-screenplay.ts              # G-02
│   │   │   └── vn-storyboard.ts              # G-03
│   │   ├── branch-tree.ts                    # tpl-vn
│   │   ├── dialogue-script.ts                # tpl-vn
│   │   ├── cinematic-storyboard.ts           # tpl-vn 可选
│   │   ├── region-design.ts                  # tpl-open-world
│   │   ├── emergent-event.ts                 # tpl-open-world / tpl-emergent
│   │   ├── card-lore.ts                      # tpl-card-game
│   │   ├── event-pool.ts                     # tpl-card-game
│   │   └── structure-validation.ts           # L1/L2/L3 验证聚合
│   │
│   └── agents/
│       └── universal-narrative.ts            # 通用叙事 agent 实例
│
├── ip-dna/                                   # ★ IP DNA 改编生成子系统（第二条输入路径）
│   ├── orchestrator.ts                       # ★ 端到端编排：Phase0→1→2→2b/2c→3→生成
│   ├── job.ts                                # 异步任务队列（createJob/updateJob）
│   ├── phase0-foundation.ts / phase0-compress.ts  # 归档+清单 / 解压+媒体压缩
│   ├── phase1-understanding.ts               # ★ 标准化建层级树 + 体量评估 + 拆解闭环
│   ├── phase1-multimodal.ts                  # 图片/视频转写为层级化叙事文本
│   ├── unit-identity.ts                      # ★ 真实叙事序号提取（中文数字/章·集·话·页）+ 同号去重
│   ├── noise-filter.ts                       # 干扰项过滤（非正文/作者互动，保留特殊章节）
│   ├── phase2-extract.ts                     # scoped 提取：逐层聚合三件套
│   ├── phase2b-adapt.ts / phase2c-gen-adapt.ts    # 改编范围裁剪 / 游戏单元 A→B 映射
│   ├── phase3-rag.ts / phase3-vector.ts / phase3b-kag.ts  # 叙事方法算子检索装备
│   ├── phase4-rewrite.ts / phase5-polish.ts  # 忠实改写 / 产物润色
│   └── filesystem.ts                         # input/output 媒体优先布局 + 落盘/续跑
│
├── utils/
│   ├── connection-repair.ts                  # 剧情树连接推断/修复/验证
│   └── constraint-validator.ts               # 三重约束验证器 + 角色连续性
│
├── integration/                              # 平台集成层（workbench 桥接）
│   ├── workbench-client.ts
│   ├── workbench-types.ts
│   └── index.ts
│
├── api/server.ts                             # ★ HTTP API + SSE（叙事生成 + 12 个 IP DNA 端点）
├── cli.ts                                    # CLI 入口
└── index.ts                                  # 库入口

viz/                                          # 前端 — 可视化界面
├── src/
│   ├── App.tsx                               # 主应用
│   ├── types.ts                              # 前端类型
│   ├── store/narrativeStore.ts               # ★ Zustand 状态
│   ├── hooks/
│   │   ├── useNarrativeStream.ts             # SSE 流式通信
│   │   ├── useDetroitLayout.ts               # 布局算法
│   │   └── ...
│   └── components/
│       ├── NarrativeCanvas.tsx               # React Flow 画布
│       ├── controls/TierModeSelector.tsx     # ★ 左侧面板
│       ├── panels/TextViewPanel.tsx          # 文本视图
│       ├── nodes/                            # 节点组件
│       └── edges/                            # 连线组件
├── vite.config.ts
└── index.html

output/                                       # 生成结果目录（每次 run 一个时间戳子目录）
```

★ 标记 = 关键文件，修改前请先读注释和测试。
