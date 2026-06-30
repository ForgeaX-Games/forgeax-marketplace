---
name: make-game-design
description: 在 Cursor 中本地从一条游戏 brief 出发，产出极简的 GDD：一份 <slug>_pillar.md（核心乐趣 + 体验支柱 + 核心循环 + 美术风格 + 关键模块清单），加上若干份 <slug>_<module>_design.md（每个关键模块的核心体验和关键设计决策）。当用户输入 /make-game-design 后跟一段游戏描述（例如 "做一个 xxx 游戏"、"make a roguelike deckbuilder"），或要求为某个游戏概念搭建前期设计文档时使用。
disable-model-invocation: true
---

# make-game-design — 极简版 GDD 流程

从用户的游戏 brief 出发，**两步**得到一份可读的 GDD：

| Phase | 名称 | 输出 |
|---|---|---|
| 1 | Pillar | `<slug>_pillar.md`（一份） |
| 2 | Design | `<slug>_<module>_design.md`（每个关键模块一份，2–5 份） |

每个 phase 的深度合约：

- [`phase-1-pillar.md`](phase-1-pillar.md)
- [`phase-2-design.md`](phase-2-design.md)

进入对应 phase 时再读对应文档，不要一次性都读完。

---

## 快速开始

```
/make-game-design 做一个 xxx 游戏
/make-game-design make a roguelike deckbuilder with cute pixel art
/make-game-design 做一个 contra 风格双人合作射击游戏 → ./mygame
```

斜杠命令后面的内容就是**游戏 brief**。可选的 `→ <path>`（或 `output: <path>`）会覆盖默认输出目录。

---

## 工作流

复制这份 checklist，并用 TodoWrite 跟踪：

```
- [ ] Step 0: 解析 <doc_dir> 和 <slug>，检查旧产物
- [ ] Step 1 — Phase 0 Intent: 起草 4–8 题，AskQuestion 一次性追问，汇总成 Intent Notes
- [ ] Step 2 — Phase 1 Pillar: 写 <slug>_pillar.md（顶部含 Intent Notes 引用块）
- [ ] Step 3 — Phase 2 Design: 对 §5 每个模块写一份 <slug>_<module>_design.md
- [ ] Step 4: 最终汇报（文件树 + 关键决策摘要）
```

### Step 0 — 解析 `<slug>` / `<doc_dir>`，检查旧产物

1. **`<slug>`**：从 brief 提炼一个 kebab-case slug（例如 `做一个 contra 风格双人合作射击游戏` → `contra-coop-shooter`）。最多 4–6 个词，限制为 ASCII。

2. **`<doc_dir>`**——按以下顺序选择：
   - 如果用户在 brief 里写了 `→ <path>` 或 `output: <path>` → 字面使用该路径
   - 否则若工作区根目录存在 `workbench-output/` → 使用 `workbench-output/<slug>/`
   - 否则默认 `workbench-output/<slug>/`，并 `mkdir -p` 创建

3. **不要**写入 `data/workspace/` / `games/` / `packages/<pkg>/`（那些超出 skill 范围）。

4. **旧产物提示（不主动删）**：如果 `<doc_dir>` 已存在旧流程产物（任何一个：`whitepaper.md` / `requirement.md` / `tech_assessment.md` / `art_direction.md` / `systems/` / `execution_plan.json` / `meta.json`），**不要**主动删除。在 Step 4 最终汇报里提示用户：

   > 「`<doc_dir>` 检测到旧流程产物，请决定是否手动清理。本 skill 仅生成新流程的 `*_pillar.md` + `*_design.md`，不会覆盖旧文件名。」

### Step 1 — Phase 0 Intent（开局唯一一次追问）

在写任何文件之前，**先**针对 brief 做一次结构化追问，只锚定两个维度——这是后续 Phase 1 要落锤的核心：

1. **核心乐趣方向**——玩家最想反复回来的是哪个瞬间 / 感受（对应 `pillar.md §1`）
2. **体验 pillar 候选 / 优先级**——agent 推断 2–4 个候选 pillar，让玩家选 1–3 个或排序（对应 `pillar.md §2`）

**不要**问美术基调 / 模块边界 / 平台 / 单多人 / 难度——美术（§4）和模块（§5）是 agent 在 Phase 1 基于已确认的 pillar 自己推的，让玩家先选这些就把 pillar 推理倒过来了；brief 缺口由"自信推断 + 文档末尾 `Note:` 记假设"那条老路兜住。

执行规则：

- **同一次 `AskQuestion` 调用**一次性发起所有问题，不要一题一问。
- **常用 4–6 题，硬上限 10**。brief 已经写明的维度**不要凑数提问**（例如 brief 已写"双人合作射击"就别问"单/多人"）。
- 每题给 **2–4 个 agent 推断的候选** + 一个 `其他 / 我自己说` 兜底选项（提示玩家可在自由文字里补充）。
- 拿到答复后汇总为 **5–10 行 bullet** 作为 Intent Notes，喂给 Step 2 Phase 1。
- 本 Step **不写文件**——落盘动作在 Step 2 写 pillar.md 顶部 `> Intent Notes:` 引用块时一起完成。

### Step 2 — Phase 1 Pillar

**完整契约请读 [`phase-1-pillar.md`](phase-1-pillar.md)。**

在 `<doc_dir>/` 下产出**一个文件**：`<slug>_pillar.md`，按顺序包含 5 个必备 §section：

1. §1. 核心乐趣
2. §2. 体验支柱（Pillars，2–4 个）
3. §3. 核心体验循环（4–7 节点 ASCII 流程）
4. §4. 美术风格定义（总基调 + pillar→美术呈现映射，整节 ≤ 15 行）
5. §5. 关键模块拆解声明（2–5 个模块，每个 ≤ 5 行，kebab-case 命名）

### Step 3 — Phase 2 Design

**完整契约请读 [`phase-2-design.md`](phase-2-design.md)。**

对 §5 中**每个**模块产出一份 `<doc_dir>/<slug>_<module>_design.md`，按顺序包含 4 个必备 §section：

1. §1. 模块定位（1 句话回扣到 pillar）
2. §2. 核心体验关键词（3–6 个）
3. §3. 关键设计决策（3–6 条；每条含玩家感受 + 设计取舍 + 回扣）
4. §4. 与其他模块的协作（1 段散文）

文件名 `<module>` 一字不差取自 pillar.md §5。每份 ≤ 100 行。

### Step 4 — 最终汇报

打印一份总结：

1. **文件树**：用 `tree <doc_dir>` 风格列出 `*_pillar.md` + 全部 `*_design.md`
2. **模块清单**：N 个模块的名字（kebab-case）
3. **关键设计决策摘要**：3–5 条最关键的判断
4. **未覆盖的内容**：本 skill 止于 Phase 2 Design；不产出资产、代码、QA、JSON 工单
5. **若 Step 0 检测到旧产物**：把上面那段提示打出来
6. **下一步**：用自然语言提示后续动作（例如"如果想调整核心体验，先迭代 `*_pillar.md` 再回头补 design"）

---

## 质量门（在宣告完成之前）

- [ ] `<doc_dir>/<slug>_pillar.md` 存在，5 个 §section 齐全（§1 核心乐趣 / §2 Pillars / §3 核心循环 / §4 美术风格 / §5 关键模块）
- [ ] `<slug>_pillar.md` 顶部存在 `> **Intent Notes**:` 引用块，含 5–10 行 bullet（来自 Step 1 玩家追问汇总）；不算入 5 个 §section
- [ ] §4 含**总基调** + **pillar→美术映射表**两块；不含调色板 hex / 逻辑分辨率 / sprite 尺寸表 / 中英双语关键词列表
- [ ] §5 模块数 ∈ [2, 5]，每个模块名都是语义化 kebab-case（不含 `S1` / `module_1` / 纯数字 / 空格 / 大写）
- [ ] `<doc_dir>/` 下 `*_design.md` 文件数量 = §5 模块数；每份文件名 = `<slug>_<module>_design.md`，`<module>` 与 §5 一字不差
- [ ] 每份 design.md 含 4 个 §section（§1 模块定位 / §2 关键词 / §3 决策 / §4 协作），§3 每条决策都回扣到 §2 关键词或某个 pillar
- [ ] `<doc_dir>/` 下只存在 `<slug>_pillar.md` + N 份 `<slug>_<module>_design.md`（N = §5 模块数），无其他 `.md` / `.json` 产物

任意一项门没过，就**就地修复**那个产物，**不要**宣告成功并把锅甩给用户。

---

## 反模式（不要做）

1. **越界到工程产物**：phase-1 / phase-2 只产出体验文档（`pillar.md` + `design.md`）。**禁止**写 JSON 工单、系统 spec、技术规范、美术细则（调色板 / 分辨率 / 字体 / 视差 / 双语关键词等）、参数表 / 状态机 / 接口 / calibration。把"反馈"作为 §3 决策的"玩家会感受到"那一行写，不要单独立小节。
2. **§5 模块超过 5 个**：稀释焦点。合并成 2–5 个。
3. **模块名序号化**：`S1`、`module_1`、纯数字禁止；用 `combat`、`meta-progression`、`level-flow` 这种语义化 kebab-case。
4. **Phase 1 / 2 中途反问用户**：追问只在 Step 1 Phase 0 Intent 里一次性进行；进入 Phase 1 之后从 brief + Intent Notes 推断 + 在文档末尾用一行 `Note:` 记假设，不要再调 `AskQuestion`。
5. **回头改 `workbench-output/<slug>/` 中的旧文件**：旧流程的样本是历史记录，不要"清理对齐"。Step 0 只**提示**用户，不主动删。
6. **跨出 `.cursor/skills/make-game-design/`**：本 skill 不修改 `backup-skills/`、不修改主仓库 peer prompt、不调用图像 / 视频 / 音乐类 MCP 工具。

---

## 相关文件

- Phase 深度合约：[`phase-1-pillar.md`](phase-1-pillar.md)、[`phase-2-design.md`](phase-2-design.md)
- 旧产物样本（已停用，保留作历史参考；按 `AGENTS.md` §5 不主动改写）：`workbench-output/potato-bros/`
- 仓库根作用域约束：`/AGENTS.md`
