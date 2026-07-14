import type { TierId } from "../../types/index.js";
import type { NeedsKey, NeedsScore } from "../universal-agent/types.js";
import type { PipelineTemplateId } from "../templates.js";
import type { NarrativeType } from "../../knowledge/genre-narrative-type.js";

export interface PlannerInput {
  genre_code: string;
  tier: TierId;
  needs: Partial<Record<NeedsKey, NeedsScore>>;
  narrative_type: NarrativeType;
  pipelineTemplate?: PipelineTemplateId;
}

export interface PlannerOutput {
  /** 有序步骤序列，string[] 表示并行组 */
  stepGroups: (string | string[])[];
  /** Planner 决策日志 */
  metadata: {
    resolvedTemplate: PipelineTemplateId | "needs-driven";
    selectedSteps: string[];
    parallelGroups: string[][];
    skippedByThreshold: string[];
  };
}

export interface PresetConfig {
  /** 固定步骤序列（不受 needs 影响） */
  fixedSteps?: string[];
  /** 基线步骤（必选） */
  baseSteps?: string[];
  /** 可选步骤（受 needs 阈值控制） */
  optional?: Record<string, Partial<Record<NeedsKey, number>>>;
  /** 跳过偏好三件套 */
  skipPreference?: boolean;
}
