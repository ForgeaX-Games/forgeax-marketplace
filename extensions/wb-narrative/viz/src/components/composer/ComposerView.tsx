import { useCallback, useRef, useState } from "react";
import { Play, Trash2 } from "lucide-react";
import { ReactFlowProvider } from "reactflow";
import { useNarrativeStore } from "../../store/narrativeStore";
import { startRun } from "../../hooks/useNarrativeStream";
import { getLocale, useT } from "../../i18n";
import type { TierId, ModeId } from "../../types";
import { ComposerCanvas } from "./ComposerCanvas";
import { ComposerNodeConfigPanel } from "./ComposerNodeConfigPanel";
import { ComposerPalette } from "./ComposerPalette";

/**
 * 无限画布编排视图（"未生成"态取代只读节点视图）。
 * 顶部工具条（开始编排生成 / 清空）+ 可编辑画布 + 底部调色板 + 右侧节点配置面板。
 *
 * 场景：空项目自由组合——拖入输入节点锚定一条管线，连线专家/助手/工程师，配置路由后开始生成。
 * 以输入节点为锚点：多输入将各建条目（本期实跑首条锚定管线，沿用现有整条管线；自定义步序执行延后）。
 */
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
    const primary = anchored[0];
    const routing = primary.routingNode;
    const expert = primary.orderedNodes.find((n) => n.category === "expert");
    const userInput = String(primary.inputNode.config.userInput ?? "").trim();
    if (!userInput) {
      setError(t("composer.cfg.inputPlaceholder"));
      setSelectedId(primary.inputNode.id);
      return;
    }
    const routeGroup =
      ((routing?.config.routeGroup as "planning" | "narrative" | undefined) ??
        expert?.routeGroup ??
        "planning");
    const tier = ((routing?.config.tier as TierId | null | undefined) ?? expert?.tier ?? undefined) || undefined;
    const genreCode = (routing?.config.genreCode as string | undefined) || undefined;
    const complexity = (routing?.config.complexity as number | undefined) ?? undefined;

    lockRef.current = true;
    setStarting(true);
    try {
      if (useNarrativeStore.getState().runningRunId) {
        useNarrativeStore.getState().cancelRun();
      }
      const res = await startRun(userInput, {
        tier,
        autoDetect: !genreCode,
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
          <ComposerPalette />
        </div>
        <ComposerNodeConfigPanel selectedId={selectedId} />
      </div>
    </div>
  );
}
