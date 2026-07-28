import { useCallback, useRef, useState } from "react";
import { Play, Trash2 } from "lucide-react";
import { ReactFlowProvider } from "reactflow";
import { useNarrativeStore } from "../../store/narrativeStore";
import { startRun } from "../../hooks/useNarrativeStream";
import { getLocale, useT } from "../../i18n";
import type { TierId, ModeId } from "../../types";
import { composerIpGenerators } from "../../composer/composerCatalog";
import { ComposerCanvas } from "./ComposerCanvas";
import { ComposerPalette } from "./ComposerPalette";

/**
 * 无限画布编排视图（"未生成"态取代只读节点视图）。
 * 顶部工具条（开始编排生成 / 清空）+ 可编辑画布 + 底部调色板 + 右侧节点配置面板。
 *
 * 场景：空项目自由组合——拖入输入节点锚定一条管线，连线专家/助手/工程师，配置路由后开始生成。
 * 以输入节点为锚点：多输入将各建条目（本期实跑首条锚定管线，沿用现有整条管线；自定义步序执行延后）。
 */
/** 按输入节点子类型合成需求文本：直接输入=原文；标签选择=各维标签串接 + 自定义补充。 */
function composeUserInput(config: Record<string, unknown>): string {
  const tab = (config.inputTab as string) ?? "text";
  if (tab === "tags") {
    const sel = (config.tagSelections as Record<string, string>) ?? {};
    const parts = Object.values(sel).map((v) => String(v ?? "").trim()).filter(Boolean);
    const custom = String(((config.tagCustomTexts as Record<string, string>) ?? {}).custom ?? "").trim();
    if (custom) parts.push(custom);
    return parts.join("；");
  }
  return String(config.userInput ?? "").trim();
}

export function ComposerView() {
  const t = useT();
  const composerNodes = useNarrativeStore((s) => s.composerNodes);
  // 订阅 edges：锚点数量随连线变化，保证工具条提示实时刷新。
  useNarrativeStore((s) => s.composerEdges);
  const clearComposer = useNarrativeStore((s) => s.clearComposer);
  const getAnchoredPipelines = useNarrativeStore((s) => s.getAnchoredPipelines);
  const storeStartNewRun = useNarrativeStore((s) => s.startNewRun);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const lockRef = useRef(false);

  const pipelines = getAnchoredPipelines();
  const inputCount = pipelines.length;

  const handleRun = useCallback(async () => {
    if (lockRef.current) return;
    setError(null);
    const anchored = getAnchoredPipelines();
    if (anchored.length === 0) {
      setError(t("composer.noInput"));
      return;
    }
    // 本期实跑首条锚定管线（以输入节点为锚点）；多输入=多条目，后续可扩。
    const primary = anchored[0];
    const routing = primary.routingNode;
    const expert = primary.orderedNodes.find((n) => n.category === "expert");

    // 文件上传锚点：IP 改编为多步半自动流程（节点内确认作品→标准化→体量→改编范围→改编规划）；
    // 生成入口统一在此顶部——用节点 IpStageFlow 上报的触发器发起（就绪才触发，否则提示补全各步）。
    if ((primary.inputNode.config.inputTab as string) === "file") {
      const trigger = composerIpGenerators.get(primary.inputNode.id);
      setSelectedId(primary.inputNode.id);
      if (trigger?.canGenerate) trigger.generate();
      else setError(t("composer.fileFlowHint"));
      return;
    }

    // 输入需求：按输入子类型合成文本（直接输入=原文；标签选择=标签串+自定义）。
    const userInput = composeUserInput(primary.inputNode.config);
    if (!userInput) {
      setError(t("composer.cfg.inputPlaceholder"));
      setSelectedId(primary.inputNode.id);
      return;
    }

    // 冲突以「自由编排」为准：路由节点(自由配置) 优先于 专家节点(预设管线)，专家仅兜底缺省。
    const routeGroup =
      ((routing?.config.routeGroup as "planning" | "narrative" | undefined) ??
        expert?.routeGroup ??
        "planning");

    let tier: TierId | undefined;
    let mode: ModeId | undefined;
    let genreCode: string | undefined;
    let autoDetect: boolean;
    const complexity = (routing?.config.complexity as number | undefined) ?? undefined;

    if (routeGroup === "narrative") {
      // 叙事单品：以路由节点选定的叙事模块为准；narrative_auto 走后端自动检测。
      mode = ((routing?.config.mode as ModeId | undefined) ?? "narrative_auto");
      autoDetect = mode === "narrative_auto";
    } else {
      // 叙事全量：层级/品类以路由节点为准，缺省回落专家预设。
      tier = ((routing?.config.tier as TierId | null | undefined) ?? expert?.tier ?? undefined) || undefined;
      genreCode = (routing?.config.genreCode as string | undefined) || undefined;
      autoDetect = !genreCode;
    }

    lockRef.current = true;
    setStarting(true);
    try {
      if (useNarrativeStore.getState().runningRunId) {
        useNarrativeStore.getState().cancelRun();
      }
      // §条目建立时机：仅在此刻（点击「开始编排生成」）向后端发起 run 并落条目，
      // 拖拽/连线/配置阶段不建条目。生成后与左侧「1 输入 + 2 路由」路径统一展示后端数据。
      const res = await startRun(userInput, {
        tier,
        mode,
        autoDetect,
        complexity,
        routeGroup,
        genreCode,
        locale: getLocale(),
      });
      const entryKey = (res as unknown as { sourceDir?: string }).sourceDir ?? res.id;
      storeStartNewRun(res.id, entryKey, res.tier as TierId | undefined, res.mode as ModeId | undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lockRef.current = false;
      setStarting(false);
    }
  }, [getAnchoredPipelines, storeStartNewRun, t]);

  return (
    <div className="composer-view">
      <div className="composer-view__toolbar">
        <button
          type="button"
          className="fx-btn fx-btn--primary"
          onClick={handleRun}
          disabled={starting || composerNodes.length === 0}
        >
          <Play size={13} aria-hidden />
          {t("composer.run")}
        </button>
        <button
          type="button"
          className="fx-btn fx-btn--danger"
          onClick={() => { clearComposer(); setSelectedId(null); }}
          disabled={composerNodes.length === 0}
        >
          <Trash2 size={13} aria-hidden />
          {t("composer.clear")}
        </button>
        <span className="composer-view__hint">
          {error
            ? error
            : inputCount > 1
              ? t("composer.multiInput", { n: inputCount })
              : t("composer.hint")}
        </span>
      </div>

      <div className="composer-view__body">
        <div className="composer-view__canvas">
          {composerNodes.length === 0 && (
            <div className="composer-view__empty">
              <span style={{ fontSize: 24, opacity: 0.3 }}>◈</span>
              <span>{t("composer.empty")}</span>
            </div>
          )}
          <ReactFlowProvider>
            <ComposerCanvas selectedId={selectedId} onSelect={setSelectedId} />
          </ReactFlowProvider>
        </div>
        <ComposerPalette />
      </div>
    </div>
  );
}
