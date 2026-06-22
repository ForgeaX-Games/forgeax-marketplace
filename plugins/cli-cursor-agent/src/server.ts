// P3.0+ placeholder entry shim — @forgeax-plugin/cli-cursor-agent (kind=cli-provider)
// modules/02 §530 schemaValidation step #3 requires entry.backend file to exist.
// Phase 6+ will replace this with the actual ChatRequest runner shim that
// cursor-agent -p --output-format stream-json subprocess 适配. Until then: import is side-effect free (no top-level throw,
// no top-level I/O), so AgentLoader / parseManifest can resolve the entry
// path without blowing up the whole BusServer.start() pipeline. Calling
// activate()/createCliProvider() throws an explicit "Phase 6+ not
// implemented" error so any consumer that tries to actually wire this
// provider gets a loud signal.

export interface CliProviderHandle {
  deactivate(): void;
}

const PHASE_6_PLUS_MESSAGE =
  "[Phase 6+ shim] @forgeax-plugin/cli-cursor-agent · CliProvider runner 未实现。" +
  "当前为 marketplace placeholder · Phase 6+ 拆 plugin 时填实际 cursor-agent -p --output-format stream-json subprocess 适配";

export function activate(_ctx: unknown): CliProviderHandle {
  throw new Error(PHASE_6_PLUS_MESSAGE);
}

export function createCliProvider(): never {
  throw new Error(PHASE_6_PLUS_MESSAGE);
}

export const __placeholder = true as const;
