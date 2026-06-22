# reel-studio · 互动影游编辑器

> 一句话：作者向 FMV 编辑器 —— 把"提示词 / 视频 / 关卡 / QTE / 剧情分支"一站式拼成可玩互动影游。
> 灵感锚点："完蛋！我被美女包围了" 这种限时点按 + 选择驱动的恋爱悬念片。

---

## 它和 `reel-engine` 不是一回事

| 维度 | `reel-engine`（已有） | **`reel-studio`（本包）** |
|------|----------------------|---------------------------|
| 定位 | "边演边写"演绎引擎 | "先编辑后游玩"作者向编辑器 |
| 主导 | 三重心智议会 + Director 实时合议 | 作者本人 + Opus 4.6 辅助 |
| 媒体 | 仅文本/CASPER 单图 | 视频上传 / GPT-Image-2 占位 / 静态图 |
| 玩家 | 输入意图驱动 LLM 推进 | 限时点按 + 选项分支驱动 |
| 输出 | 实时叙事 | 可分发 Scenario JSON + 试玩运行时 |

未来两包可以互相导入资产，但当前阶段独立演化。

---

## 设计决策

### 编辑期 vs 运行期分离

**编辑期**（`mode='editor'`）：
- 作者拼装 `Scenario`，所有数据 100% 可序列化为 JSON
- LLM 仅做"草稿生成"——画面提示词、台词草稿、分支建议
- LLM 不参与运行时；运行时是确定性的回放

**运行期**（`mode='player'`）：
- 读取同一个 `Scenario`
- 按 `elapsedMs` 推进；触达 dialogue.startMs / qte.cue.appearAt / branch.showAt 时分别显示
- QTE 评分由纯函数 `QTEEngine.judgeTap/judgeHold` 给出，离时钟独立 → 完全可单测

### 媒体三态

每个 `Scene.media.kind` 三选一：

- `VIDEO` — 上传视频，`<video>` 直接播放
- `IMAGE_PROMPT` — 仅有提示词，运行时用 GPT-Image-2 渲染占位
- `IMAGE_STATIC` / `PLACEHOLDER` — 静态图或纯渐变兜底

### 模型对接

| 用途 | 厂商 / 模型 | 来源 | 注入方式 |
|------|------------|------|--------|
| 提示词锻造 / 台词草稿 | Azure Anthropic · `claude-opus-4-6` | `key/llm_key.json → azure-claude` | **vite define · build-time** |
| 占位画面生成 | Azure OpenAI · `gpt-image-2` | 同上 → `azure-openai-image` | **vite define · build-time** |
| 视频生成（即梦 seedance 2.0 / sora 兼容） | 火山引擎 ARK · `doubao-seedance-1-0-pro-250528` | UI 输入 / `localStorage` | **运行时 · 本机持久化** |

任一缺失则自动退化为本地 Mock（占位画面是 Canvas 渲染的渐变 + prompt 文字）。

---

## 🛡 安全模型（重要 · 部署前必读）

本编辑器目前是**本地工具**，三类 key 各有不同的存储与暴露面：

### 视频模型 key（`seedance / jimeng`）—— ✅ 设计为安全
- 存放：浏览器 `localStorage`（`reel-studio.settings.v1`）
- 不会落到：剧本 JSON、git diff、导出包、分享链接
- 防御纵深 4 层（参考 `src/scenario/sanitize.ts`）：
  1. `setVideoConfig` 白名单只接收 `provider/model/durationSec/size`
  2. `loadScenario` 入站强制 sanitize
  3. `exportJSON` 出站强制 sanitize
  4. `importJSON` 导入他人剧本时再 sanitize 一次
- UI 提供「清除 KEY」按钮一键擦除本机存储
- 单元测试：`src/scenario/__tests__/sanitize.test.ts`

### Claude / Image GPT key —— ⚠️ build-time 注入，**不可生产部署**
- 当前 `vite.config.ts` 会读 `llm_key.json` 通过 `define` 注入：
  - `__RS_CLAUDE_KEY__` / `__RS_IMG_KEY__` 会**以原文出现在最终 dist**
- **后果**：如果你 `npm run build` 后把 `dist/` 部署到公网，Azure key 会泄露
- **当前定位**：这份 build 仅供本地开发使用
- **未来改造**（Roadmap）：把 LLM 调用挪到 serverless 反向代理后端，浏览器只持 ephemeral session token

### 部署 checklist
- [ ] **正常构建**（`npm run build`）的 dist 仅本机 / 受信网络；不要直挂公网
- [ ] **公共分发**改用 `npm run build:standalone`（强制 `RS_NO_KEY=1`），产物**保证零 key**
- [ ] git 不要提交 `llm_key.json` —— `.gitignore` 已覆盖 `key/`、`**/llm_key.json`、`*.key.json`
- [ ] 导出/分享剧本 JSON 前：自动 sanitize 已剥离视频 key；Claude/Image key 各自维护本地 `llm_key.json`，永远不进 JSON
- [ ] 提交 issue / 错误日志前：用 `maskSecret` 工具掩码（`src/scenario/sanitize.ts`）

---

## 数据模型

```
Scenario
├── id / title / synopsis / rootSceneId / defaultCharMs
└── scenes: { [id]: Scene }

Scene
├── id / title / durationMs
├── media: MediaRef                 # VIDEO | IMAGE_PROMPT | IMAGE_STATIC | PLACEHOLDER
├── dialogue: DialogueLine[]        # role / speaker / text / startMs / endMs / charMs
├── qte?: QTESpec                   # cues + window + score + passingScore
└── branches: Branch[]              # choice | qte_pass | qte_fail | auto

QTECue
├── shape: tap | hold | sweep
├── x, y                            # 屏幕归一化坐标
├── appearAt / targetAt / durationMs
└── label?

QTESpec.window (ms 容差)
├── perfect: 80
├── great:   160
└── good:    280
```

## QTE 评分（纯函数）

```ts
deltaMs = clickAt - cue.targetAt   // 提前 < 0；延迟 > 0；从未点击 = +Infinity

if (|deltaMs| ≤ window.perfect) → PERFECT
else if (|deltaMs| ≤ window.great) → GREAT
else if (|deltaMs| ≤ window.good)  → GOOD
else                                → MISS
```

`hold` 类型先评起手 `deltaMs`，再用 `holdMs` vs `cue.durationMs` 做时长校验：偏离过大降一档或直接 MISS。

总分 ≥ `passingScore` → `qte_pass` 分支；否则 `qte_fail`。

完整规则有 vitest 守门：

```bash
npm test
```

---

## 编辑器布局

```
┌─────────────────────┬───────────────────────────────┬───────────────────┐
│ ASSETS · LEVELS     │  STAGE                        │ INSPECTOR         │
│  关卡列表（拖入舞台）│   画面（视频/IMG_PROMPT）     │  当前场景属性     │
│  视频上传 dropzone   │   字幕预览（hover 时间轴）     │  台词列表 inline   │
│  PROMPT FORGE        │   QTE 标记叠层                │  QTE cues 列表    │
│   （Opus 4.6）       │   时间轴：DIA / QTE / BR 三轨  │  分支跳转          │
└─────────────────────┴───────────────────────────────┴───────────────────┘
```

顶栏 `EDITOR / PLAYER` 一键切换；`导入 JSON / 导出剧本` 全局可用。

## Player 运行时

```
┌───────────── full screen ─────────────┐
│                                       │
│            画面（视频 / IMG）          │
│                                       │
│  QTE 节奏点 ⊙   PERFECT 飘字          │
│                                       │
│    ● 可拖动 FAB (⚙)  ← 贴边停靠       │
│      │                                │
│      ├─ 剧情结构 >  → 全屏 DAG 树      │
│      ├─ 重播本场                      │
│      ├─ 回到起点                      │
│      ├─ 返回主页                      │
│      └─ 退出试玩                      │
│                                       │
│      「角色名」台词文本（电影字幕风）    │
│                                       │
│ 选择层（场景结束有 choice 时弹出）      │
└───────────────────────────────────────┘
```

**PlayerMenu 交互设计**：
- 右上角圆形 ⚙ 按钮可**拖拽到任意屏幕边缘**，松手自动贴边停靠（top / right / bottom / left）
- 位置通过 `localStorage` 持久化，刷新后仍在同一位置
- 展开面板为 320px 窄抽屉，单列列表风（类 iOS 设置页）
- "剧情结构"进入**全屏 BranchTree Overlay**，支持空白拖拽平移
- 对话以**电影字幕风**呈现：底部居中、白字黑描边、旁白斜体、无背景框

---

## 快速开始

### 作为独立仓库（默认入口）

```bash
git clone <your-repo-url>/reel-studio.git
cd reel-studio
npm install
npm run dev
# → http://localhost:15175
```

无 key 也能跑——LLM 自动降级 Mock，所有 UI / 时间轴 / 剧情图 / QTE 编辑能力 100% 可用。

**接入真实 LLM key**（仅本机，**永远不要 commit**）：

```bash
mkdir -p key
cat > key/llm_key.json <<'EOF'
{
  "azure-claude":       { "api_key": "...", "api_base": "https://<resource>.services.ai.azure.com/anthropic" },
  "azure-openai-image": { "api_key": "...", "api_base": "https://<resource>.cognitiveservices.azure.com",
                          "api_version": "2024-02-01" }
}
EOF
# key/ 目录已在 .gitignore 中
npm run dev   # vite 控制台会打 "loaded LLM keys from ./key/llm_key.json"
```

### 在 monorepo 中

```bash
cd <monorepo>/packages/reel-studio
npm install && npm run dev
```

`vite.config.ts` 会自动按以下优先级寻找 key：
1. `process.env.KS_LLM_KEY_PATH`
2. `./key/llm_key.json`（独立仓库本地）
3. `../<sibling>/key/llm_key.json`（monorepo 同源）

测试：

```bash
npm test           # QTEEngine + scenario + timeline 单元测试
npm run test:watch
```

### 单文件分发（zero-key · zero-asset）

一条命令把整个编辑器压成**一个自包含 HTML**，可发给试用者双击即用，**产物不含任何 key**：

```bash
npm run build:standalone
# → dist/reel-studio.html  （约 600 KiB）
```

实现细节：
- `RS_NO_KEY=1` 让 vite 在编译期把所有 LLM key 占位符替换为空串，配合 minifier 的 dead-code-elimination，真实 provider 类整段被剔除
- `scripts/bundle-singlefile.mjs` 把 `dist/assets/*.{js,css}` 全部 inline 进 `index.html`，并校验**零外部资产引用**残留
- 唯一外部依赖：Google Fonts（离线只是字体退化，功能完整）

详见上面"安全模型"小节。

## 文件结构

```
src/
├── App.tsx · main.tsx
├── scenario/                       # 剧情数据模型 + store + demo + 持久化
│   ├── types.ts
│   ├── scenarioStore.ts            # Zustand + zundo (undo/redo)
│   ├── scenarioPersist.ts          # localStorage 持久化纯函数
│   ├── scenarioPersistBoot.ts      # 启动时恢复 + 订阅保存
│   └── demoScenario.ts
├── qte/                            # QTE 引擎（纯函数）
│   ├── QTEEngine.ts
│   ├── cueKeybinding.ts            # 空格 / 鼠标 / 连线输入
│   └── __tests__/
├── llm/                            # LLM 接入层
│   ├── ClaudeAzureProvider.ts      # Azure Anthropic + 截断检测
│   ├── GptImageProvider.ts         # GPT-Image-2 + 429 重试
│   ├── SeedanceProvider.ts         # 火山引擎视频生成
│   ├── promptForge.ts              # 剧情锻造（idea / script 双模式）
│   ├── parseJSONLoose.ts           # 鲁棒 JSON 解析（脏 LLM 输出）
│   ├── retryPolicy.ts              # 指数退避 + Retry-After 重试
│   ├── batchImageGen.ts            # 并行批量生图（worker pool）
│   ├── seedanceContent.ts          # Seedance API body 构造
│   ├── skills/                     # LLM skill prompts
│   │   ├── scenario-architect.skill.md  # 创意扩写
│   │   └── script-structurer.skill.md   # 严格结构化提取
│   └── __tests__/
├── media/                          # 视频/图像本地仓
│   ├── mediaStore.ts
│   └── sceneImageCache.ts
├── editor/                         # 编辑器三栏
│   ├── EditorLayout.tsx
│   ├── AssetPane.tsx
│   ├── StagePane.tsx
│   ├── InspectorPane.tsx
│   ├── IdeaForge.tsx               # 想法/剧本 → 锻造入口
│   ├── PromptTabs.tsx
│   ├── timeline/                   # 三轨时间轴 (DIA / QTE / BR)
│   └── storygraph/                 # @xyflow/react 剧情 DAG 图
├── player/                         # 互动影游运行时
│   ├── Player.tsx
│   ├── DialogueBox.tsx             # 电影字幕风（白字黑描边）
│   ├── PlayerMenu.tsx              # 可拖拽 FAB + 单列设置抽屉
│   ├── BranchTree.tsx              # SVG DAG 视图（空白拖拽）
│   ├── BranchTreeOverlay.tsx       # 全屏剧情树查看器
│   ├── dockable.ts                 # 可贴边浮动按钮纯逻辑 + hook
│   ├── subtitleSelect.ts           # 字幕选取纯函数
│   ├── ChoiceLayer.tsx
│   ├── QTEOverlay.tsx
│   ├── ScoreHUD.tsx
│   └── __tests__/
├── io/                             # 导入/导出
│   └── loadScriptFile.ts
├── ui/
│   └── TopBar.tsx                  # 历史下拉 + undo/redo
├── styles/global.css
└── lib/                            # 通用工具
    └── rafThrottle.ts
```

## 更新日志

### 最新（d54e4dc）

**FAB 可拖拽贴边 + 设置面板单列化 + 剧情树全屏**

| 模块 | 改动 | 说明 |
|------|------|------|
| `dockable.ts` | 新增 | FAB 拖拽 + 贴边停靠纯函数 + `useDockable` hook |
| `PlayerMenu.tsx` | 重写 | 窄抽屉 320px + 单列 list 行（48px/行） |
| `BranchTreeOverlay.tsx` | 新增 | 全屏剧情树：顶部 chrome + 空白拖拽 panning + ESC 退出 |
| 测试 | +18 | `dockable.test.ts`：clamp / ratio / 序列化容错 |

### 历史

| 版本 | 说明 |
|------|------|
| `9d304b1` | 电影字幕风 + 极简设置按钮，全面去金色 |
| `8a64f06` | 剧本持久化 + 历史下拉，刷新不丢 |
| `0a05da5` | 429 重试 + 一键并行批量生图按钮 |
| `f50523f` | maxTokens 8K→32K，修 5K+ 字剧本被截断 |
| `0abef2a` | script 模式不再静默兜底空场景，把 raw 暴露给作者 |
| `628e705` | script 模式严格忠于原文，禁止 LLM 二创 |
| `5b68d6b` | 修复剧情锻造 JSON 解析 + Seedance 视频参考图 400 |
| `2afbec7` | 独立仓库初始化 |

## Roadmap（v2 待办）

- [ ] 视频时间轴 sync：用 `<video>` `currentTime` 替代 RAF 自驱动
- [ ] IndexedDB 持久化媒体：刷新不丢图片/视频
- [ ] sweep 类型 QTE（鼠标向量识别）
- [ ] 关卡缩略图缓存（生图结果存到 mediaStore）
- [ ] LLM 调用挪到 serverless 反向代理后端
- [x] 导出可分发的"独立 HTML"包 — `npm run build:standalone`
- [x] 分支树 DAG 可视化（节点拖拽 + 全屏 overlay）
- [x] 剧本持久化 + 历史加载
- [x] 并行批量生图
- [x] 电影字幕风 Player UI

## License

MIT
