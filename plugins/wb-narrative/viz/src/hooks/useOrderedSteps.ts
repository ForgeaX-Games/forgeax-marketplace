import { useMemo } from "react";
import { useNarrativeStore, canonicalStepId, type StepState } from "../store/narrativeStore";

/**
 * 「加载对象 + 顺序」的唯一权威选择器。文本阅读模式（TextViewPanel）与
 * 可视化节点模式（NarrativeCanvas）都调用它，保证两种模式永远同源、同序。
 *
 * 排序权威来源：
 *  - 正在查看运行中的 run → 全局 `pipelineOrder`（后端 announce 下发）
 *  - 已完成 / 历史 entry  → 该 entry 固化的 `activeConfig.pipelineOrder`
 *
 * 关键约束：
 *  - 用 `canonicalStepId` 归一后再匹配，合并步骤（initial_plan 等）的旧 id 也能命中
 *    权威序，不会被当成"序外节点"甩到最后一列。
 *  - 仍保留"序外"的 progress（extras）到末尾——RPG 的 script_scene_generation 拆分、
 *    quest/scene 复合、校验子节点都不在 pipelineOrder 里，删掉会丢节点。
 */
export function useOrderedSteps(): StepState[] {
  const activeEntryKey = useNarrativeStore((s) => s.activeEntryKey);
  const runningEntryKey = useNarrativeStore((s) => s.runningEntryKey);
  const runningRunId = useNarrativeStore((s) => s.runningRunId);
  const runningProgress = useNarrativeStore((s) => s.runningProgress);
  const activeSteps = useNarrativeStore((s) => s.activeSteps);
  const pipelineOrder = useNarrativeStore((s) => s.pipelineOrder);
  const activeConfigOrder = useNarrativeStore((s) => s.activeConfig?.pipelineOrder);

  const isViewingRunning = activeEntryKey === runningEntryKey && !!runningRunId;
  const rawSteps = isViewingRunning ? runningProgress : activeSteps;
  const order = isViewingRunning ? pipelineOrder : activeConfigOrder ?? [];

  return useMemo(() => {
    if (order.length === 0) return rawSteps;

    // canon-keyed 索引；同一 canon 下保留首次出现的 step
    const byCanon = new Map<string, StepState>();
    for (const s of rawSteps) {
      const key = canonicalStepId(s.id);
      if (!byCanon.has(key)) byCanon.set(key, s);
    }

    const used = new Set<string>();
    const ordered: StepState[] = [];
    for (const id of order) {
      const key = canonicalStepId(id);
      if (used.has(key)) continue;
      const s = byCanon.get(key);
      if (s) {
        ordered.push(s);
        used.add(key);
      }
    }

    const extras = rawSteps.filter((s) => !used.has(canonicalStepId(s.id)));
    return [...ordered, ...extras];
  }, [order, rawSteps]);
}
