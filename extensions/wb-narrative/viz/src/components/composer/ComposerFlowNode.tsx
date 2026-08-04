import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "reactflow";
import { useNarrativeStore } from "../../store/narrativeStore";
import { useT, getLocale } from "../../i18n";
import { TEMPLATE_LABELS } from "../../pipeline-templates";
import {
  TIER_ITEMS,
  NARRATIVE_ROUTES,
  TAG_DIMENSIONS,
  COMPLEXITY_LEVELS,
  TIER_HAS_COMPLEXITY,
} from "../../lib/routingCatalog";
import type { UploadedItem } from "../../lib/uploads";
import { fetchGenres, type GenreCategoryGroup } from "../../hooks/useNarrativeStream";
import { useSingleAgentRun } from "../../hooks/useSingleAgentRun";
import { computeAnchoredPipelines, CATEGORY_COLOR } from "../../composer/composerCatalog";
import type { TierId, ModeId } from "../../types";
import { ComposerFileEditor } from "./ComposerFileEditor";

const LONG_PRESS_MS = 250;
const MOVE_THRESHOLD = 4;

export interface ComposerFlowData {
  isolated?: boolean;
}

interface DragState {
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  dragging: boolean;
  moved: boolean;
}

// 品类目录按 locale 缓存（多个「叙事全量」节点复用同一份，避免重复请求）。
const genreCache: Record<string, Promise<GenreCategoryGroup[]>> = {};
function loadGenres(locale: string): Promise<GenreCategoryGroup[]> {
  if (!genreCache[locale]) genreCache[locale] = fetchGenres(locale).catch(() => []);
  return genreCache[locale];
}

/**
 * 无限画布节点组件。参照管线状态节点（PipelineStepNode）：横向左入右出、前后连接。
 *
 * 交互（内在逻辑 = 并/交/补）：
 *  - 拖动手柄 = 标题栏 ∪ 简介栏(收起态)；展开态简介栏隐藏，手柄只剩标题栏。
 *  - 交互补集 = 详情/编辑栏（展开态）：点击编辑，不触发拖动/平移。
 *  - 节点整体带 `nopan`：长按拖节点时画布不跟随；空白画布仍可拖动平移。
 *  - 长按(≥250ms)标题/简介栏进入拖动；短按(几乎无位移)切换展开/收起。
 *
 * 详情栏完全复刻左侧栏对应入口：
 *  - 直接输入 → 需求文本框；标签选择 → 五维标签+自定义；文件上传 → 拖放区+文件列表。
 *  - 叙事全量 → 叙事层级/游戏品类/复杂度；叙事单品 → 叙事模块/复杂度。
 */
function ComposerFlowNodeRaw({ id, data, selected }: NodeProps<ComposerFlowData>) {
  const t = useT();
  const composerNodes = useNarrativeStore((s) => s.composerNodes);
  const composerEdges = useNarrativeStore((s) => s.composerEdges);
  const node = composerNodes.find((n) => n.id === id);
  const setComposerNodeConfig = useNarrativeStore((s) => s.setComposerNodeConfig);
  const moveComposerNode = useNarrativeStore((s) => s.moveComposerNode);
  const { getViewport } = useReactFlow();
  const [expanded, setExpanded] = useState(false);
  // 文件上传件驻留在节点本地态（含正文/base64），不入 config，避免持久化膨胀。
  const [uploadedItems, setUploadedItems] = useState<UploadedItem[]>([]);

  const dragRef = useRef<DragState | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const cfg = node?.config ?? {};
  const routeGroup = (cfg.routeGroup as string) ?? "planning";
  const inputTab = (cfg.inputTab as string) ?? "text";

  // 「叙事全量」节点：拉取品类目录（按 locale 缓存）。
  const [genres, setGenres] = useState<GenreCategoryGroup[]>([]);
  const needGenres = node?.category === "routing" && routeGroup === "planning";
  useEffect(() => {
    if (!needGenres) return;
    let alive = true;
    loadGenres(getLocale()).then((g) => { if (alive) setGenres(g); });
    return () => { alive = false; };
  }, [needGenres]);

  const tierVal = (cfg.tier as string | null) ?? null;
  const genreOptions = useMemo(() => {
    if (!tierVal || tierVal === "auto") return [];
    return genres
      .flatMap((c) => c.genres)
      .filter((g) => g.tier === tierVal)
      .map((g) => ({ code: g.code, name: g.name }));
  }, [genres, tierVal]);

  // 文件上传节点：从下游连接的「叙事路由」节点解析 tier/mode/complexity/是否就绪，喂给 IpStageFlow。
  const fileRouting = useMemo(() => {
    if (!node || node.category !== "input" || inputTab !== "file") return null;
    const mine = computeAnchoredPipelines(composerNodes, composerEdges).find(
      (p) => p.inputNode.id === node.id,
    );
    const r = mine?.routingNode;
    const rc = (r?.config ?? {}) as Record<string, unknown>;
    const rTier = (rc.tier as TierId | null | undefined) ?? undefined;
    const rMode = rc.mode as ModeId | undefined;
    const rGenre = rc.genreCode as string | undefined;
    const routingReady = !!rTier || !!rGenre || (!!rMode && rMode !== "narrative_auto");
    return {
      tier: rTier,
      mode: r?.routeGroup === "narrative" ? rMode : undefined,
      complexity: rc.complexity as number | undefined,
      routingReady,
    };
  }, [node, inputTab, composerNodes, composerEdges]);

  // 单 agent 试跑（Phase-2 M9）：工程师 = 单步 agent，专家 = composite 子 DAG。
  // 二者都能脱离管线单跑；agent id 分别取 stepId 与 pipelineTemplate（后者已注册 composite AgentDef）。
  const soloRun = useSingleAgentRun();
  const soloAgentId =
    node?.category === "engineer"
      ? (node.stepId ?? null)
      : node?.category === "expert"
        ? (node.pipelineTemplate ?? null)
        : null;
  // 试跑要有需求文本：取本节点所在管线的输入节点内容（与 fileRouting 同一条解析路径）。
  const soloUserInput = useMemo(() => {
    if (!node || !soloAgentId) return "";
    const mine = computeAnchoredPipelines(composerNodes, composerEdges).find((p) =>
      p.orderedNodes.some((n) => n.id === node.id),
    );
    return String(mine?.inputNode.config.userInput ?? "").trim();
  }, [node, soloAgentId, composerNodes, composerEdges]);

  if (!node) return null;
  const isolated = data.isolated && node.category !== "input";

  // ── 节点起止类型 & 连接态（Part4）──────────────────────────────
  // 起始节点 = 输入节点（管线锚点）：无前驱，左侧不出把手。
  // 结尾节点：暂无固定"结尾"类别，其余节点左右皆出把手，供自由串接。
  const isStart = node.category === "input";
  const hasIncoming = composerEdges.some((e) => e.target === node.id);
  const hasOutgoing = composerEdges.some((e) => e.source === node.id);
  const catColor = CATEGORY_COLOR[node.category];
  const set = (patch: Record<string, unknown>) => setComposerNodeConfig(node.id, patch);
  // 编辑内容即置为"待确认"（脏态）；点「确认」才置 confirmed。
  const setField = (patch: Record<string, unknown>) => set({ ...patch, confirmed: false });
  const confirmed = !!cfg.confirmed;
  const needsConfirm = node.category === "input" || node.category === "routing";

  // ── 拖动手柄：长按拖动 / 短按切换 ──────────────────────────────
  const onDragPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: node.position.x,
      origY: node.position.y,
      dragging: false,
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      const ds = dragRef.current;
      if (ds) ds.dragging = true;
    }, LONG_PRESS_MS);
  };

  const onDragPointerMove = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) ds.moved = true;
    if (ds.dragging) {
      const zoom = getViewport().zoom || 1;
      moveComposerNode(node.id, { x: ds.origX + dx / zoom, y: ds.origY + dy / zoom });
    }
  };

  const onDragPointerUp = (e: React.PointerEvent) => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    const ds = dragRef.current;
    dragRef.current = null;
    if (!ds) return;
    if (!ds.moved) setExpanded((v) => !v);
  };

  const cls = [
    "rf-pipeline-node",
    "composer-node",
    "nopan",
    `cat-${node.category}`,
    selected ? "selected" : "",
    isolated ? "isolated" : "",
    expanded ? "is-expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const summary = (() => {
    switch (node.category) {
      case "input": {
        if (inputTab === "tags") {
          const sel = (cfg.tagSelections as Record<string, string>) ?? {};
          const picked = Object.values(sel).filter(Boolean);
          return picked.length ? picked.join(" · ") : t("composer.node.noInput");
        }
        if (inputTab === "file") {
          return uploadedItems.length
            ? uploadedItems.map((f) => f.name).join(", ")
            : t("composer.cfg.fileEmpty");
        }
        const v = String(cfg.userInput ?? "").trim();
        return v || t("composer.node.noInput");
      }
      case "routing": {
        if (routeGroup === "narrative") {
          const m = (cfg.mode as string) || "narrative_auto";
          const label = t(`route.${m}.label`);
          return label === `route.${m}.label` ? m : label;
        }
        const tl = tierVal
          ? (t(`tier.${tierVal}`) === `tier.${tierVal}` ? tierVal.toUpperCase() : t(`tier.${tierVal}`))
          : t("composer.cfg.tierAuto");
        const g = cfg.genreCode ? ` · ${cfg.genreCode}` : "";
        return `${label(t, "composer.cfg.routeGroup.planning")}｜${tl}${g}`;
      }
      case "expert":
        return node.pipelineTemplate
          ? (TEMPLATE_LABELS[node.pipelineTemplate] ?? node.pipelineTemplate)
          : "—";
      case "assistant":
        return t("composer.cfg.strategy");
      case "engineer":
        return node.stepId ?? t("composer.cfg.step");
      default:
        return "";
    }
  })();

  const statusKind: "isolated" | "ready" | "pending" = isolated
    ? "isolated"
    : needsConfirm
      ? (confirmed ? "ready" : "pending")
      : "ready";
  const statusText =
    statusKind === "isolated"
      ? t("composer.node.isolated")
      : statusKind === "pending"
        ? t("composer.node.unconfirmed")
        : needsConfirm
          ? t("tms.confirmDone")
          : t("composer.node.ready");

  const complexityOptions = COMPLEXITY_LEVELS.map((c) => {
    const lab = t(`complexity.${c.level}.label`);
    return { level: c.level, label: lab === `complexity.${c.level}.label` ? String(c.level) : lab };
  });

  return (
    <div className={cls} style={{ ["--cat-color" as string]: catColor }}>
      {/* 起始节点（输入）无左把手；其余左侧出把手，空心=未连线 / 实心=已连线 */}
      {!isStart && (
        <Handle
          type="target"
          position={Position.Left}
          className={`rf-handle composer-handle ${hasIncoming ? "is-filled" : "is-empty"}`}
        />
      )}

      {/* 拖动手柄：标题栏 + 简介栏(收起) */}
      <div
        className="composer-node__drag"
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={onDragPointerUp}
      >
        <div className="rf-pipeline-header composer-node__head">
          <span className="composer-node__icon" aria-hidden>{node.icon}</span>
          <span className="rf-pipeline-label composer-node__title">{node.label}</span>
          <span className={`composer-node__status is-${statusKind}`}>
            <span className="composer-node__status-dot" aria-hidden />
            <span className="composer-node__status-text">{statusText}</span>
          </span>
        </div>
        {!expanded && (
          <div className="composer-node__summary" title={typeof summary === "string" ? summary : undefined}>
            {summary}
          </div>
        )}
      </div>

      {/* 详情/编辑栏（交互补集）：点击编辑，不触发拖动/平移 */}
      {expanded && (
        <div className="composer-node__editor nodrag nopan">
          {/* ── 输入需求：直接输入 ── */}
          {node.category === "input" && inputTab === "text" && (
            <>
              <label className="composer-config__field">
                <span className="composer-config__label">{t("composer.cfg.input")}</span>
                <textarea
                  className="composer-config__textarea"
                  rows={5}
                  placeholder={t("composer.cfg.inputPlaceholder")}
                  value={(cfg.userInput as string) ?? ""}
                  onChange={(e) => setField({ userInput: e.target.value })}
                />
              </label>
              <ConfirmFoot
                confirmed={confirmed}
                disabled={!String(cfg.userInput ?? "").trim()}
                onConfirm={() => set({ confirmed: true })}
                t={t}
              />
            </>
          )}

          {/* ── 输入需求：标签选择 ── */}
          {node.category === "input" && inputTab === "tags" && (
            <>
              {TAG_DIMENSIONS.filter((d) => !d.allowCustom).map((dim) => (
                <label className="composer-config__field" key={dim.key}>
                  <span className="composer-config__label">{t(dim.nameKey)}</span>
                  <select
                    className="composer-config__select"
                    value={((cfg.tagSelections as Record<string, string>) ?? {})[dim.key] ?? ""}
                    onChange={(e) =>
                      setField({
                        tagSelections: {
                          ...((cfg.tagSelections as Record<string, string>) ?? {}),
                          [dim.key]: e.target.value,
                        },
                      })
                    }
                  >
                    <option value="">{t("tms.tags.unlimited") === "tms.tags.unlimited" ? "不限" : t("tms.tags.unlimited")}</option>
                    {dim.options.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </label>
              ))}
              <label className="composer-config__field">
                <span className="composer-config__label">{t("composer.cfg.tagsCustom")}</span>
                <input
                  className="composer-config__input"
                  type="text"
                  placeholder={t("composer.cfg.tagsCustomPlaceholder")}
                  value={((cfg.tagCustomTexts as Record<string, string>) ?? {}).custom ?? ""}
                  onChange={(e) =>
                    setField({
                      tagCustomTexts: {
                        ...((cfg.tagCustomTexts as Record<string, string>) ?? {}),
                        custom: e.target.value,
                      },
                    })
                  }
                />
              </label>
              <ConfirmFoot
                confirmed={confirmed}
                disabled={
                  Object.values((cfg.tagSelections as Record<string, string>) ?? {}).filter(Boolean).length === 0 &&
                  !String(((cfg.tagCustomTexts as Record<string, string>) ?? {}).custom ?? "").trim()
                }
                onConfirm={() => set({ confirmed: true })}
                t={t}
              />
            </>
          )}

          {/* ── 输入需求：文件上传（全量迁移 §1.3：真实读取 + IP 预处理流程 IpStageFlow）── */}
          {node.category === "input" && inputTab === "file" && fileRouting && (
            <ComposerFileEditor
              nodeId={node.id}
              items={uploadedItems}
              onItemsChange={setUploadedItems}
              tier={fileRouting.tier}
              mode={fileRouting.mode}
              complexity={fileRouting.complexity}
              routingReady={fileRouting.routingReady}
            />
          )}

          {/* ── 叙事路由：叙事全量 ── */}
          {node.category === "routing" && routeGroup === "planning" && (
            <>
              <label className="composer-config__field">
                <span className="composer-config__label">{t("composer.cfg.tier")}</span>
                <select
                  className="composer-config__select"
                  value={tierVal ?? "auto"}
                  onChange={(e) => setField({ tier: e.target.value === "auto" ? null : e.target.value, genreCode: null })}
                >
                  {TIER_ITEMS.map((it) => {
                    const lab = it.id === "auto"
                      ? t("composer.cfg.tierAuto")
                      : (t(`tier.${it.id}`) === `tier.${it.id}` ? it.id.toUpperCase() : t(`tier.${it.id}`));
                    return <option key={it.id} value={it.id}>{lab}</option>;
                  })}
                </select>
              </label>
              <label className="composer-config__field">
                <span className="composer-config__label">{t("composer.cfg.genreSelect")}</span>
                <select
                  className="composer-config__select"
                  value={(cfg.genreCode as string) ?? ""}
                  disabled={!tierVal || tierVal === "auto"}
                  onChange={(e) => setField({ genreCode: e.target.value || null })}
                >
                  <option value="">
                    {!tierVal || tierVal === "auto"
                      ? t("composer.cfg.tierSelectFirst")
                      : (t("field.any") === "field.any" ? "不限" : t("field.any"))}
                  </option>
                  {genreOptions.map((g) => (
                    <option key={g.code} value={g.code}>{g.name}</option>
                  ))}
                </select>
              </label>
              {TIER_HAS_COMPLEXITY[tierVal ?? "auto"] && (
                <label className="composer-config__field">
                  <span className="composer-config__label">{t("composer.cfg.complexity")}</span>
                  <select
                    className="composer-config__select"
                    value={(cfg.complexity as number) ?? ""}
                    onChange={(e) => setField({ complexity: e.target.value ? Number(e.target.value) : undefined })}
                  >
                    <option value="">{t("composer.cfg.tierAuto")}</option>
                    {complexityOptions.map((c) => (
                      <option key={c.level} value={c.level}>{c.label}</option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}

          {/* ── 叙事路由：叙事单品 ── */}
          {node.category === "routing" && routeGroup === "narrative" && (
            <>
              <label className="composer-config__field">
                <span className="composer-config__label">{t("composer.cfg.module")}</span>
                <select
                  className="composer-config__select"
                  value={(cfg.mode as string) ?? "narrative_auto"}
                  onChange={(e) => setField({ mode: e.target.value })}
                >
                  {NARRATIVE_ROUTES.map((r) => {
                    const lab = t(`route.${r.id}.label`);
                    return <option key={r.id} value={r.id}>{lab === `route.${r.id}.label` ? r.id : lab}</option>;
                  })}
                </select>
              </label>
              {(NARRATIVE_ROUTES.find((r) => r.id === (cfg.mode ?? "narrative_auto"))?.hasComplexity) && (
                <label className="composer-config__field">
                  <span className="composer-config__label">{t("composer.cfg.complexity")}</span>
                  <select
                    className="composer-config__select"
                    value={(cfg.complexity as number) ?? ""}
                    onChange={(e) => setField({ complexity: e.target.value ? Number(e.target.value) : undefined })}
                  >
                    <option value="">{t("composer.cfg.tierAuto")}</option>
                    {complexityOptions.map((c) => (
                      <option key={c.level} value={c.level}>{c.label}</option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}

          {/* ── 叙事路由：确认（叙事全量 / 叙事单品 共用；确认后条目/生成由顶部统一触发）── */}
          {node.category === "routing" && (
            <ConfirmFoot
              confirmed={confirmed}
              disabled={false}
              onConfirm={() => set({ confirmed: true })}
              t={t}
            />
          )}

          {/* ── 专家 / 助手 / 工程师：只读信息 ── */}
          {node.category === "expert" && node.pipelineTemplate && (
            <div className="composer-config__field">
              <span className="composer-config__label">{t("composer.cfg.pipeline")}</span>
              <span className="composer-config__readonly">
                {TEMPLATE_LABELS[node.pipelineTemplate] ?? node.pipelineTemplate}
                {node.tier ? ` · ${node.tier.toUpperCase()}` : ""}
              </span>
            </div>
          )}
          {soloAgentId && (
            <SoloRunFoot
              agentId={soloAgentId}
              userInput={soloUserInput}
              run={soloRun}
              t={t}
            />
          )}
          {node.category === "assistant" && (
            <div className="composer-config__field">
              <span className="composer-config__label">{t("composer.cfg.strategy")}</span>
              <span className="composer-config__readonly">{node.label}</span>
            </div>
          )}
          {node.category === "engineer" && (
            <div className="composer-config__field">
              <span className="composer-config__label">{t("composer.cfg.step")}</span>
              <span className="composer-config__readonly">{node.stepId ?? node.label}</span>
            </div>
          )}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className={`rf-handle composer-handle ${hasOutgoing ? "is-filled" : "is-empty"}`}
      />
    </div>
  );
}

/** 节点确认按钮（复刻左栏 §1/§2「确认」）：确认后置灰显示「✓ 确认」，编辑内容后重新点亮。 */
function ConfirmFoot({
  confirmed,
  disabled,
  onConfirm,
  t,
}: {
  confirmed: boolean;
  disabled: boolean;
  onConfirm: () => void;
  t: (k: string) => string;
}) {
  return (
    <div className="ip-stage-card__foot composer-config__foot">
      <button
        type="button"
        className="btn-generate btn-generate--compact ip-stage-btn"
        disabled={disabled || confirmed}
        onClick={onConfirm}
      >
        {confirmed ? t("tms.confirmDone") : t("tms.confirm")}
      </button>
    </div>
  );
}

/**
 * 单 agent 试跑控件（Phase-2 M9）。
 * composite 专家会按子步逐个点亮，故这里把 announce 出来的步序原样铺成 chip 行。
 */
function SoloRunFoot({
  agentId,
  userInput,
  run,
  t,
}: {
  agentId: string;
  userInput: string;
  run: ReturnType<typeof useSingleAgentRun>;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  const { state, start } = run;
  const running = state.status === "running";
  const done = state.steps.filter((s) => s.status === "completed").length;
  return (
    <div className="composer-config__field composer-solo">
      <span className="composer-config__label">{t("composer.solo.label")}</span>
      <div className="composer-solo__row">
        <button
          type="button"
          className="btn-generate btn-generate--compact ip-stage-btn"
          disabled={running || !userInput}
          title={userInput ? undefined : t("composer.solo.needInput")}
          onClick={() => start(agentId, { userInput })}
        >
          {running
            ? t("composer.solo.running", { done, total: state.steps.length })
            : t("composer.solo.run")}
        </button>
        {state.status === "completed" && (
          <span className="composer-solo__state is-completed">{t("composer.solo.done")}</span>
        )}
        {state.status === "failed" && (
          <span className="composer-solo__state is-failed" title={state.error}>
            {t("composer.solo.failed")}
          </span>
        )}
      </div>
      {state.steps.length > 0 && (
        <div className="composer-solo__steps">
          {state.steps.map((s) => (
            <span key={s.id} className={`composer-solo__step is-${s.status}`} title={s.message}>
              {s.id}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** 小工具：i18n 取值，缺失回退。 */
function label(t: (k: string) => string, key: string): string {
  const v = t(key);
  return v === key ? key.split(".").pop() ?? key : v;
}

export const ComposerFlowNode = memo(ComposerFlowNodeRaw);
