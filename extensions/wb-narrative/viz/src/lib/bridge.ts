/**
 * Narrative Viz ↔ host (workbench-ui) postMessage bridge protocol.
 *
 * Inbound (host → narrative-viz):
 *   narrative:load-run             — Load and display a specific run by ID
 *   narrative:reload               — Re-fetch current run status
 *   narrative:trigger-regenerate   — Host triggers regeneration of a step
 *   narrative:attach-run           — Attach UI to a run started externally (e.g. by 剧情师 Kotone
 *                                    via the narrative:start-pipeline tool). Sets runningRunId so
 *                                    the SSE stream drives the center preview live, and回填 INPUT/
 *                                    ROUTING 选择器 so the left toolbar reflects what the agent chose.
 *
 * Outbound (narrative-viz → host):
 *   narrative:ready                — Viz has loaded, ready to receive commands
 *   narrative:run-started          — A new pipeline run has been started
 *   narrative:run-completed        — Pipeline run finished successfully
 *   narrative:run-failed           — Pipeline run failed
 *   narrative:step-changed         — A pipeline step changed status
 *   narrative:progress             — Step progress with numeric details
 *   narrative:regenerate-requested — Viz requests regeneration of a step
 *   narrative:step-approved        — User approved a step's output
 *   narrative:step-rejected        — User rejected a step's output
 *   narrative:content-edited       — User saved edits to a step/node
 *   narrative:lifecycle-changed    — Step lifecycle state changed (editing/modified/stale)
 *   narrative:surface-snapshot     — Surface state snapshot for AI DUAL-MODALITY
 */

export type InboundEvent =
  | { type: "narrative:load-run"; payload: { runId: string } }
  | { type: "narrative:reload" }
  | { type: "narrative:trigger-regenerate"; payload: { stepId: string; instructions?: string } }
  | {
      type: "narrative:attach-run";
      payload: {
        runId: string;
        /** 后端 /start 返回的 sourceDir（输出目录名）。缺省时退化用 runId 作 entryKey。 */
        entryKey?: string;
        tier?: string;
        mode?: string;
        genreCode?: string | null;
        /** agent 解析出的用户需求原文（回填 INPUT 框）。 */
        userInput?: string;
        routeGroup?: "planning" | "narrative";
      };
    };

export type OutboundEvent =
  | { type: "narrative:ready" }
  | { type: "narrative:run-started"; payload: { runId: string; tier?: string; mode?: string } }
  | { type: "narrative:run-completed"; payload: { runId: string } }
  | { type: "narrative:run-failed"; payload: { runId: string; error: string } }
  | { type: "narrative:step-changed"; payload: { stepId: string; status: string; label?: string } }
  | { type: "narrative:progress"; payload: { stepId: string; label?: string; step: number; totalSteps: number; status: string } }
  | { type: "narrative:regenerate-requested"; payload: { stepId: string; instructions?: string } }
  | { type: "narrative:step-approved"; payload: { stepId: string } }
  | { type: "narrative:step-rejected"; payload: { stepId: string; reason?: string } }
  | { type: "narrative:content-edited"; payload: { stepId: string; nodeId?: string; hasUserInput: boolean } }
  | { type: "narrative:lifecycle-changed"; payload: { stepId: string; lifecycle: string; previousLifecycle?: string } }
  | { type: "narrative:surface-snapshot"; payload: { surface: string; snapshot: Record<string, unknown> } };

const isEmbedded = typeof window !== "undefined" && window.parent !== window;

export function sendToHost(event: OutboundEvent): void {
  if (isEmbedded) {
    window.parent.postMessage(event, "*");
  }
}

export function onHostMessage(handler: (event: InboundEvent) => void): () => void {
  const listener = (e: MessageEvent) => {
    if (typeof e.data?.type === "string" && e.data.type.startsWith("narrative:")) {
      handler(e.data as InboundEvent);
    }
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

export function notifyReady(): void {
  sendToHost({ type: "narrative:ready" });
}

/**
 * 叙事角色拖入右侧平台对话（Composer）时用的载荷。
 */
export interface ComposerRoleInsert {
  /** 角色显示名（对话里以 "@<name>" 开头）。 */
  name: string;
  /** 五大类之一：input/routing/expert/assistant/engineer。 */
  category: string;
  /** 目录 item id（溯源）。 */
  catalogId: string;
  /** 专家预制管线模板（若有）。 */
  pipelineTemplate?: string;
  /** 默认叙事层级（若有）。 */
  tier?: string | null;
  routeGroup?: string;
  /** 工程师对应的生成环节 step id（若有）。 */
  stepId?: string;
  /** 助手对应的叙事策略 mode（若有）。 */
  modeId?: string;
}

/**
 * 把叙事角色组织为一段"@角色 + 结构化上下文"文本。宿主平台 agent（kotone）读到后
 * 能据此选择对应的 narrative:* 工具（start-pipeline / regenerate-step / ip-dna-* 等）规划执行。
 */
function formatRoleText(role: ComposerRoleInsert): string {
  const attrs: string[] = [`category=${role.category}`];
  if (role.pipelineTemplate) attrs.push(`pipeline=${role.pipelineTemplate}`);
  if (role.tier) attrs.push(`tier=${role.tier}`);
  if (role.routeGroup) attrs.push(`routeGroup=${role.routeGroup}`);
  if (role.stepId) attrs.push(`step=${role.stepId}`);
  if (role.modeId) attrs.push(`strategy=${role.modeId}`);
  return `@${role.name} [叙事角色: ${attrs.join(" ")}，请据此选择对应的 narrative:* 工具规划并执行]`;
}

/**
 * 把一个叙事角色发送到宿主 Chat 的 composer。
 *
 * 复用宿主 PluginIframeHost **既有的** `FORGEAX_COMPOSER_INSERT` + `text` 通用文本通道
 * （上游即已存在），因此**不需要改动宿主 interface 仓库**——整功能内聚在叙事仓库内，
 * 适配"只维护叙事仓库、其它子模块用上游"的工作流，`fx update` reset interface 也不受影响。
 *
 * 跨 iframe 原生拖拽无法直达宿主，故用 postMessage 兜底：拖拽释放 / 点击"@"均走此函数。
 */
export function sendRoleToComposer(role: ComposerRoleInsert): void {
  sendTextToComposer(formatRoleText(role));
}

/**
 * 项目产物文件在对话里的引用。
 *
 * 与角色 @ 同一条通道，只是载荷换成"这是哪个项目的哪份产物"，
 * 让平台 agent 能直接对这份文件动手（读、改、以它为输入重跑下游）。
 */
export interface ProjectFileInsert {
  /** 条目 key（输出目录名）。 */
  entryKey: string;
  /** `<group>/<相对路径>`，与 GET /files/:key 同形。 */
  path: string;
  /** 展示名（文件名）。 */
  name: string;
  /** 内容类型 id（角色档案 / 道具清单 …）。 */
  contentType?: string;
}

function formatFileText(file: ProjectFileInsert): string {
  const attrs = [`entry=${file.entryKey}`, `path=${file.path}`];
  if (file.contentType) attrs.push(`type=${file.contentType}`);
  return `@${file.name} [叙事产物: ${attrs.join(" ")}，请据此选择对应的 narrative:* 工具规划并执行]`;
}

export function sendFileToComposer(file: ProjectFileInsert): void {
  sendTextToComposer(formatFileText(file));
}

function sendTextToComposer(text: string): void {
  if (!isEmbedded) return;
  window.parent.postMessage({ type: "FORGEAX_COMPOSER_INSERT", text }, "*");
}
