import type { EntryStatus } from "../utils/stepDisplay";

/**
 * 顶层交互 phase（单一 SSOT，§状态机重构）。抽到独立无副作用模块，便于纯函数单测
 * （narrativeStore 在模块加载期建立 BroadcastChannel / host 订阅，不适合直接在 Node 测试环境导入）。
 *
 * 语义映射（对应产品 2.1–2.7）：
 *  - idle       未开始：无输入确认、无条目、无预处理节点
 *  - input      已确认输入（条目已建）但 ROUTING 未选定；预处理各步在此阶段进行（纯算法，无 LLM）
 *  - routed     ROUTING 已选定，可点「开始生成」
 *  - generating 下游生成进行中（SSE run 或 IP DNA 下游 job）
 *  - done       生成完成
 */
export type NarrativePhase = "idle" | "input" | "routed" | "generating" | "done";

/** computePhase 的最小输入契约（仅 phase 派生所需字段）。 */
export interface PhaseInput {
  runningRunId: string | null;
  ipDnaGenerating: boolean;
  activeEntryStatus: EntryStatus;
  activeEntryKey: string | null;
  inputConfirmed: boolean;
  routingConfigured: boolean;
  runningProgress: Array<{ id: string }>;
  /**
   * 分叉待决（§状态机核心，泛化自 point2）：在已独立条目（config/预处理/中断/完成）改了 INPUT/ROUTING（=新需求）。
   * 预览仍停在旧条目；此标记只点亮相应提交键，真正 fork 新条目在提交动作时发生。
   */
  pendingFork: boolean;
  /**
   * 分叉改动类型：仅 "routing" 顶成 routed（点亮「开始生成」）；
   * "input" 由 INPUT 区「确认」按钮承接（不改 phase），故此处不点亮底部键。
   */
  pendingForkKind: "input" | "routing" | null;
}

/**
 * 顶层 phase 的纯派生。优先级：generating > (done | routed 分叉待决) > (routed | input) > idle。
 * 中断态（activeEntryStatus="interrupted"）算作"已有输入、可再次开始"，故落回 routed/input，
 * 使「开始生成」按需重新点亮（对应 2.6 被动中断后开始生成亮）。
 */
export function computePhase(s: PhaseInput): NarrativePhase {
  if (s.runningRunId || s.ipDnaGenerating) return "generating";
  // §状态机核心：ROUTING 分叉待决——在任意已独立条目（含中断/完成）改了路由，
  // 顶成 routed 点亮「开始生成」（提交动作铸新条目）；预览仍锚旧条目（activeEntryKey 不变）。
  if (s.pendingFork && s.pendingForkKind === "routing") return "routed";
  // 完成态：默认 done（两键灰）。INPUT 分叉由「确认」按钮承接，phase 保持 done。
  if (s.activeEntryStatus === "completed") return "done";
  const hasInput =
    s.inputConfirmed ||
    !!s.activeEntryKey ||
    s.runningProgress.some((st) => st.id.startsWith("ip_"));
  if (!hasInput) return "idle";
  if (s.routingConfigured) return "routed";
  return "input";
}
