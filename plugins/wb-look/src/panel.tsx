// P3.0+ placeholder entry shim — @forgeax-plugin/wb-look (kind=workbench)
// modules/02 §55 + §530 step #3 — entry.frontend file must exist for
// schemaValidation; Phase 6+ replaces with built ./dist/panel.esm.js
// (browser ESM mounted into the workbench iframe).
//
// Until then: import is side-effect free (no top-level throw / I/O), so
// AgentLoader / WorkbenchHost can resolve the entry path without blowing
// up the BusServer.start() pipeline. render()/createPanel() throws
// "[Phase 6+ shim] ... 未实现" so any consumer that tries to mount this
// panel gets a loud signal.

export interface WorkbenchPanelHandle {
  unmount(): void;
}

const PHASE_6_PLUS_MESSAGE =
  "[Phase 6+ shim] @forgeax-plugin/wb-look · WorkbenchPanel React render 未实现。" +
  "当前为 marketplace placeholder · Phase 6+ 拆 plugin 时填实际 React panel impl";

export function render(_target: unknown): WorkbenchPanelHandle {
  throw new Error(PHASE_6_PLUS_MESSAGE);
}

export function createPanel(): never {
  throw new Error(PHASE_6_PLUS_MESSAGE);
}

export const __placeholder = true as const;
