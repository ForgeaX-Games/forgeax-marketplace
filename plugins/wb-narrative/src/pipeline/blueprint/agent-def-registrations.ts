/**
 * blueprint/agent-def-registrations.ts
 *
 * 所有步骤的 AgentDef 注册。副作用文件：import 后自动注册。
 *
 * 过渡期策略：
 *   - 已迁移到 .md 模板的 step → 完整 AgentDef 注册
 *   - 未迁移的 step → 依赖 assembler.ts 中的 StepDescriptor 桥接
 *
 * 随着 Phase 2 逐步推进，此文件中的注册项会越来越多，
 * 直到所有 step 都有独立的 AgentDef，彼时可移除桥接逻辑。
 */
import { registerAgentDef } from "./agent-def-registry.js";
import { registerValidator } from "./processor-registry.js";
import type { AgentDef } from "./types.js";
import { extractJSON } from "../llm-client.js";
import type { NarrativeCard, VnLogline } from "../../types/index.js";

// ════════════════════════════════════════════════════════
// narrative_card — 叙事卡（Tier4 最简步骤）
// ════════════════════════════════════════════════════════

registerValidator("narrative_card_validator", (raw) => {
  const card = extractJSON<NarrativeCard>(raw);
  if (!card.game_name || !card.one_liner || !card.story) {
    throw new Error("叙事卡缺少必需字段: game_name/one_liner/story");
  }
});

const narrativeCardDef: AgentDef = {
  id: "narrative_card",
  name: "叙事卡",
  structure: {
    type: "single-turn",
    config: {
      temperature: 0.8,
      responseFormat: "json",
      retryCount: 3,
    },
  },
  prompts: {
    templateId: "narrative-card",
    skillSlots: ["style_guide", "constraints"],
  },
  io: {
    requiredInputs: ["user_input"],
    outputField: "narrative_card",
    // 声明式算子消费（T1）：本 step 即为单一事实源，覆盖 OPERATOR_SLOT_REGISTRY 默认值。
    consumesIpDna: {
      slots: ["风格算子", "情感算子"],
      kag: false,
      ledger: true,
      queryHint: "叙事卡片表达",
    },
  },
  dependencies: [],
  validators: ["narrative_card_validator"],
  extractOutputKey: "narrative_card",
};

registerAgentDef(narrativeCardDef);

// ════════════════════════════════════════════════════════
// vn_logline — 影游 E1-01 用户需求预处理
// ════════════════════════════════════════════════════════

registerValidator("vn_logline_validator", (raw) => {
  const parsed = extractJSON<VnLogline>(raw);
  if (!parsed.title?.trim()) throw new Error("缺少 title");
  if (!parsed.content?.trim()) throw new Error("缺少 content");
  if (parsed.content.length < 60) throw new Error("content 过短（要求 100-180 字）");
});

const vnLoglineDef: AgentDef = {
  id: "vn_logline",
  name: "一句话故事梗概",
  structure: {
    type: "single-turn",
    config: {
      temperature: 0.7,
      responseFormat: "json",
      retryCount: 3,
      streaming: true,
    },
  },
  prompts: {
    templateId: "vn-logline",
    skillSlots: ["style_guide", "constraints"],
  },
  io: {
    requiredInputs: ["user_input"],
    optionalInputs: ["uploaded_script"],
    outputField: "vn_logline",
  },
  dependencies: [],
  validators: ["vn_logline_validator"],
  extractOutputKey: "vn_logline",
};

registerAgentDef(vnLoglineDef);
