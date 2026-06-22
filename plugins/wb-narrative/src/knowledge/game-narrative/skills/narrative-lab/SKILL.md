---
name: narrative-lab
description: "AI叙事创意实验室。通过'素材采集 → 创意重构 → 双重评估 → GDD输出'的闭环，生成具有市场竞争力和落地性的游戏叙事创意。适用于早期脑暴、概念验证和创意探索。"
license: Apache-2.0
version: 2.0.0
owner: vibe-gaming
maturity: stable
timeout: 90
permissions: [none]
---

# Skill: narrative-lab

## Metadata
- Name: narrative-lab
- Version: 2.0.0
- Owner: vibe-gaming
- Maturity: stable
- Timeout: 90
- Permissions: none
- MCP Dependencies: none

## Description (for Agent)

AI叙事创意实验室。通过"素材采集 → 创意重构 → 双重评估 → GDD输出"的闭环，生成具有市场竞争力和落地性的游戏叙事创意。适用于早期脑暴、概念验证和创意探索。

## Use Cases

- 需要创意脑暴，探索多个可能的方向
- 有参考素材（影视/小说/游戏），想要跨媒介重构
- 想要评估一个创意的可行性和独特性
- 需要快速产出多个概念草案供选择
- 生成初步的游戏策划案 (GDD)

## Non-goals

- 完整的叙事设计流程（使用 `narrative-studio`）
- 具体的任务/关卡设计（使用 `mission-designer`）
- 深度的角色/世界观构建（使用 `narrative-studio`）
- 跨媒介 IP 改编（使用 `media-adapter`）

---

## 内置模块 (Built-in Modules)

### 模块 A: Trend Scraper (趋势采集)
识别和分析输入素材中的热点元素：
- 标签提取
- 情感倾向分析
- 独特性评分

### 模块 B: Creative Recombinator (创意重构)
遵循"重构拼接"逻辑：

**解构**: 将素材拆解为：
- 核心矛盾
- 奇观元素
- 角色原型
- 叙事诡计

**重组**: 跨领域拼接（例如：将"赛博朋克"与"中国古代传记"拼接）

### 模块 C: Dual-Gate Evaluator (双重评估)
三维度评估：
1. **创意性 (Creativity)**: 独特性、意外感、情感张力
2. **可落地性 (Feasibility)**: 开发成本、技术难度、政策合规
3. **场景匹配 (Context)**: 适合的游戏类型和叙事结构

### 模块 D: GDD Generator (策划案生成)
将通过评估的创意转化为专业游戏策划案：
- 核心概念
- 世界观大纲
- 核心玩法循环（叙事层面）
- 商业化潜力
- 视觉参考建议

---

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "enum": ["generate", "evaluate", "gdd", "full"],
      "default": "generate",
      "description": "工作模式"
    },
    "seeds": {
      "type": "array",
      "items": {"type": "string"},
      "description": "灵感种子：关键词、参考作品、趋势话题"
    },
    "constraints": {
      "type": "object",
      "properties": {
        "genre_preference": {"type": "string"},
        "avoid_genres": {"type": "array"},
        "target_platform": {"type": "string"},
        "content_rating": {"type": "string"},
        "budget_tier": {"type": "string"}
      }
    },
    "idea_to_evaluate": {
      "type": "string",
      "description": "待评估的创意（evaluate模式）"
    },
    "num_drafts": {
      "type": "number",
      "default": 3,
      "description": "生成的创意草案数量"
    }
  },
  "required": ["seeds"]
}
```

## Output Schema

```json
{
  "type": "object",
  "properties": {
    "trend_analysis": {
      "type": "object",
      "properties": {
        "hot_elements": {"type": "array"},
        "emotional_hooks": {"type": "array"},
        "uniqueness_factors": {"type": "array"}
      }
    },
    "creative_drafts": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "title": {"type": "string"},
          "hook": {"type": "string"},
          "core_conflict": {"type": "string"},
          "unique_selling_point": {"type": "string"},
          "suggested_genre": {"type": "string"},
          "recombination_source": {"type": "string"}
        }
      }
    },
    "evaluation": {
      "type": "object",
      "properties": {
        "creativity_score": {"type": "number"},
        "feasibility_score": {"type": "number"},
        "context_match": {"type": "string"},
        "strengths": {"type": "array"},
        "risks": {"type": "array"},
        "recommendations": {"type": "array"}
      }
    },
    "gdd_draft": {
      "type": "object",
      "properties": {
        "title": {"type": "string"},
        "core_concept": {"type": "string"},
        "world_brief": {"type": "string"},
        "gameplay_loop": {"type": "string"},
        "monetization_potential": {"type": "string"},
        "visual_references": {"type": "array"}
      }
    }
  }
}
```

---

## Examples

### Example 1: 创意生成

```
用户: 给我一些"武侠+科幻"的创意点子

调用: @narrative-lab
参数: {
  "mode": "generate",
  "seeds": ["武侠", "科幻", "江湖"],
  "num_drafts": 3
}
```

**输出示例**:
```json
{
  "creative_drafts": [
    {
      "title": "赛博剑客",
      "hook": "在义体横行的未来，唯有剑意不可复制",
      "core_conflict": "传统武道 vs 科技增强",
      "unique_selling_point": "用神经接口体验内功心法",
      "suggested_genre": "科幻+武侠",
      "recombination_source": "赛博朋克的义体 + 武侠的内功体系"
    },
    {
      "title": "长安2099",
      "hook": "千年后的长安，江湖依然在",
      "core_conflict": "AI掌控的社会 vs 人情世故的江湖",
      "unique_selling_point": "唐风美学与霓虹灯的碰撞",
      "suggested_genre": "科幻+武侠+历史架空"
    }
  ]
}
```

### Example 2: 创意评估

```
用户: 帮我评估一下"AI觉醒要求人权"这个创意

调用: @narrative-lab
参数: {
  "mode": "evaluate",
  "idea_to_evaluate": "一个关于AI觉醒后要求人权的游戏"
}
```

### Example 3: 完整流程（脑暴→评估→GDD）

```
用户: 帮我从头脑暴一个末世题材的游戏创意，并生成策划案

调用: @narrative-lab
参数: {
  "mode": "full",
  "seeds": ["末世", "生存", "希望"],
  "constraints": {
    "target_platform": "PC/Console",
    "budget_tier": "AA"
  }
}
```

---

## Execution (执行指令)

**⚠️ 重要：执行此 Skill 前，必须加载对应的详细方法论文档。**

```
assets/prompts/
├── narrative_lab_architecture.md  ← 实验室总体架构（必读）
├── trend_scraper_skill.md         ← 趋势采集方法论
├── recombinator_skill.md          ← 创意重构方法论
├── evaluator_skill.md             ← 双重评估方法论
├── gdd_generator_skill.md         ← GDD生成方法论
└── synergy_guesses_library.md     ← 跨领域拼接案例库

references/
└── workflow.yaml                  ← 工作流定义（声明式，含流程图和示例）
```

### 执行流程

1. **读取架构**: 先读 `narrative_lab_architecture.md` 了解实验室闭环流程
2. **按模式执行**:
   - `mode=generate`: 读取 trend_scraper + recombinator
   - `mode=evaluate`: 读取 evaluator_skill
   - `mode=gdd`: 读取 gdd_generator_skill
   - `mode=full`: 依次读取全部
3. **参考案例库**: `synergy_guesses_library.md` 提供跨领域拼接灵感

---

## Failure Modes & Fallback

- **创意过于平庸**: 参考 synergy_guesses_library 获取更激进的拼接思路
- **评估分数过低**: 提供 pivoting 建议而非直接否定
- **GDD 过于笼统**: 回溯 evaluate 阶段细化核心卖点
