// P3.0+ placeholder entry shim — @forgeax-plugin/model-anthropic-text (kind=model-binding)
// modules/02 §530 schemaValidation step #3 requires entry.backend file to exist.
// Phase 6+ will replace this with the actual ModelBindingPlugin impl that wires
// Anthropic API calls for the text channel (reasoning/draft/summarize roles).
// Until then: import is side-effect free; calling activate() throws.

export interface ModelBindingHandle {
  deactivate(): void;
}

const PHASE_6_PLUS_MESSAGE =
  "[Phase 6+ shim] @forgeax-plugin/model-anthropic-text · ModelBindingPlugin 未实现。" +
  "当前为 marketplace placeholder · Phase 6+ 拆 plugin 时填实际 Anthropic text channel binding (reasoning/draft/summarize roles)";

export function activate(_ctx: unknown): ModelBindingHandle {
  throw new Error(PHASE_6_PLUS_MESSAGE);
}

export function createModelBinding(): never {
  throw new Error(PHASE_6_PLUS_MESSAGE);
}

export const __placeholder = true as const;
