import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  MapPin,
  GitBranch,
  MessageSquare,
  Film,
  FolderTree,
  ClipboardList,
  BookOpen,
  Drama,
  CornerDownRight,
  type LucideIcon,
} from "lucide-react";
import { useNarrativeStore } from "../../store/narrativeStore";
import type { EditDraft } from "../../store/narrativeStore";
import { useTypewriter } from "../../hooks/useTypewriter";
import { useOrderedSteps } from "../../hooks/useOrderedSteps";
import type { NarrativeContext, StoryNode, SceneNode, PlotSynopsis } from "../../types";
import { STEP_CTX_FIELD, PIPELINE_STEPS } from "../../types";
import { ProgressRing } from "../controls/ProgressRing";
import { GenericObjectView, MarkdownBlock } from "../shared/GenericObjectView";
import { dataToReadableText } from "../shared/dataReadable";
import { NodeEditActions, NodeUserInputBox, NodeEditTextarea } from "../shared/NodeEditActions";
import { useNodeEdit } from "../../hooks/useNodeEdit";
import { sendToHost } from "../../lib/bridge";
import { resolveStepDisplay, getStepIcon } from "../../utils/stepDisplay";
import type { EntryStatus } from "../../utils/stepDisplay";
import { findStepsContainingNodeId } from "../../utils/cross-step-node";

const STEP_TAGS: Record<string, string[]> = {
  pipeline_config:      ["Tier", "Mode", "步骤数"],
  tier_router:          ["品类", "叙事强度", "叙事类型"],
  // 策划步骤 (D0-D4)
  core_concept:         ["核心概念", "三大循环", "叙事支柱"],
  system_architecture:  ["系统架构", "依赖图", "生成顺序"],
  system_detail:        ["玩法设计", "系统交互", "关键特性"],
  value_framework:      ["数值框架", "经济体系", "成长曲线"],
  design_doc:           ["策划案", "完整性", "叙事需求接口"],
  // 叙事步骤
  preference_summary:   ["核心要素", "期望体验", "特殊要求", "简短概述"],
  preference_analysis:  ["全局控制参数", "世界观维度", "框架层维度", "大纲层维度", "细纲层维度"],
  initial_outline:      ["大纲草稿"],
  core_settings:        ["世界设定", "主角", "关键NPC", "核心冲突"],
  worldview:            ["基础架构层", "交互叙事层", "核心规则"],
  plot_synopsis:        ["剧情策略", "核心亮点"],
  story_framework:      ["故事节点", "分支结构", "动态结构"],
  outline_batch:        ["L1大纲节点"],
  detailed_outline:     ["L2细纲节点", "故事元素"],
  character_enrichment: ["角色档案"],
  item_database:        ["道具清单", "类别", "稀有度"],
  plot_generation:      ["情节节点", "故事元素", "JRPG元素"],
  structure_validation_l3: ["L3验证", "修复日志"],
  script_generation:    ["剧本章节", "冲突张力", "场景描写"],
  quest_generation:     ["主线任务", "支线任务", "触发条件", "奖励"],
  scene_generation:     ["场景骨架", "场景展开", "场景合并"],
  narrative_card:       ["叙事卡片"],
  lore_generation:      ["Lore碎片"],
};

const STEP_LABEL_MAP = new Map(PIPELINE_STEPS.map((s) => [s.id, s.label]));

/** 跨步联动 chip 图标（lucide，与 Studio 产品图标规范一致） */
const CROSS_STEP_ICONS: Record<string, LucideIcon> = {
  branch_tree: GitBranch,
  dialogue_script: MessageSquare,
  cinematic_storyboard: Film,
  story_framework: FolderTree,
  outline_batch: ClipboardList,
  detailed_outline: BookOpen,
  plot_generation: Drama,
};


function resolveStepData(stepId: string, result: NarrativeContext | null): unknown {
  if (!result) return undefined;
  let field = STEP_CTX_FIELD[stepId];
  if (stepId === "script_generation") field = "jrpg_script";
  if (stepId === "scene_generation") field = "scene_map";
  if (stepId === "tier_router") field = "tier_detection";
  if (stepId === "core_concept") field = "core_concept";
  if (stepId === "system_architecture") field = "system_architecture";
  if (stepId === "system_detail") field = "system_details";
  if (stepId === "value_framework") field = "value_framework";
  if (stepId === "design_doc") field = "game_design_context";
  return field ? (result as Record<string, unknown>)[field] : undefined;
}

export function TextViewPanel() {
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);
  const activeEntryKey = useNarrativeStore((s) => s.activeEntryKey);
  const runningEntryKey = useNarrativeStore((s) => s.runningEntryKey);
  const activeResult = useNarrativeStore((s) => s.activeResult);
  const expandedStepId = useNarrativeStore((s) => s.expandedStepId);
  const focusedChildNodeId = useNarrativeStore((s) => s.focusedChildNodeId);
  const setFocus = useNarrativeStore((s) => s.setFocus);
  const editDrafts = useNarrativeStore((s) => s.editDrafts);
  const setEditDraft = useNarrativeStore((s) => s.setEditDraft);
  const clearEditDraft = useNarrativeStore((s) => s.clearEditDraft);

  const isViewingRunning = activeEntryKey === runningEntryKey;
  // 加载对象 + 顺序由 useOrderedSteps 统一计算（与可视化节点模式同源同序）。
  const steps = useOrderedSteps();
  const result = activeResult;
  // IP 半自动预览也设置了 runningEntryKey（见 startIpPreviewRun），故沿用同一判定即可。
  const isRunningState = isViewingRunning && !!runningEntryKey;
  const totalSteps = steps.length;
  const completedSteps = steps.filter((s) => s.status === "completed").length;
  const entryStatus = isViewingRunning && runningEntryKey ? "running" as EntryStatus : activeEntryStatus;

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusedChildNodeId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-node-id="${focusedChildNodeId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("node-highlight");
      const timer = setTimeout(() => el.classList.remove("node-highlight"), 2000);
      return () => clearTimeout(timer);
    }
  }, [focusedChildNodeId, expandedStepId]);

  useEffect(() => {
    if (!expandedStepId || !scrollRef.current) return;
    const timer = setTimeout(() => {
      const el = scrollRef.current?.querySelector(`[data-step-id="${expandedStepId}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => clearTimeout(timer);
  }, [expandedStepId]);

  const userScrolledRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 60;
      if (!nearBottom) {
        userScrolledRef.current = true;
        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = setTimeout(() => { userScrolledRef.current = false; }, 3000);
      } else {
        userScrolledRef.current = false;
      }
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isRunningState || userScrolledRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const timer = setTimeout(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }, 100);
    return () => clearTimeout(timer);
  }, [steps.length, isRunningState]);

  const animatingStepId = useNarrativeStore((s) => s.animatingStepId);
  const STORY_STEP_IDS = useMemo(() => new Set(
    PIPELINE_STEPS.filter((p) => p.type === "story").map((p) => p.id),
  ), []);

  const linkedStepIds = useMemo(
    () => focusedChildNodeId
      ? findStepsContainingNodeId(result, focusedChildNodeId, expandedStepId)
      : [],
    [result, focusedChildNodeId, expandedStepId],
  );

  if (!entryStatus && (!result || steps.length === 0)) {
    return (
      <div className="text-view empty-state">
        <div className="empty-text">[ 输入故事需求 · 点击开始生成 ]</div>
      </div>
    );
  }

  const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  return (
    <div className="text-view" ref={scrollRef}>
      {isRunningState && (
        <div className="text-progress-bar">
          <ProgressRing progress={progress} size={40} />
          <span className="text-progress-label">
            {steps.find((s) => s.status === "running")?.label ?? "准备中..."}
          </span>
        </div>
      )}

      {focusedChildNodeId && linkedStepIds.length > 0 && (
        <div className="cross-step-link-bar" data-node-id={focusedChildNodeId}>
          <span className="cross-step-link-icon" aria-hidden>
            <MapPin size={14} />
          </span>
          <span className="cross-step-link-label">
            节点 <code className="cross-step-link-node">{focusedChildNodeId}</code> 也出现在
          </span>
          {linkedStepIds.map((sid) => {
            const stepLabel = steps.find((st) => st.id === sid)?.label
              ?? STEP_LABEL_MAP.get(sid)
              ?? sid;
            const Icon = CROSS_STEP_ICONS[sid] ?? CornerDownRight;
            return (
              <button
                key={sid}
                className="cross-step-link-chip"
                title={`跳到「${stepLabel}」中的同一节点`}
                onClick={() => setFocus(sid, focusedChildNodeId)}
              >
                <span className="cross-step-link-chip-icon" aria-hidden>
                  <Icon size={12} />
                </span>
                <span className="cross-step-link-chip-label">{stepLabel}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="step-card-list">
        {steps.filter((s) => !s.id.startsWith("structure_validation")).map((s) => {
          const isExpanded = expandedStepId === s.id;
          const data = s.data ?? resolveStepData(s.id, result);
          const tags = STEP_TAGS[s.id] ?? [];
          const isStory = STORY_STEP_IDS.has(s.id);
          const isLocked = s.status === "running" && isRunningState && !isStory;
          const isAnimating = animatingStepId === s.id;
          const draft = editDrafts[s.id] as EditDraft | undefined;
          const canEdit = (entryStatus === "completed" || entryStatus === "interrupted") && s.status === "completed";
          const display = resolveStepDisplay(s.status as "completed" | "pending" | "running" | "failed", entryStatus, draft);

          return (
            <StepCard
              key={s.id}
              stepId={s.id}
              label={s.label || STEP_LABEL_MAP.get(s.id) || s.id}
              stepStatus={s.status}
              message={s.message}
              tags={tags}
              expanded={isExpanded}
              data={data}
              result={result}
              isRunning={s.status === "running" && isRunningState}
              isLocked={isLocked}
              isAnimating={isAnimating}
              canEdit={canEdit}
              draft={draft}
              displayState={display}
              onToggle={() => {
                if (!isLocked) setFocus(isExpanded ? null : s.id);
              }}
              onStartEdit={() => setEditDraft(s.id, { editing: true })}
              onSaveDraft={(content, userInput) => {
                setEditDraft(s.id, { content, userInput, editing: false, saved: true });
                sendToHost({
                  type: "narrative:content-edited",
                  payload: { stepId: s.id, hasUserInput: !!userInput?.trim() },
                });
              }}
              onCancelEdit={() => clearEditDraft(s.id)}
              onDraftChange={(content, userInput) => {
                if (content !== undefined) setEditDraft(s.id, { content });
                if (userInput !== undefined) setEditDraft(s.id, { userInput });
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function StepCard({
  stepId, label, stepStatus, message, tags, expanded, data, result, isRunning, isLocked, isAnimating,
  canEdit, draft, displayState,
  onToggle, onStartEdit, onSaveDraft, onCancelEdit, onDraftChange,
}: {
  stepId: string;
  label: string;
  stepStatus: string;
  message?: string;
  tags: string[];
  expanded: boolean;
  data: unknown;
  result: NarrativeContext | null;
  isRunning: boolean;
  isLocked?: boolean;
  isAnimating?: boolean;
  canEdit?: boolean;
  draft?: EditDraft;
  displayState: string;
  onToggle: () => void;
  onStartEdit?: () => void;
  onSaveDraft?: (content?: string, userInput?: string) => void;
  onCancelEdit?: () => void;
  onDraftChange?: (content?: string, userInput?: string) => void;
}) {
  const [showInput, setShowInput] = useState(false);
  const [localEditing, setLocalEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [userInputText, setUserInputText] = useState(draft?.userInput ?? "");

  const isInEditState = draft?.editing || localEditing;
  const statusIcon = getStepIcon(displayState as Parameters<typeof getStepIcon>[0]);

  const colorCls = isLocked ? " color-locked"
    : displayState === "editing" ? " color-editing"
    : displayState === "draft_ready" ? " color-modified"
    : isAnimating ? " color-fresh"
    : "";

  const displayBadge =
    displayState === "editing" ? "编辑中" :
    displayState === "draft_ready" ? "已修改" :
    displayState === "incomplete" ? "未完成" :
    null;

  const handleEdit = () => {
    const textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    setEditContent(typeof draft?.content === "string" ? draft.content : textContent);
    setLocalEditing(true);
    onStartEdit?.();
  };

  const handleSave = () => {
    onSaveDraft?.(localEditing ? editContent : undefined, userInputText || undefined);
    setLocalEditing(false);
    setShowInput(false);
  };

  const handleCancel = () => {
    setLocalEditing(false);
    setShowInput(false);
    setEditContent("");
    setUserInputText("");
    onCancelEdit?.();
  };

  return (
    <div className={`text-step-card status-${displayState}${colorCls} ${expanded ? "expanded" : ""}`} data-step-id={stepId}>
      <div className="tsc-header" onClick={onToggle} style={isLocked ? { cursor: "not-allowed" } : undefined}>
        <span className={`tsc-status-icon status-${displayState}`}>{statusIcon}</span>
        <span className="tsc-title">{label}</span>
        {displayBadge ? (
          <span className={`tsc-badge lifecycle-${displayState}`}>{displayBadge}</span>
        ) : (
          <span className={`tsc-badge status-${displayState}`}>{displayState}</span>
        )}
        {!isLocked && <span className="tsc-expand-arrow">{expanded ? "▾" : "▸"}</span>}
        {isLocked && <span className="tsc-lock-icon">🔒</span>}
      </div>

      {!expanded && tags.length > 0 && (
        <div className="tsc-tags" onClick={onToggle}>
          {tags.map((t) => (
            <span key={t} className="tsc-tag">{t}</span>
          ))}
        </div>
      )}
      {!expanded && message && (stepStatus === "running" || (stepStatus === "completed" && tags.length === 0)) && (
        <div className="tsc-running-msg">{message}</div>
      )}
      {expanded && (
        <div className="tsc-body">
          {isInEditState ? (
            <textarea
              className="tsc-edit-textarea"
              value={editContent}
              onChange={(e) => {
                setEditContent(e.target.value);
                onDraftChange?.(e.target.value, undefined);
              }}
              rows={12}
            />
          ) : (
            <StreamingContent
              stepId={stepId}
              stepStatus={stepStatus}
              data={data}
              result={result}
              isRunning={isRunning}
              isAnimating={isAnimating}
              message={message}
            />
          )}
        </div>
      )}

      {showInput && expanded && (
        <div className="tsc-user-input-box">
          <textarea
            className="tsc-user-input-textarea"
            placeholder="输入修改意见或新需求..."
            value={userInputText}
            onChange={(e) => {
              setUserInputText(e.target.value);
              onDraftChange?.(undefined, e.target.value);
            }}
            rows={3}
          />
        </div>
      )}

      {expanded && canEdit && (
        <div className="tsc-actions tsc-four-buttons">
          <button
            className={`tsc-action-btn edit${isInEditState ? " active" : ""}`}
            onClick={(e) => { e.stopPropagation(); handleEdit(); }}
            title="直接编辑内容"
            disabled={!!isInEditState}
          >
            编辑
          </button>
          <button
            className={`tsc-action-btn input${showInput ? " active" : ""}`}
            onClick={(e) => { e.stopPropagation(); setShowInput(!showInput); }}
            title="输入修改意见/指令"
          >
            输入
          </button>
          <button
            className="tsc-action-btn save"
            onClick={(e) => { e.stopPropagation(); handleSave(); }}
            title="保存编辑和输入"
            disabled={!isInEditState && !userInputText.trim()}
          >
            保存
          </button>
          <button
            className="tsc-action-btn cancel"
            onClick={(e) => { e.stopPropagation(); handleCancel(); }}
            title="取消修改"
          >
            取消
          </button>
        </div>
      )}
    </div>
  );
}

function StreamingContent({
  stepId, stepStatus, data, result, isRunning, isAnimating, message,
}: {
  stepId: string;
  stepStatus: string;
  data: unknown;
  result: NarrativeContext | null;
  isRunning: boolean;
  isAnimating?: boolean;
  message?: string;
}) {
  const streamChunk = useNarrativeStore((s) => s.streamingChunks[stepId]);
  const streamPlayed = useNarrativeStore((s) => s.streamPlayedSteps.includes(stepId));
  const finishAnimation = useNarrativeStore((s) => s.finishAnimation);

  if (isRunning && streamChunk && !streamPlayed) {
    const isJson = stepId !== "preference_summary" && stepId !== "initial_outline";
    return (
      <div className="streaming-live">
        {isJson ? (
          <pre className="streaming-code">{streamChunk}<span className="cursor">|</span></pre>
        ) : (
          <div className="streaming-md">
            <MarkdownBlock text={streamChunk} />
            <span className="cursor">|</span>
          </div>
        )}
      </div>
    );
  }

  if (data && isAnimating && !streamPlayed) {
    return (
      <FirstViewTypewriter
        stepId={stepId}
        data={data}
        result={result}
        onComplete={() => finishAnimation(stepId)}
      />
    );
  }

  if (data) {
    return <StepRenderer stepId={stepId} data={data} result={result} isRunning={isRunning} />;
  }

  if (message) {
    return <div className="tsc-message">{message}</div>;
  }

  return (
    <div className="tsc-empty">
      {stepStatus === "running" ? "正在生成中..." : stepStatus === "pending" ? "等待执行..." : "暂无数据"}
    </div>
  );
}

function FirstViewTypewriter({
  stepId, data, result, onComplete,
}: {
  stepId: string;
  data: unknown;
  result: NarrativeContext | null;
  onComplete: () => void;
}) {
  const fullText = useMemo(() => dataToReadableText(data), [data]);
  const displayed = useTypewriter(fullText, true, 30);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!doneRef.current && displayed.length >= fullText.length) {
      doneRef.current = true;
      const timer = setTimeout(onComplete, 300);
      return () => clearTimeout(timer);
    }
  }, [displayed, fullText, onComplete]);

  if (displayed.length >= fullText.length) {
    return <StepRenderer stepId={stepId} data={data} result={result} isRunning={false} />;
  }

  return (
    <div className="streaming-reveal">
      <MarkdownBlock text={displayed} />
      <span className="cursor">|</span>
    </div>
  );
}

function StreamText({ text, isRunning }: { text: string; isRunning: boolean }) {
  const displayed = useTypewriter(text, isRunning, 30);
  if (isRunning && displayed.length < text.length) {
    return (
      <pre className="section-pre stream-text">
        {displayed}
        <span className="cursor">|</span>
      </pre>
    );
  }
  return <MarkdownBlock text={text} />;
}


// ══════════════════════════════════════════════════════════════════════════════
// Step renderer dispatch
// ══════════════════════════════════════════════════════════════════════════════

function StepRenderer({
  stepId, data, result, isRunning,
}: {
  stepId: string;
  data: unknown;
  result: NarrativeContext | null;
  isRunning: boolean;
}) {
  if (stepId === "preference_summary" && typeof data === "string") {
    return <StreamText text={data} isRunning={isRunning} />;
  }

  // 合并步骤 initial_plan：依次展示 outline / core_settings / plot_synopsis 三段。
  // 数据源优先级：result（最新）→ data（聚合对象，断点恢复时用）。
  if (stepId === "initial_plan") {
    return <InitialPlanView result={result} data={data} />;
  }

  if (stepId === "preference_analysis" && data && typeof data === "object") {
    return <PreferenceAnalysisView data={data as Record<string, unknown>} />;
  }

  if (stepId === "worldview" && result?.worldview_structure) {
    return <WorldviewView wv={result.worldview_structure} />;
  }

  // ── 向后兼容：老存档可能还存在独立的 initial_outline / core_settings / plot_synopsis 节点 ──
  // 当前主流程已合并为 initial_plan，但若用户直接访问老节点（例如旧存档 step_done 帧），仍能渲染。
  if (stepId === "initial_outline" && typeof data === "string") {
    return <StreamText text={data} isRunning={isRunning} />;
  }
  if (stepId === "core_settings" && result?.core_settings) {
    return <CoreSettingsView cs={result.core_settings} />;
  }
  if (stepId === "plot_synopsis" && result?.plot_synopsis) {
    return <PlotSynopsisView ps={result.plot_synopsis} />;
  }

  if (stepId === "story_framework" && result?.story_framework) {
    return (
      <div>
        <FullNodesTable
          nodes={result.story_framework.framework.nodes}
          nodeType="framework"
          stepId="story_framework"
        />
        {result.story_framework.dynamic_structure?.branch_groups &&
          result.story_framework.dynamic_structure.branch_groups.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div className="result-section-title">分支结构</div>
            <GenericObjectView data={result.story_framework.dynamic_structure.branch_groups} />
          </div>
        )}
      </div>
    );
  }

  if (stepId === "outline_batch" && result?.outlines_generated) {
    const outlines = result.outlines_generated.outlines;
    return (
      <div>
        <FullNodesTable nodes={outlines} nodeType="outline" stepId="outline_batch" />
        <BranchSummary nodes={outlines} />
      </div>
    );
  }

  if (stepId === "detailed_outline" && result?.detailed_outlines_generated) {
    const detailedOutlines = result.detailed_outlines_generated.detailed_outlines;
    return (
      <div>
        <FullNodesTable nodes={detailedOutlines} nodeType="detailed" stepId="detailed_outline" />
        <BranchSummary nodes={detailedOutlines} />
      </div>
    );
  }

  if (stepId === "plot_generation" && result?.plots_generated) {
    return <FullNodesTable nodes={result.plots_generated.plots as unknown as StoryNode[]} nodeType="plot" stepId="plot_generation" />;
  }

  if (stepId === "character_enrichment" && result?.detailed_character_sheets) {
    return <FullCharactersView characters={result.detailed_character_sheets} />;
  }

  if (stepId === "item_database" && result?.item_database) {
    return <FullItemDatabaseView items={result.item_database} />;
  }

  if (stepId === "script_generation" && result?.jrpg_script) {
    return <FullScriptView script={result.jrpg_script} />;
  }

  if (stepId === "quest_generation" && result?.quest_graph) {
    return <FullQuestGraphView questGraph={result.quest_graph} />;
  }

  if (stepId === "scene_generation" && result?.scene_map) {
    return <FullSceneTreeView sceneMap={result.scene_map} />;
  }

  // E1-02 三幕扩写：单步三输出（三幕大纲 + 人物小传 + 关键道具）。
  // 后端把三份子结构分别写入 vn_outline_acts / vn_character_bios / vn_key_items，
  // 这里合并展示，避免只看到剧情而漏掉人物与道具。
  if (stepId === "vn_outline_acts") {
    return <VnOutlineActsView result={result} data={data} />;
  }

  if (typeof data === "string") {
    return <StreamText text={data} isRunning={isRunning} />;
  }
  return <GenericObjectView data={data} />;
}

// ══════════════════════════════════════════════════════════════════════════════
// Initial Plan (合并视图：outline + core_settings + plot_synopsis)
// ══════════════════════════════════════════════════════════════════════════════

interface InitialPlanData {
  initial_story_outline?: NarrativeContext["initial_story_outline"];
  core_settings?: NarrativeContext["core_settings"];
  plot_synopsis?: NarrativeContext["plot_synopsis"];
}

function InitialPlanView({
  result, data,
}: {
  result: NarrativeContext | null;
  data: unknown;
}) {
  // 优先用 result（顶层 ctx，永远是最新），其次 data（断点续传时 step_done 携带的聚合对象）
  const aggregated = (data && typeof data === "object" ? data as InitialPlanData : null);
  const outline = result?.initial_story_outline ?? aggregated?.initial_story_outline ?? null;
  const cs = result?.core_settings ?? aggregated?.core_settings ?? null;
  const ps = result?.plot_synopsis ?? aggregated?.plot_synopsis ?? null;

  if (!outline && !cs && !ps) {
    return <div className="tsc-empty">暂无数据</div>;
  }

  return (
    <div className="initial-plan-view">
      {outline && (
        <section className="ip-section">
          <h3 className="ip-title">📋 初步大纲</h3>
          <InitialOutlineSection outline={outline} />
        </section>
      )}
      {cs && (
        <section className="ip-section">
          <h3 className="ip-title">⚙️ 核心设定</h3>
          <CoreSettingsView cs={cs} />
        </section>
      )}
      {ps && (
        <section className="ip-section">
          <h3 className="ip-title">📖 剧情简介</h3>
          <PlotSynopsisView ps={ps} />
        </section>
      )}
    </div>
  );
}

function InitialOutlineSection({
  outline,
}: {
  outline: NonNullable<NarrativeContext["initial_story_outline"]>;
}) {
  return (
    <div className="initial-outline-section">
      <div className="ip-row"><span className="ip-label">主题</span><span>{outline.theme ?? "—"}</span></div>
      {outline.background && <div className="ip-row"><span className="ip-label">背景</span><span>{outline.background}</span></div>}
      {outline.character_arc && <div className="ip-row"><span className="ip-label">角色弧光</span><span>{outline.character_arc}</span></div>}
      {outline.main_conflict && <div className="ip-row"><span className="ip-label">主要冲突</span><span>{outline.main_conflict}</span></div>}
      {outline.story_structure && (
        <div className="ip-substruct">
          <div className="ip-label">故事结构</div>
          {outline.story_structure.opening && <div>· 开端：{outline.story_structure.opening}</div>}
          {outline.story_structure.development?.length > 0 && (
            <ul>{outline.story_structure.development.map((d: string, i: number) => <li key={i}>· 发展：{d}</li>)}</ul>
          )}
          {outline.story_structure.ending && <div>· 结局：{outline.story_structure.ending}</div>}
        </div>
      )}
      {outline.key_plot_points?.length > 0 && (
        <div className="ip-substruct">
          <div className="ip-label">关键情节点</div>
          <ul>{outline.key_plot_points.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Core Settings (full view)
// ══════════════════════════════════════════════════════════════════════════════

function CoreSettingsView({ cs }: { cs: NonNullable<NarrativeContext["core_settings"]> }) {
  return (
    <div>
      <KV label="世界名" value={cs.world_name} />
      <KV label="背景" value={cs.world_setting} />
      <KV label="主题" value={cs.main_theme} />
      <KV label="主要冲突" value={cs.main_conflict} />
      <KV label="类型" value={cs.genre} />
      <KV label="叙事视角" value={cs.narrative_perspective} />
      {cs.protagonist && (
        <div className="sub-section">
          <div className="result-section-title">主角</div>
          <KV label="名字" value={cs.protagonist.name} />
          <KV label="身份" value={cs.protagonist.identity} />
          <KV label="性格" value={cs.protagonist.personality} />
          <KV label="核心冲突" value={cs.protagonist.core_conflict} />
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// E1-02 三幕扩写（三幕大纲 + 人物小传 + 关键道具，单步三输出合并视图）
// ══════════════════════════════════════════════════════════════════════════════

interface VnAct { act_id?: string; act_name?: string; content?: string }
interface VnOutlineActsData { title?: string; central_theme?: string; acts?: VnAct[] }
interface VnCharacterBio {
  name?: string; role?: string; identity?: string;
  external_motivation?: string; internal_motivation?: string;
  arc?: string; voice?: string; visual?: string;
}
interface VnKeyItemData {
  name?: string; category?: string; description?: string;
  narrative_function?: string; bound_character?: string;
  act_appearance?: string[]; symbolism?: string;
}

function VnOutlineActsView({ result, data }: { result: NarrativeContext | null; data: unknown }) {
  const ctx = result as Record<string, unknown> | null;
  // 优先从 result 读三个独立字段；断点恢复时退回 data（聚合对象或仅三幕）。
  const fallback = (data && typeof data === "object" ? (data as Record<string, unknown>) : {}) as Record<string, unknown>;
  const outline = (ctx?.vn_outline_acts ?? fallback.outline_acts ?? fallback) as VnOutlineActsData;
  const bios = (ctx?.vn_character_bios ?? fallback.character_bios) as { characters?: VnCharacterBio[] } | undefined;
  const keyItems = (ctx?.vn_key_items ?? fallback.key_items) as { items?: VnKeyItemData[] } | undefined;

  const characters = bios?.characters ?? [];
  const items = keyItems?.items ?? [];

  return (
    <div>
      {/* ── 三幕大纲 ── */}
      <div className="sub-section">
        <div className="result-section-title">📖 三幕大纲</div>
        {outline?.title && <KV label="标题" value={outline.title} />}
        {outline?.central_theme && <KV label="中心主题" value={outline.central_theme} />}
        {(outline?.acts ?? []).map((act, i) => (
          <ProseBlock
            key={i}
            title={`第${act.act_id ?? i + 1}幕 · ${act.act_name ?? ""}`}
            text={act.content ?? ""}
            color="green"
          />
        ))}
      </div>

      {/* ── 人物小传 ── */}
      {characters.length > 0 && (
        <div className="sub-section">
          <div className="result-section-title">👥 人物小传（{characters.length}）</div>
          {characters.map((c, i) => (
            <div key={i} className="prose-block">
              <div className="prose-block-title prose-title-gold">
                {c.name ?? `角色${i + 1}`}{c.role ? ` · ${c.role}` : ""}
              </div>
              {c.identity && <KV label="身份" value={c.identity} />}
              {c.external_motivation && <KV label="外驱" value={c.external_motivation} />}
              {c.internal_motivation && <KV label="内驱" value={c.internal_motivation} />}
              {c.arc && <KV label="弧光" value={c.arc} />}
              {c.voice && <KV label="语态" value={c.voice} />}
              {c.visual && <KV label="视觉" value={c.visual} />}
            </div>
          ))}
        </div>
      )}

      {/* ── 关键道具 ── */}
      {items.length > 0 && (
        <div className="sub-section">
          <div className="result-section-title">🗝 关键道具（{items.length}）</div>
          {items.map((it, i) => (
            <div key={i} className="prose-block">
              <div className="prose-block-title prose-title-blue">
                {it.name ?? `道具${i + 1}`}{it.category ? ` · ${it.category}` : ""}
              </div>
              {it.description && <KV label="描述" value={it.description} />}
              {it.narrative_function && <KV label="叙事作用" value={it.narrative_function} />}
              {it.bound_character && <KV label="关联人物" value={it.bound_character} />}
              {it.act_appearance?.length ? <KV label="出现幕" value={it.act_appearance.join("、")} /> : null}
              {it.symbolism && <KV label="象征" value={it.symbolism} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Preference Analysis (42 dimensions)
// ══════════════════════════════════════════════════════════════════════════════

function PreferenceAnalysisView({ data }: { data: Record<string, unknown> }) {
  const gcp = data["全局控制参数"] as Record<string, unknown> | undefined;
  const sections: Array<{ label: string; key: string }> = [
    { label: "世界观维度", key: "世界观维度" },
    { label: "框架层维度 L0", key: "框架层维度_L0" },
    { label: "大纲层维度 L1", key: "大纲层维度_L1" },
    { label: "细纲层维度 L2", key: "细纲层维度_L2" },
  ];

  return (
    <div>
      {gcp && (
        <div className="sub-section">
          <div className="result-section-title">全局控制参数</div>
          <KV label="复杂度" value={String(gcp.complexity ?? "-")} />
          <KV label="偏差值" value={gcp.deviation !== undefined ? Number(gcp.deviation).toFixed(2) : String(gcp.deviation_direction ?? "-")} />
        </div>
      )}
      {sections.map((sec) => {
        const slots = data[sec.key] as Record<string, Record<string, unknown>> | undefined;
        if (!slots || !Object.keys(slots).length) return null;
        return (
          <div key={sec.key} className="sub-section">
            <div className="result-section-title">{sec.label}</div>
            {Object.entries(slots).map(([k, v]) => (
              <div key={k} className="wv-slot-row">
                <span className="wv-slot-key">{k} {String(v.slot_name ?? "")}</span>
                <span className="wv-slot-val">
                  {String(v.user_preference ?? v.content ?? v.description ?? "")}
                  {v.entropy != null && (
                    <span style={{ marginLeft: 8, fontSize: 10, color: "rgba(77,255,160,0.4)" }}>
                      H={String(Number(v.entropy).toFixed(2))}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Worldview (layered slots)
// ══════════════════════════════════════════════════════════════════════════════

function WorldviewView({ wv }: { wv: NarrativeContext["worldview_structure"] }) {
  if (!wv) return null;
  const layers: Array<{ key: string; label: string }> = [
    { key: "基础架构层", label: "基础架构层" },
    { key: "交互叙事层", label: "交互叙事层" },
  ];

  return (
    <div>
      <KV label="世界名" value={wv.world_name} />
      {wv.worldview_title && <KV label="标题" value={wv.worldview_title} />}
      {layers.map(({ key, label }) => {
        const slots = (wv as Record<string, unknown>)[key] as Record<string, Record<string, unknown>> | undefined;
        if (!slots || !Object.keys(slots).length) return null;
        return (
          <div key={key} className="sub-section">
            <div className="result-section-title">{label}</div>
            {Object.entries(slots).map(([k, v]) => {
              const parts = k.split("_");
              const slotId = parts.slice(0, 2).join("_");
              const slotName = parts.slice(2).join("");
              const desc = String(
                typeof v === "object" && v
                  ? ((v as Record<string, unknown>).description ?? (v as Record<string, unknown>).content ?? JSON.stringify(v, null, 2))
                  : v,
              );
              return (
                <div key={k} className="wv-slot-row">
                  <span className="wv-slot-key">{slotId} {slotName}</span>
                  <span className="wv-slot-val">{desc}</span>
                </div>
              );
            })}
          </div>
        );
      })}
      {Array.isArray((wv as Record<string, unknown>)["核心规则"]) && (
        <div className="sub-section">
          <div className="result-section-title">核心规则</div>
          {((wv as Record<string, unknown>)["核心规则"] as Array<{ rule_name: string; rule_content: string }>).map((r, i) => (
            <div key={i} className="wv-slot-row">
              <span className="wv-slot-key">{r.rule_name}</span>
              <span className="wv-slot-val">{r.rule_content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Full Nodes Table (framework / outline / detailed / plot)
// ══════════════════════════════════════════════════════════════════════════════

function FullNodesTable({
  nodes,
  nodeType,
  stepId,
}: {
  nodes: StoryNode[];
  nodeType: "framework" | "outline" | "detailed" | "plot";
  stepId?: string;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const edit = useNodeEdit(stepId ?? "");

  if (!nodes || nodes.length === 0) return <p className="section-text">无节点</p>;

  return (
    <div className="nodes-table node-card-list">
      {nodes.map((raw) => {
        const n = raw as unknown as Record<string, unknown>;
        const nodeId = String(n.node_id ?? "");
        const name = String(n.name ?? n.title ?? "");
        const expanded = expandedId === nodeId;
        const isNodeEditing = edit.editingNodeId === nodeId;
        const isBranch = !!n.is_branch;
        const prevNode = (n.prev_node as string[]) ?? [];
        const nextNode = (n.next_node as string[]) ?? [];
        const se = n.story_elements as Record<string, unknown> | undefined;
        const bc = n.boundary_constraints as Record<string, string> | undefined;
        const jrpg = n.jrpg_elements as Record<string, unknown> | undefined;
        const charArcs = n.character_arcs as Array<Record<string, string>> | undefined;
        const operators = n.operators_used as Array<Record<string, string>> | undefined;
        const content = String(n.main_content ?? n.content ?? "");
        const funcText = nodeType === "plot"
          ? String(jrpg?.chapter_type ?? "")
          : String(n.narrative_function ?? "");
        const stage = String(n.narrative_stage ?? n.stage_type ?? "");
        const tension = se?.tension_level;

        const funcParts: string[] = [];
        if (funcText) funcParts.push(funcText);
        if (stage) funcParts.push(`阶段: ${stage}`);
        if (tension != null) funcParts.push(`张力: ${tension}/10`);
        if (se?.conflict_type) funcParts.push(`冲突: ${String(se.conflict_type)}`);
        if (se?.stakes) funcParts.push(`赌注: ${String(se.stakes)}`);

        return (
          <div
            key={nodeId}
            data-node-id={nodeId}
            className={`node-card clickable ${expanded ? "expanded" : ""}${isNodeEditing ? " editing" : ""}`}
          >
            <div className="node-card-header" onClick={() => setExpandedId(expanded ? null : nodeId)}>
              <span className="tsc-expand-arrow">{expanded ? "▾" : "▸"}</span>
              <span className="node-id">{nodeId}{isBranch ? " ⑂" : ""}</span>
              <span className="node-name">{name}</span>
              {tension != null && <span className="node-badge tension">张力 {String(tension)}/10</span>}
              {isBranch && <span className="node-badge branch">分支</span>}
              {stage && <span className="node-badge">{stage}</span>}
              <span className="tsc-badge status-completed">completed</span>
            </div>
            {funcParts.length > 0 && expanded && (
              <div className="nti-func-bar">{funcParts.join(" · ")}</div>
            )}
            {expanded && (
              <div className="node-expanded-content">
                {isNodeEditing ? (
                  <NodeEditTextarea value={edit.editContent} onChange={edit.setEditContent} />
                ) : (
                  <>
                    {content && <p className="section-text">{content}</p>}
                    {se && <StoryElementsBlock se={se} />}
                    {bc && (
                      <div className="nti-extra-block blue">
                        {bc.cause && <div><LabelSpan color="blue">起因约束</LabelSpan> {bc.cause}</div>}
                        {bc.result && <div><LabelSpan color="blue">结果约束</LabelSpan> {bc.result}</div>}
                      </div>
                    )}
                    {jrpg && <JrpgElementsBlock jrpg={jrpg} />}
                    {charArcs && charArcs.length > 0 && (
                      <div className="nti-extra-block">
                        <LabelSpan>角色弧</LabelSpan>
                        {charArcs.map((a, i) => (
                          <div key={i}>{a.character_name ?? a.character ?? ""}: {a.emotional_state ?? ""} → {a.growth ?? a.arc_description ?? ""}</div>
                        ))}
                      </div>
                    )}
                    {operators && operators.length > 0 && (
                      <div className="nti-extra-block dim">
                        <LabelSpan>算子</LabelSpan>
                        {operators.map((o, i) => (
                          <div key={i}>{o.name ?? ""}{o.slot_id ? ` (${o.slot_id})` : ""}{o.effect ? ` — ${o.effect}` : ""}</div>
                        ))}
                      </div>
                    )}
                    {(prevNode.length > 0 || nextNode.length > 0) && (
                      <div className="nti-conn">
                        {prevNode.length > 0 && <span>← {prevNode.join(", ")}</span>}
                        {prevNode.length > 0 && nextNode.length > 0 && <span>{"  "}</span>}
                        {nextNode.length > 0 && <span>→ {nextNode.join(", ")}</span>}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {edit.showNodeInput === nodeId && expanded && (
              <NodeUserInputBox value={edit.nodeUserInput} onChange={edit.setNodeUserInput} />
            )}

            {expanded && edit.canEditNodes && (
              <NodeEditActions
                nodeId={nodeId}
                isEditing={isNodeEditing}
                showInput={edit.showNodeInput === nodeId}
                canSave={isNodeEditing || !!edit.nodeUserInput.trim()}
                onEdit={() => edit.handleNodeEdit(nodeId, n)}
                onInput={() => edit.toggleNodeInput(nodeId)}
                onSave={() => edit.handleNodeSave(nodeId)}
                onCancel={() => edit.handleNodeCancel(nodeId)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function BranchSummary({ nodes }: { nodes: StoryNode[] }) {
  const branchNodes = nodes.filter((n) => {
    const r = n as unknown as Record<string, unknown>;
    return !!r.is_branch;
  });
  if (branchNodes.length === 0) return null;

  const byParent = new Map<string, string[]>();
  for (const n of branchNodes) {
    const r = n as unknown as Record<string, unknown>;
    const pid = String(r.parent_id ?? "root");
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid)!.push(String(r.node_id ?? r.name ?? ""));
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div className="result-section-title">分支结构 ({branchNodes.length} 分支节点)</div>
      <div className="nti-extra-block">
        {Array.from(byParent.entries()).map(([parentId, children]) => (
          <div key={parentId}>
            <span className="node-badge branch">父节点 {parentId}</span>
            {" → "}
            {children.map((c, i) => (
              <span key={c}>
                {i > 0 && " / "}
                <span className="node-id">{c}</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function StoryElementsBlock({ se }: { se: Record<string, unknown> }) {
  const plot = se.plot as Record<string, string> | undefined;
  const parts: JSX.Element[] = [];

  if (plot) {
    if (plot.cause) parts.push(<div key="cause"><LabelSpan>起因</LabelSpan> {plot.cause}</div>);
    if (plot.process) parts.push(<div key="process"><LabelSpan>经过</LabelSpan> {plot.process}</div>);
    if (plot.result) parts.push(<div key="result"><LabelSpan>结果</LabelSpan> {plot.result}</div>);
  }
  if (se.atmosphere) parts.push(<div key="atm"><LabelSpan color="gold">氛围</LabelSpan> {String(se.atmosphere)}</div>);
  if (se.dialogue_hint) parts.push(<div key="dlg"><LabelSpan color="gold">对话提示</LabelSpan> {String(se.dialogue_hint)}</div>);
  if (se.monologue_hint) parts.push(<div key="mono"><LabelSpan color="gold">独白提示</LabelSpan> {String(se.monologue_hint)}</div>);
  if (se.narration_hint) parts.push(<div key="nar"><LabelSpan color="gold">旁白提示</LabelSpan> {String(se.narration_hint)}</div>);
  if (se.turning_point) parts.push(<div key="turn"><LabelSpan color="gold">转折点</LabelSpan> {String(se.turning_point)}</div>);

  if (parts.length === 0) return null;
  return <div className="nti-extra-block">{parts}</div>;
}

function JrpgElementsBlock({ jrpg }: { jrpg: Record<string, unknown> }) {
  const parts: JSX.Element[] = [];

  if (jrpg.scene_location)
    parts.push(<div key="loc"><LabelSpan color="gold">场景</LabelSpan> {String(jrpg.scene_location)}</div>);
  const locs = jrpg.scene_locations as string[] | undefined;
  if (locs?.length)
    parts.push(<div key="locs"><LabelSpan color="gold">场景列表</LabelSpan> {locs.join("、")}</div>);
  const chars = jrpg.scene_characters as string[] | undefined;
  if (chars?.length)
    parts.push(<div key="chars"><LabelSpan color="gold">出场角色</LabelSpan> {chars.join("、")}</div>);
  const keyItems = jrpg.key_items as string[] | undefined;
  if (keyItems?.length)
    parts.push(<div key="items"><LabelSpan color="gold">关键道具</LabelSpan> {keyItems.join("、")}</div>);
  const narHints = jrpg.narration_hints as string[] | undefined;
  if (narHints?.length)
    parts.push(<div key="narh"><LabelSpan color="gold">叙事提示</LabelSpan> {narHints.join("；")}</div>);
  if (jrpg.bgm_hint)
    parts.push(<div key="bgm"><LabelSpan color="gold">BGM</LabelSpan> {String(jrpg.bgm_hint)}</div>);
  if (jrpg.camera_hint)
    parts.push(<div key="cam"><LabelSpan color="gold">镜头</LabelSpan> {String(jrpg.camera_hint)}</div>);
  const trigger = jrpg.trigger as Record<string, string> | undefined;
  if (trigger?.condition || trigger?.event)
    parts.push(<div key="trig"><LabelSpan color="blue">触发条件</LabelSpan> {trigger?.condition ?? ""} / {trigger?.event ?? ""}</div>);
  const completion = jrpg.completion as Record<string, string> | undefined;
  if (completion?.condition || completion?.event)
    parts.push(<div key="comp"><LabelSpan color="blue">完成条件</LabelSpan> {completion?.condition ?? ""} / {completion?.event ?? ""}</div>);
  const dialogues = jrpg.dialogue_segments as Array<Record<string, string>> | undefined;
  if (dialogues?.length) {
    parts.push(
      <div key="dlgs" className="nti-dialogue-block">
        <LabelSpan color="gold">对话</LabelSpan>
        {dialogues.map((d, i) => (
          <div key={i} className="nti-dialogue-line">
            <span className="nti-dlg-speaker">{d.speaker ?? ""}</span>
            {d.emotion && <span className="nti-dlg-emotion">[{d.emotion}]</span>}
            : {d.text ?? ""}
          </div>
        ))}
      </div>,
    );
  }

  if (parts.length === 0) return null;
  return <div className="nti-extra-block gold-border">{parts}</div>;
}

// ══════════════════════════════════════════════════════════════════════════════
// Full Characters View (rich card like old version)
// ══════════════════════════════════════════════════════════════════════════════

function FullCharactersView({ characters }: { characters: NarrativeContext["detailed_character_sheets"] }) {
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const edit = useNodeEdit("character_enrichment");
  if (!characters) return null;

  return (
    <div className="char-grid-text">
      {characters.map((c) => {
        const nodeId = c.name;
        const expanded = expandedName === nodeId;
        const isNodeEditing = edit.editingNodeId === nodeId;
        const r = c as Record<string, unknown>;
        const isMain = c.label === "主角";
        const isPlayer = r._is_player as boolean | undefined;
        const ocean = r.ocean_personality_model as Record<string, number> | undefined;
        const desc = r.description as Record<string, unknown> | undefined;
        const appearance = String(desc?.appearance_description ?? "");
        const locDesc = typeof desc?.location_description === "object"
          ? Object.values(desc.location_description as Record<string, string>).filter(Boolean).join("、")
          : String(desc?.location_description ?? "");
        const arcSpec = typeof c.character_arc_spectrum === "object"
          ? `${(c.character_arc_spectrum as Record<string, string>).start_state ?? ""} → ${(c.character_arc_spectrum as Record<string, string>).end_state ?? ""}`
          : String(c.character_arc_spectrum ?? "");
        const bgInfo = String(r.background_information ?? "");
        const archetype = c.archetype_analysis as Record<string, string> | undefined;
        const psych = c.psychological_drivers as Record<string, string> | undefined;
        const theme = r.character_theme as Record<string, string> | undefined;
        const voice = r.voice_and_mannerisms as Record<string, unknown> | undefined;
        const sigPhrases = voice?.signature_phrases as string[] | undefined;
        const gm = c.game_mechanics as Record<string, unknown> | undefined;
        const gmBase = gm?.base_stats as Record<string, unknown> | undefined;
        const rels = r.relationships as Record<string, unknown[]> | undefined;
        const relationships: string[] = [];
        if (rels?.family_relationships?.length)
          relationships.push(`家庭: ${(rels.family_relationships as Array<Record<string, string>>).map((rel) => rel.name ?? rel.character ?? "").join("、")}`);
        if (rels?.social_relationships?.length)
          relationships.push(`社交: ${(rels.social_relationships as Array<Record<string, string>>).map((rel) => rel.name ?? rel.character ?? "").join("、")}`);
        const benefitRels = r.benefit_based_relationships as Array<Record<string, string>> | undefined;
        if (benefitRels?.length)
          relationships.push(`利益: ${benefitRels.map((rel) => `${rel.name ?? ""}(${rel.relationship ?? ""})`).join("、")}`);
        const abilities = Array.isArray(r.special_abilities) ? (r.special_abilities as string[]).join("、") : String(r.special_abilities ?? "");

        return (
          <div
            key={nodeId}
            className={`char-card-text ${isMain ? "main" : "npc"} ${expanded ? "expanded" : ""}${isNodeEditing ? " editing" : ""}`}
          >
            <div className="char-card-header" onClick={() => setExpandedName(expanded ? null : nodeId)}>
              <span className="char-toggle">{expanded ? "▾" : "▸"}</span>
              <span className="char-label-badge">{c.label}{isPlayer ? " 🎮" : ""}</span>
              <strong className="char-card-name">{c.name}</strong>
              {r.occupation ? <span className="char-card-occ">{String(r.occupation)}</span> : null}
            </div>
            {!expanded && (
              <div className="char-card-meta">
                {[r.race, r.gender, r.age ? `${r.age}岁` : ""].filter(Boolean).map(String).join(" · ")}
              </div>
            )}

            {expanded && (
              <div className="char-card-detail">
                {isNodeEditing ? (
                  <NodeEditTextarea value={edit.editContent} onChange={edit.setEditContent} rows={15} />
                ) : (
                  <>
                    <div className="char-card-meta">
                      {[r.race, r.gender, r.age ? `${r.age}岁` : ""].filter(Boolean).map(String).join(" · ")}
                    </div>
                    {c.role_in_story && <div className="char-card-role">{c.role_in_story}</div>}
                    {(r.birthplace as string) && <CharRow label="出生" value={String(r.birthplace)} />}
                    {appearance && <CharRow label="外貌" value={appearance} />}
                    {locDesc && <CharRow label="出没" value={locDesc} />}
                    {(r.activity_locations as string[])?.length > 0 && <CharRow label="活动地" value={(r.activity_locations as string[]).join("、")} />}
                    {(r.story_importance as string) && <CharRow label="重要度" value={String(r.story_importance)} />}
                    {psych?.core_motivation && <CharRow label="动机" value={psych.core_motivation} />}
                    {psych?.core_fear && <CharRow label="恐惧" value={psych.core_fear} />}
                    {(r.decisive_past_event as string) && <CharRow label="决定性过去" value={String(r.decisive_past_event)} />}
                    {arcSpec && <CharRow label="弧光" value={arcSpec} />}
                    {archetype?.core_archetype && <CharRow label="原型" value={`${archetype.core_archetype}${archetype.surface_archetype ? " / " + archetype.surface_archetype : ""}`} />}
                    {(r.archetype_conflict as string) && <CharRow label="原型冲突" value={String(r.archetype_conflict)} />}
                    {(r.performance_archetype as string) && <CharRow label="表演原型" value={String(r.performance_archetype)} />}
                    {abilities && <CharRow label="能力" value={abilities} />}
                    {relationships.length > 0 && <CharRow label="关系" value={relationships.join("；")} />}
                    {(r.behavior_settings as string) && <CharRow label="行为" value={String(r.behavior_settings)} />}
                    {sigPhrases?.length && <CharRow label="口头禅" value={sigPhrases.join("；")} />}
                    {(r.voice_strength as string) && <CharRow label="声线" value={String(r.voice_strength)} />}
                    {(r.verbal_tics as string) && <CharRow label="语癖" value={String(r.verbal_tics)} />}
                    {(r.speech_patterns as string) && <CharRow label="话术" value={String(r.speech_patterns)} />}
                    {(r.dialogue_style as string) && <CharRow label="话风" value={String(r.dialogue_style)} />}
                    {(r.symbolic_meaning as string) && <CharRow label="象征" value={String(r.symbolic_meaning)} />}
                    {theme?.central_theme && <CharRow label="主题" value={theme.central_theme} />}
                    {bgInfo && <CharRow label="背景" value={bgInfo} />}
                    {(() => {
                      const pl = r.personal_life as Record<string, unknown> | undefined;
                      if (!pl) return null;
                      const likes = Array.isArray(pl.likes) ? (pl.likes as string[]).join("、") : "";
                      const dislikes = Array.isArray(pl.dislikes) ? (pl.dislikes as string[]).join("、") : "";
                      const habits = Array.isArray(pl.habits) ? (pl.habits as string[]).join("、") : "";
                      const bonds = Array.isArray(pl.independent_bonds)
                        ? (pl.independent_bonds as Array<Record<string, string>>).map(b => `${b.name}(${b.relationship}: ${b.detail})`).join("；")
                        : "";
                      return (
                        <>
                          {likes && <CharRow label="喜好" value={likes} />}
                          {dislikes && <CharRow label="厌恶" value={dislikes} />}
                          {habits && <CharRow label="习惯" value={habits} />}
                          {(pl.speech_pattern as string) && <CharRow label="说话方式" value={String(pl.speech_pattern)} />}
                          {(pl.personal_item as string) && <CharRow label="私人物件" value={String(pl.personal_item)} />}
                          {(pl.private_wish as string) && <CharRow label="内心期待" value={String(pl.private_wish)} />}
                          {(pl.vulnerability as string) && <CharRow label="矛盾面" value={String(pl.vulnerability)} />}
                          {bonds && <CharRow label="私人牵绊" value={bonds} />}
                        </>
                      );
                    })()}
                    {gmBase && (
                      <CharRow label="属性" value={`HP:${gmBase.hp ?? "-"} ATK:${gmBase.attack ?? "-"} DEF:${gmBase.defense ?? "-"} MAG:${gmBase.magic ?? "-"} Lv.${gm?.level ?? 1}${gm?.exp != null ? ` EXP:${gm.exp}` : ""}${gm?.money != null ? ` G:${gm.money}` : ""}`} />
                    )}
                    {ocean && (
                      <div className="char-ocean">
                        {(["openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism"] as const).map((k) => (
                          <span key={k} className="ocean-badge">{k.slice(0, 3).toUpperCase()} {ocean[k] ?? "-"}</span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {edit.showNodeInput === nodeId && expanded && (
              <NodeUserInputBox value={edit.nodeUserInput} onChange={edit.setNodeUserInput} />
            )}

            {expanded && edit.canEditNodes && (
              <NodeEditActions
                nodeId={nodeId}
                isEditing={isNodeEditing}
                showInput={edit.showNodeInput === nodeId}
                canSave={isNodeEditing || !!edit.nodeUserInput.trim()}
                onEdit={() => edit.handleNodeEdit(nodeId, c)}
                onInput={() => edit.toggleNodeInput(nodeId)}
                onSave={() => edit.handleNodeSave(nodeId)}
                onCancel={() => edit.handleNodeCancel(nodeId)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CharRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="char-detail-row">
      <span className="cdr-label">{label}</span>
      <span className="cdr-value">{value}</span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Full Script View (chapter → scene → line)
// ══════════════════════════════════════════════════════════════════════════════

function FullScriptView({ script }: { script: NarrativeContext["jrpg_script"] }) {
  const [expandedCh, setExpandedCh] = useState<string | null>(null);
  const edit = useNodeEdit("script_generation");
  if (!script) return null;

  const TYPE_LABELS: Record<string, string> = {
    opening: "开端", rising: "发展", climax: "高潮", falling: "下降", resolution: "结局",
  };

  return (
    <div>
      <KV label="标题" value={script.title} />
      <p className="section-text">{script.chapters.length} 章节</p>
      {script.chapters.map((ch) => {
        const nodeId = ch.chapter_id;
        const expanded = expandedCh === nodeId;
        const isNodeEditing = edit.editingNodeId === nodeId;
        const funcParts: string[] = [];
        if (ch.chapter_type) funcParts.push(TYPE_LABELS[ch.chapter_type] ?? ch.chapter_type);
        funcParts.push(`张力 ${ch.conflict.tension_level}/10`);

        return (
          <div
            key={nodeId}
            data-node-id={ch.node_id}
            className={`sub-section script-chapter clickable ${expanded ? "expanded" : ""}${isNodeEditing ? " editing" : ""}`}
          >
            <div className="node-row-header" onClick={() => setExpandedCh(expanded ? null : nodeId)}>
              <span className="tsc-expand-arrow">{expanded ? "▾" : "▸"}</span>
              <span className="node-id">{ch.node_id}</span>
              <span className="node-badge">{funcParts[0]}</span>
              <strong>{ch.title}</strong>
              <span className="node-func">{funcParts.slice(1).join(" · ")}</span>
            </div>
            {expanded && (
              <div className="script-detail">
                {isNodeEditing ? (
                  <NodeEditTextarea value={edit.editContent} onChange={edit.setEditContent} rows={15} />
                ) : (
                  <>
                    <div className="script-conflict">
                      <KV label="冲突类型" value={ch.conflict.type} />
                      <KV label="赌注" value={ch.conflict.stakes} />
                      <KV label="转折点" value={ch.conflict.turning_point} />
                      <KV label="来源情节" value={ch.plot_node_id} />
                    </div>

                    {ch.character_arcs.length > 0 && (
                      <div className="script-arcs">
                        <div className="result-section-title">角色弧光</div>
                        {ch.character_arcs.map((arc, i) => (
                          <div key={i} className="wv-slot-row">
                            <span className="wv-slot-key">{arc.character}</span>
                            <span className="wv-slot-val">{arc.arc_phase} · {arc.emotional_shift} → {arc.growth}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {ch.scenes.map((sc) => (
                      <div key={sc.scene_id} className="script-scene">
                        <div className="scene-header">
                          <span className="node-badge">场景</span>
                          <span>{sc.location}</span>
                          <span className="node-func">{sc.atmosphere}</span>
                          {sc.bgm && <span className="node-func">🎵 {sc.bgm}</span>}
                          {sc.camera_direction && <span className="node-func">📷 {sc.camera_direction}</span>}
                        </div>
                        <div className="script-content-lines">
                          {sc.content.map((line, li) => (
                            <div key={li} className={`script-line type-${line.type}`}>
                              {line.type === "dialogue" ? (
                                <>
                                  <span className="line-speaker">{line.speaker ?? ""}</span>
                                  <span className="line-text">{line.text}</span>
                                  {(line.emotion || line.action) && (
                                    <span className="line-emotion">
                                      [{line.emotion ?? ""}{line.action ? `, ${line.action}` : ""}]
                                    </span>
                                  )}
                                  {line.subtext && (
                                    <div className="line-subtext">({line.subtext})</div>
                                  )}
                                </>
                              ) : line.type === "stage_direction" ? (
                                <span className="line-text">（{line.text}）</span>
                              ) : line.type === "inner_monologue" ? (
                                <em className="line-text">{line.text}</em>
                              ) : line.type === "branch_point" ? (
                                <span className="line-text">⑂ {line.text}</span>
                              ) : (
                                <>
                                  <span className="line-type">{line.type}</span>
                                  <span className="line-text">{line.text}</span>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {edit.showNodeInput === nodeId && expanded && (
              <NodeUserInputBox value={edit.nodeUserInput} onChange={edit.setNodeUserInput} />
            )}

            {expanded && edit.canEditNodes && (
              <NodeEditActions
                nodeId={nodeId}
                isEditing={isNodeEditing}
                showInput={edit.showNodeInput === nodeId}
                canSave={isNodeEditing || !!edit.nodeUserInput.trim()}
                onEdit={() => edit.handleNodeEdit(nodeId, ch)}
                onInput={() => edit.toggleNodeInput(nodeId)}
                onSave={() => edit.handleNodeSave(nodeId)}
                onCancel={() => edit.handleNodeCancel(nodeId)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Full Scene Tree (hierarchical with icons)
// ══════════════════════════════════════════════════════════════════════════════

const LEVEL_ICONS = ["🌐", "⛰️", "🏘️", "🏛️", "🚪", "🔮"];
const LEVEL_LABELS = ["L0 世界", "L1 区域", "L2 地域", "L3 地标", "L4 房间", "L5 物品"];

function sceneLevel(s: SceneNode): number {
  return s.scene_level ?? s.level ?? 0;
}

function sceneDescText(s: SceneNode): string {
  if (!s.description) return "";
  if (typeof s.description === "string") return s.description;
  const d = s.description as { location_description?: string; art_style_description?: string; semantics_description?: string };
  return [d.location_description, d.art_style_description, d.semantics_description].filter(Boolean).join(" | ");
}

function SceneTreeMerged({ scenes }: { scenes: SceneNode[] }) {
  const byParent = new Map<string, SceneNode[]>();
  for (const s of scenes) {
    const key = s.parent || "__root__";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(s);
  }

  function renderLevel(parentName: string, depth: number): React.ReactNode {
    const children = byParent.get(parentName) ?? [];
    if (!children.length) return null;
    return (
      <div className="scene-tree-level" style={{ paddingLeft: depth * 16 }}>
        {children.map((s) => {
          const lvl = sceneLevel(s);
          const desc = sceneDescText(s);
          return (
            <div key={s.uid || s.name} data-node-id={s.uid} className="scene-tree-node">
              <div className="scene-tree-row">
                <span className="scene-icon">{LEVEL_ICONS[lvl] ?? "·"}</span>
                <span className={`node-badge scene-level-${lvl}`}>{LEVEL_LABELS[lvl] ?? `L${lvl}`}</span>
                <span className={`scene-name scene-name-l${lvl}`}>{s.name}</span>
                {s.story_units?.length && (
                  <span className="scene-units">🔗 {s.story_units.join(", ")}</span>
                )}
              </div>
              {desc && <p className="section-text scene-desc">{desc}</p>}
              {renderLevel(s.name, depth + 1)}
            </div>
          );
        })}
      </div>
    );
  }

  const roots = byParent.get("__root__") ?? byParent.get("") ?? [];
  if (roots.length === 0) return <GenericObjectView data={scenes} />;

  return (
    <>
      {roots.map((r) => {
        const lvl = sceneLevel(r);
        const desc = sceneDescText(r);
        return (
          <div key={r.uid || r.name} className="scene-tree-node root">
            <div className="scene-tree-row">
              <span className="scene-icon">{LEVEL_ICONS[lvl] ?? "·"}</span>
              <span className={`node-badge scene-level-${lvl}`}>{LEVEL_LABELS[lvl] ?? `L${lvl}`}</span>
              <span className={`scene-name scene-name-l${lvl}`}>{r.name}</span>
            </div>
            {desc && <p className="section-text scene-desc">{desc}</p>}
            {renderLevel(r.name, 1)}
          </div>
        );
      })}
    </>
  );
}

type SceneTab = "all" | "skeleton" | "L0" | "L1" | "L2" | "L345";

const SCENE_TAB_LABELS: Record<SceneTab, string> = {
  all: "全量场景",
  skeleton: "骨架场景",
  L0: "L0 框架场景",
  L1: "L1 大纲场景",
  L2: "L2 细纲场景",
  L345: "L3+L4+L5 情节场景",
};

function SceneList({ scenes }: { scenes: SceneNode[] }) {
  if (!scenes.length) return <p className="section-text">暂无场景数据</p>;
  return (
    <div className="scene-tree-level">
      {scenes.map((s, si) => {
        const lvl = sceneLevel(s);
        const desc = sceneDescText(s);
        return (
          <div key={s.uid || s.name || si} data-node-id={s.uid} className="scene-tree-node">
            <div className="scene-tree-row">
              <span className="scene-icon">{LEVEL_ICONS[lvl] ?? "·"}</span>
              <span className={`node-badge scene-level-${lvl}`}>{LEVEL_LABELS[lvl] ?? `L${lvl}`}</span>
              <span className={`scene-name scene-name-l${lvl}`}>{s.name}</span>
              {s.story_units?.length && (
                <span className="scene-units">🔗 {s.story_units.join(", ")}</span>
              )}
            </div>
            {desc && <p className="section-text scene-desc">{desc}</p>}
          </div>
        );
      })}
    </div>
  );
}

function ScenePerNodeGroups({ p2, edit, expandedGroup, setExpandedGroup }: {
  p2: Record<string, SceneNode[]>;
  edit: ReturnType<typeof useNodeEdit>;
  expandedGroup: string | null;
  setExpandedGroup: (id: string | null) => void;
}) {
  const entries = Object.entries(p2);
  if (entries.length === 0) return <p className="section-text">暂无节点分组数据</p>;
  return (
    <div className="node-card-list">
      {entries.map(([nodeId, groupScenes]) => {
        const expanded = expandedGroup === nodeId;
        const isNodeEditing = edit.editingNodeId === nodeId;
        return (
          <div
            key={nodeId}
            data-node-id={nodeId}
            className={`node-card clickable ${expanded ? "expanded" : ""}${isNodeEditing ? " editing" : ""}`}
          >
            <div className="node-card-header" onClick={() => setExpandedGroup(expanded ? null : nodeId)}>
              <span className="tsc-expand-arrow">{expanded ? "▾" : "▸"}</span>
              <span className="node-id">{nodeId}</span>
              <span className="node-name">场景组 ({Array.isArray(groupScenes) ? groupScenes.length : 0} 场景)</span>
            </div>
            {expanded && (
              <div className="node-expanded-content">
                {isNodeEditing ? (
                  <NodeEditTextarea value={edit.editContent} onChange={edit.setEditContent} rows={12} />
                ) : (
                  Array.isArray(groupScenes) ? (
                    groupScenes.map((s, si) => {
                      const lvl = sceneLevel(s);
                      const desc = sceneDescText(s);
                      return (
                        <div key={s.uid || s.name || si} className="scene-tree-node" style={{ marginLeft: 8 }}>
                          <div className="scene-tree-row">
                            <span className="scene-icon">{LEVEL_ICONS[lvl] ?? "·"}</span>
                            <span className={`node-badge scene-level-${lvl}`}>{LEVEL_LABELS[lvl] ?? `L${lvl}`}</span>
                            <span className={`scene-name scene-name-l${lvl}`}>{s.name}</span>
                            {s.story_units?.length && (
                              <span className="scene-units">🔗 {s.story_units.join(", ")}</span>
                            )}
                          </div>
                          {desc && <p className="section-text scene-desc">{desc}</p>}
                        </div>
                      );
                    })
                  ) : (
                    <GenericObjectView data={groupScenes} />
                  )
                )}
              </div>
            )}

            {edit.showNodeInput === nodeId && expanded && (
              <NodeUserInputBox value={edit.nodeUserInput} onChange={edit.setNodeUserInput} />
            )}

            {expanded && edit.canEditNodes && (
              <NodeEditActions
                nodeId={nodeId}
                isEditing={isNodeEditing}
                showInput={edit.showNodeInput === nodeId}
                canSave={isNodeEditing || !!edit.nodeUserInput.trim()}
                onEdit={() => edit.handleNodeEdit(nodeId, groupScenes)}
                onInput={() => edit.toggleNodeInput(nodeId)}
                onSave={() => edit.handleNodeSave(nodeId)}
                onCancel={() => edit.handleNodeCancel(nodeId)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function FullSceneTreeView({ sceneMap }: { sceneMap: NarrativeContext["scene_map"] }) {
  const [activeTab, setActiveTab] = useState<SceneTab>("all");
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const edit = useNodeEdit("scene_generation");
  if (!sceneMap) return null;

  const sm = sceneMap as unknown as Record<string, unknown>;
  const scenes = sceneMap.scenes ?? [];
  const skeleton = sm._phase1_skeleton as SceneNode[] | undefined;
  const byLayer = sm._phase1_by_layer as { l0?: SceneNode[]; l1?: SceneNode[]; l2?: SceneNode[] } | undefined;
  const p2 = sm._phase2_per_node as Record<string, SceneNode[]> | undefined;

  const l0Scenes = byLayer?.l0 as SceneNode[] | undefined;
  const l1Scenes = byLayer?.l1 as SceneNode[] | undefined;
  const l2Scenes = byLayer?.l2 as SceneNode[] | undefined;

  const p2Flat: SceneNode[] = useMemo(() => {
    if (!p2) return [];
    const all: SceneNode[] = [];
    for (const arr of Object.values(p2)) {
      if (Array.isArray(arr)) all.push(...arr);
    }
    return all;
  }, [p2]);

  const availableTabs: SceneTab[] = ["all"];
  if (l0Scenes?.length) availableTabs.push("L0");
  if (l1Scenes?.length) availableTabs.push("L1");
  if (l2Scenes?.length) availableTabs.push("L2");
  if (skeleton?.length) availableTabs.push("skeleton");
  if (p2Flat.length > 0) availableTabs.push("L345");

  const tabData: Record<SceneTab, SceneNode[]> = {
    all: scenes,
    skeleton: skeleton ?? [],
    L0: l0Scenes ?? [],
    L1: l1Scenes ?? [],
    L2: l2Scenes ?? [],
    L345: p2Flat,
  };

  const activeScenes = tabData[activeTab];

  return (
    <div className="scene-tree">
      <KV label="世界" value={sceneMap.world_name} />

      <div className="scene-tab-bar">
        {availableTabs.map((tab) => (
          <button
            key={tab}
            className={`scene-tab${activeTab === tab ? " active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {SCENE_TAB_LABELS[tab]} ({tabData[tab].length})
          </button>
        ))}
      </div>

      <div className="scene-stats">
        <span className="scene-stat-badge">当前 · {activeScenes.length} 节点</span>
        {(() => {
          const lc = new Map<number, number>();
          for (const s of activeScenes) lc.set(sceneLevel(s), (lc.get(sceneLevel(s)) ?? 0) + 1);
          return Array.from(lc.entries()).sort(([a], [b]) => a - b).map(([level, count]) => (
            <span key={level} className={`scene-stat-badge level-${level}`}>
              {LEVEL_ICONS[level] ?? ""} {LEVEL_LABELS[level]?.split(" ")[1] ?? `L${level}`} x{count}
            </span>
          ));
        })()}
      </div>

      {activeTab === "L345" && p2 && Object.keys(p2).length > 0 ? (
        <ScenePerNodeGroups p2={p2} edit={edit} expandedGroup={expandedGroup} setExpandedGroup={setExpandedGroup} />
      ) : activeTab === "all" ? (
        <SceneTreeMerged scenes={scenes} />
      ) : (
        <SceneList scenes={activeScenes} />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Item Database (full view)
// ══════════════════════════════════════════════════════════════════════════════

const RARITY_COLORS: Record<string, string> = {
  common: "#aaa", uncommon: "#3c3", rare: "#36f", epic: "#a6f", legendary: "#fa3",
};

function FullItemDatabaseView({ items }: { items: Record<string, unknown>[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const edit = useNodeEdit("item_database");

  return (
    <div className="item-db-list">
      <div className="scene-stats">
        <span className="scene-stat-badge">道具清单 · {items.length} 件</span>
      </div>
      {items.map((item, i) => {
        const nodeId = String(item.name ?? `道具${i + 1}`);
        const rarity = String(item.rarity ?? "common");
        const category = String(item.category ?? "");
        const isOpen = expanded === nodeId;
        const isNodeEditing = edit.editingNodeId === nodeId;
        const desc = String(item.description ?? "");
        const effect = String(item.effect ?? "");
        const owner = item.initial_owner ? String(item.initial_owner) : "";
        const scene = item.initial_scene ? String(item.initial_scene) : "";
        const relChar = item.related_character ? String(item.related_character) : "";
        const val = item.value as Record<string, number> | undefined;
        const maxStack = item.max_stack != null ? String(item.max_stack) : "";
        const readContent = item.read_content ? String(item.read_content) : "";

        return (
          <div
            key={`${nodeId}_${i}`}
            className={`char-card-text ${isOpen ? "expanded" : ""}${isNodeEditing ? " editing" : ""}`}
          >
            <div className="char-card-header" onClick={() => setExpanded(isOpen ? null : nodeId)}>
              <span className="char-toggle">{isOpen ? "▾" : "▸"}</span>
              <span className="node-badge" style={{ color: RARITY_COLORS[rarity] ?? "#aaa" }}>
                {rarity}
              </span>
              <strong className="char-card-name">{nodeId}</strong>
              {category && <span className="char-card-occ">{category}</span>}
            </div>
            {!isOpen && desc && (
              <div className="char-card-meta" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {desc.slice(0, 60)}{desc.length > 60 ? "…" : ""}
              </div>
            )}

            {isOpen && (
              <div className="char-card-detail">
                {isNodeEditing ? (
                  <NodeEditTextarea value={edit.editContent} onChange={edit.setEditContent} rows={10} />
                ) : (
                  <>
                    {desc && <CharRow label="描述" value={desc} />}
                    {effect && <CharRow label="效果" value={effect} />}
                    {owner && <CharRow label="初始拥有者" value={owner} />}
                    {scene && <CharRow label="初始场景" value={scene} />}
                    {relChar && <CharRow label="关联角色" value={relChar} />}
                    {val && (
                      <CharRow label="价值" value={
                        Object.entries(val).map(([k, v]) => `${k === "buy" ? "买入" : k === "sell" ? "卖出" : k}: ${v}`).join(" / ")
                      } />
                    )}
                    {maxStack && <CharRow label="最大堆叠" value={maxStack} />}
                    {readContent && <CharRow label="可读内容" value={readContent} />}
                  </>
                )}
              </div>
            )}

            {edit.showNodeInput === nodeId && isOpen && (
              <NodeUserInputBox value={edit.nodeUserInput} onChange={edit.setNodeUserInput} />
            )}

            {isOpen && edit.canEditNodes && (
              <NodeEditActions
                nodeId={nodeId}
                isEditing={isNodeEditing}
                showInput={edit.showNodeInput === nodeId}
                canSave={isNodeEditing || !!edit.nodeUserInput.trim()}
                onEdit={() => edit.handleNodeEdit(nodeId, item)}
                onInput={() => edit.toggleNodeInput(nodeId)}
                onSave={() => edit.handleNodeSave(nodeId)}
                onCancel={() => edit.handleNodeCancel(nodeId)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Quest Graph (full view)
// ══════════════════════════════════════════════════════════════════════════════

const QUEST_TYPE_LABEL: Record<string, string> = {
  main: "主线", side: "支线", exploration: "探索", collection: "收集", challenge: "挑战",
};

function FullQuestGraphView({ questGraph }: { questGraph: NarrativeContext["quest_graph"] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const edit = useNodeEdit("quest_generation");
  if (!questGraph) return null;
  const quests = questGraph.quests ?? [];
  const mainChain = questGraph.main_quest_chain ?? [];

  return (
    <div className="quest-graph-view">
      <div className="scene-stats">
        <span className="scene-stat-badge">任务系统 · {quests.length} 个任务</span>
        <span className="scene-stat-badge">主线链 · {mainChain.length} 步</span>
      </div>
      {quests.map((q, i) => {
        const quest = q as Record<string, unknown>;
        const qid = String(quest.quest_id ?? `q_${i}`);
        const qname = String(quest.name ?? "");
        const qtype = String(quest.type ?? "main");
        const isOpen = expandedId === qid;
        const isNodeEditing = edit.editingNodeId === qid;
        return (
          <div key={qid} className={`char-card${isNodeEditing ? " editing" : ""}`}>
            <div className="char-header" onClick={() => setExpandedId(isOpen ? null : qid)}>
              <span className="char-toggle">{isOpen ? "▾" : "▸"}</span>
              <span className="char-name">{qname}</span>
              <span className="node-badge" style={{
                color: qtype === "main" ? "#fa3" : "#6cf",
              }}>
                {QUEST_TYPE_LABEL[qtype] ?? qtype}
              </span>
              <span className="char-role">{String(quest.story_node_id ?? "")}</span>
            </div>
            {isOpen && (
              <div className="char-details">
                {isNodeEditing ? (
                  <NodeEditTextarea value={edit.editContent} onChange={edit.setEditContent} rows={12} />
                ) : (
                  <GenericObjectView data={(() => {
                    const { quest_id: _qid, name: _qn, type: _qt, ...rest } = quest;
                    return rest;
                  })()} />
                )}
              </div>
            )}

            {edit.showNodeInput === qid && isOpen && (
              <NodeUserInputBox value={edit.nodeUserInput} onChange={edit.setNodeUserInput} />
            )}

            {isOpen && edit.canEditNodes && (
              <NodeEditActions
                nodeId={qid}
                isEditing={isNodeEditing}
                showInput={edit.showNodeInput === qid}
                canSave={isNodeEditing || !!edit.nodeUserInput.trim()}
                onEdit={() => edit.handleNodeEdit(qid, quest)}
                onInput={() => edit.toggleNodeInput(qid)}
                onSave={() => edit.handleNodeSave(qid)}
                onCancel={() => edit.handleNodeCancel(qid)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Shared components
// ══════════════════════════════════════════════════════════════════════════════

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv-row">
      <span className="kv-label">{label}</span>
      <span className="kv-value">{value}</span>
    </div>
  );
}

function LabelSpan({ children, color }: { children: React.ReactNode; color?: "gold" | "blue" }) {
  const cls = color === "gold" ? "label-gold" : color === "blue" ? "label-blue" : "label-green";
  return <span className={`nti-label ${cls}`}>{children}</span>;
}

function ProseBlock({ title, text, color }: { title: string; text: string; color?: "green" | "gold" | "blue" }) {
  const colorCls = color === "gold" ? "prose-title-gold" : color === "blue" ? "prose-title-blue" : "prose-title-green";
  return (
    <div className="prose-block">
      <div className={`prose-block-title ${colorCls}`}>{title}</div>
      <MarkdownBlock text={text} />
    </div>
  );
}


function PlotSynopsisView({ ps }: { ps: PlotSynopsis }) {
  return (
    <div className="synopsis-view">
      {ps.synopsis_strategy && (
        <div className="synopsis-strategy">
          <span className="synopsis-strategy-label">策略</span>
          <span className="synopsis-strategy-text">{ps.synopsis_strategy}</span>
        </div>
      )}
      <ProseBlock title="剧情" text={ps.synopsis} />
      {ps.highlight_analysis && (
        <ProseBlock title="核心亮点分析" text={ps.highlight_analysis} color="gold" />
      )}
    </div>
  );
}
