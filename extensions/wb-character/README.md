# Character Editor — 多管线角色生成器

基于 Three.js 的多管线角色生成编辑器，支持 **像素角色、Spine 骨骼、视频角色、技能特效** 四大管线，集成 AI 图像/视频/3D 生成能力，可多人协作开发独立管线模块。

---

## 功能一览

| 管线 | 说明 | 状态 |
|------|------|------|
| **像素角色** `pixel-char` | Q版像素精灵 · 4方向动作序列帧 · 自动去背景/拆帧/GIF预览 | ✅ |
| **Spine 骨骼** `spine` | 拆件绑骨 · 骨骼动画编辑 · AI 动画生成 · Spine JSON 导出 | ✅ |
| **视频角色** `video` | 三视图生成 · AI 视频动作 · 序列帧提取 · Spritesheet 导出 | ✅ |
| **技能特效** `vfx` | 20+ 特效 · 挂点系统 · GameFeel 打击感 · 受击白闪 · 索敌与伤害飘字 · 详见 [VFX_CHANGES.md](./VFX_CHANGES.md) | ✅ |
| **怪物生成** `monster-gen` | 8方向5动画怪物精灵 · AI立绘 + 方向管线 + 自动组装打包 | ✅ |

## 技术栈

- **引擎** — Three.js（极简舞台：灰色地面 + 网格 + 默认光，无后处理 / 无 GLTF 场景）
- **构建** — Vite 5 + TypeScript 5
- **UI** — 纯 DOM/CSS（无框架依赖）
- **AI 服务** — Gemini Pro（图像生成）· Azure Claude（代码/动画生成）· Kling（视频生成）
- **MCP 集成** — 30+ AI 工具服务（图像/3D/动作/音频/视频）

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，填入你的 API 密钥：

```env
CLAUDE_API_KEY=your-claude-api-key
CLAUDE_API_BASE=https://your-endpoint.services.ai.azure.com/anthropic/v1/messages
KLING_ACCESS_KEY=your-kling-access-key
KLING_SECRET_KEY=your-kling-secret-key
```

Gemini API Key 通过凭证文件 `config/gemini-credentials.json` 提供（运行 `.\setup-mcp.ps1 -Sync` 从 WSL 同步）。

> 没有密钥也可以启动，但 AI 生成功能不可用。

### 3. 启动怪物管线后端（可选）

怪物生成管线需要独立的 Python 后端：

```bash
cd monster-pipeline
pip install -r requirements.txt
python server.py
# 怪物管线 API 运行在 http://localhost:5000
```

> 需要 Python 3.9+。Gemini API Key 已内置默认值，也可在前端界面中修改。

### 4. 启动开发服务器

```bash
npm run dev
```

浏览器访问 `http://localhost:5173`。Vite 会自动将怪物管线 API 请求代理到 `localhost:5000`。

### 4. 构建生产版本

```bash
npm run build     # 输出到 dist/
npm run preview   # 本地预览构建结果
```

---

## 项目结构

```
character-editor/
├── index.html                    # 入口页面
├── .env.example                  # 环境变量模板
├── vite.config.ts
├── server/
│   └── api-plugin.ts             # Vite 服务端插件（API 代理，密钥隔离在服务端）
├── public/
│   ├── character-render/         # chroma-key 等渲染参数持久化
│   ├── spine-assets/             # Spine 骨骼示例
│   └── pixel-templates/          # 像素动作模板图
├── src/
│   ├── main.ts                   # 应用入口
│   ├── core/                     # 引擎核心
│   │   ├── Engine.ts             # Three.js 引擎 — 单 pass 主渲染 + overlayScene 第二趟（详见 VFX_CHANGES.md §9）
│   │   ├── PipelineRegistry.ts   # 管线自动发现（import.meta.glob）
│   │   ├── SceneManager.ts       # ground-only 薄壳（地面 + 网格 + 环境光 + 方向光）
│   │   └── types.ts              # IPipeline 接口 + 全局类型
│   ├── ui/                       # UI 层
│   ├── shared/                   # 跨管线共享（角色设计流程/全局状态）
│   ├── lib/                      # 工具库（API客户端/帧提取/图像处理）
│   ├── vfx/                      # VFX 运行时（16个特效 + 粒子系统）
│   └── pipelines/                # ⭐ 管线模块
│       ├── _template/            # 管线模板（复制此目录新建管线）
│       ├── pixel-char/           # 像素角色管线
│       ├── spine/                # Spine 骨骼管线
│       ├── video/                # 视频角色管线
│       ├── turnaround/           # 三视图管线
│       ├── vfx/                  # 技能特效管线
│       └── monster-gen/          # 怪物生成管线（8方向5动画）
├── monster-pipeline/             # 怪物管线 Python 后端（Flask）
│   ├── server.py                 # Flask API 服务
│   ├── requirements.txt          # Python 依赖
│   └── pipeline/                 # 图像生成/去背景/组装模块
└── workspace/                    # 运行时数据（gitignored）
```

---

## 管线架构

### IPipeline 接口

每个管线实现 `src/core/types.ts` 中的接口：

```typescript
interface IPipeline {
  meta: { id: string; name: string; icon: string; description: string; version: string }
  init(ctx: PipelineContext): Promise<void>
  dispose(): void
  createUI(container: HTMLElement): void
  destroyUI(): void
  getDefaultParams(): Record<string, unknown>
}
```

### 自动发现

`PipelineRegistry` 通过 `import.meta.glob` 自动扫描 `src/pipelines/*/index.ts`，无需手动注册。`meta.id` 以 `_` 开头的管线会被跳过。

### 新增管线

```bash
# 1. 复制模板
cp -r src/pipelines/_template src/pipelines/my-pipeline

# 2. 编辑 src/pipelines/my-pipeline/index.ts 中的 meta 和 createUI()

# 3. 保存 → Vite HMR 自动加载
```

---

## 多人协作

项目设计为多人并行开发，每人负责一个管线：

| 步骤 | 操作 |
|------|------|
| **分发** | 协作者 clone 仓库 → `npm install` → `npm run dev` |
| **开发** | 每人在 `src/pipelines/<pipeline-id>/` 下独立开发 |
| **合入** | 协作者提交 PR，管线间无耦合，直接合入即可 |

---

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+C` | 打开/关闭相机编辑器 |
| `W A S D` | 前后左右移动 |
| `Q / E` | 上下移动 |
| 鼠标左键拖拽 | 旋转视角 |
| 鼠标右键拖拽 | 平移 |
| 滚轮 | 缩放 |

---

## MCP 工具集成

项目集成了 30+ AI MCP 工具服务：

| 类别 | 工具 |
|------|------|
| **图像生成** | Gemini · 即梦 · 混元 |
| **图像处理** | 去背景 · 语义分割 · 后处理 · 图像拆分 |
| **3D 模型** | 混元3D · Tripo · Hyper3D |
| **骨骼绑定** | Weaver Rigging · Weaver Skinning · 混元 Rigging |
| **动作生成** | 混元 Motion · Weaver Motion |
| **视频生成** | Kling |
| **音频** | Suno · Vertex Music · Google Speech |
| **辅助** | 提示词优化 · 图像搜索 · 音乐搜索 |

> MCP 服务需要 ForgeaX 沙盒环境或本地部署 `mcp-servers/`，通过 `setup-mcp.ps1` 一键配置。

---

## 环境变量说明

| 变量 | 必需 | 说明 |
|------|------|------|
| `CLAUDE_API_KEY` | 否 | Azure Claude API Key（AI 动画/代码生成） |
| `CLAUDE_API_BASE` | 否 | Azure Claude 端点 URL |
| `KLING_ACCESS_KEY` | 否 | Kling 视频生成 Access Key |
| `KLING_SECRET_KEY` | 否 | Kling 视频生成 Secret Key |
| `MCP_HOST` | 否 | MCP 服务主机名（默认 `vag-mcp-sandbox`） |

Gemini API Key 通过 `config/gemini-credentials.json` 凭证文件提供（`{"api_key":"..."}`），不再通过环境变量。
也可以在 `server/keys.local.json` 中配置 Claude/Kling 密钥，该文件已被 gitignore。

---

## 注意事项

### VFX 容器隔离

VFX 特效对象 **禁止直接添加到 Scene**，必须通过 VFX Group 隔离：

1. VFXManager 接收 `THREE.Group`（非 Scene）作为容器
2. VFX update 必须用 `engine.onUpdate()` 注册，禁止自建 `requestAnimationFrame`
3. 命中屏闪通过 `renderer.toneMappingExposure` 脉冲实现，无需后处理

### ⭐ 角色 × 特效融合（两层渲染）

VFX 与像素角色"自然融合"的底层约定，**在 `Engine.ts` + `pixel-char/index.ts` + `VFXManager.ts` 三处协同**：

- `world.scene` (pass 1) + `overlayScene` (pass 2，`clearDepth` 后重绘)
- 像素角色 sprite 永远在 `overlayScene`（`renderOrder=100`）
- 需要"盖住角色"的特效通过 `VFXManager._addToOverlay()` 动态迁移 + `renderOrder>=9100`
- 受击白闪通过 `SpriteAnimator.flashIntensity`（canvas `source-atop`）实现

### 安全

- API 密钥仅在服务端 Vite 插件中使用，**不会泄露到浏览器**
- 前端通过 `/__ce-api__` 代理路径调用服务端 API
- `.env` 和 `server/keys.local.json` 已在 `.gitignore` 中排除

---

## 更新日志

### 2026-04-10 — 角色设计增强 & 三视图稳定化（akari01 分支）

#### 角色设计模块 (`src/shared/CharacterDesign.ts`)

- **新增画风风格选择器** — 8 种预设画风（像素、动漫、Q版、写实、油画、扁平、水墨、暗黑）+ 自定义输入，UI 与「世界观」选择器风格统一，选中画风自动注入 AI 提示词
- **集成局部修改功能** — 概念图阶段：选中图片后可展开 14 个部件（发型、眼睛、武器、服装等）的图生图编辑面板；定稿阶段：独立的修改局部细节流程，支持修改历史回溯
- **局部修改提示词优化** — 使用 `EDIT_PREAMBLE` + `KEEP_FRAMING` 约束，确保图生图修改时严格保持背景和未改动部分不变
- **概念图生成修复** — 4 张概念图从并行改为顺序生成，解决 Gemini API 并发限速导致只出 2 张的问题；修复 CSS 溢出导致仅显示 2 张的问题

#### 全局状态 (`src/shared/GlobalState.ts`)

- 新增 `ArtStyle` 类型（10 种风格值），`CharacterProfile` 增加 `artStyle` / `artStyleCustom` 字段

#### 服务端 API (`server/api-plugin.ts`)

- **Chat API — Claude → Gemini 自动降级** — Claude 未配置或请求失败时自动 fallback 到 Gemini，新增 `handleChatViaGemini` 函数（消息格式转换、安全策略/空文本等详细错误处理）
- **三视图生成 — 模板+结构化提示词** — 引入 3 张姿势模板图（`public/assets/turnaround/`），重写提示词为「先模板图→再角色图→再文字指令」的输入顺序，每个视角含精确姿势描述（透视角度、腿部姿态、构图比例），大幅提升三视图姿态一致性和稳定性
- 清理调试日志代码

#### 三视图前端 (`src/pipelines/turnaround/index.ts`)

- 三视图结果从横排三列改为竖排单列显示，图片居中、最大宽度 400px
- 修复 CSS 注入机制：通过固定 `id` 查找并更新 `<style>` 标签，解决 HMR 后样式不更新的问题

#### 新增资源

- `public/assets/turnaround/turnaround-front.png` — 正面姿势模板
- `public/assets/turnaround/turnaround-side.png` — 侧面姿势模板
- `public/assets/turnaround/turnaround-back.png` — 背面姿势模板

---

## License

Internal use only.
