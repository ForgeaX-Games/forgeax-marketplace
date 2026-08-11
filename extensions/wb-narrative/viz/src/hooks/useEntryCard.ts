import { useEffect, useMemo, useState } from "react";
import { findCatalogItem, isEntryNode } from "../composer/composerCatalog";
import { useT } from "../i18n";
import { axisOptionLabel, loadNarrativeAxes } from "../lib/axesCache";
import { useNarrativeStore } from "../store/narrativeStore";
import type { NarrativeAxesCatalog } from "./useNarrativeStream";

/** 进度画布上那枚入口卡：标题 + 一组可读字段（字段名已本地化，值取本次运行的真值）。 */
export interface EntryCard {
  id: string;
  label: string;
  fields: Record<string, string>;
}

/**
 * 入口节点在进度画布上的投影。
 *
 * 为什么要单独一个 hook：入口在编排态是可编辑节点（ComposerFlowNode 读 store），
 * 在生成态该是只读的一张卡——两态共用一个组件会让人在跑的时候还能改配置，
 * 改了又不影响这一轮，比看不见更糟。
 *
 * 真值优先级：本次运行的上下文 > 编排态配置。运行一旦开始，ctx 里的
 * user_input / narrative_axes / tier_detection 才是"实际按什么跑的"；
 * 还没有 ctx 时（刚点开始）退回入口节点自己的 config，卡上不留空白。
 */
export function useEntryCard(): EntryCard | null {
  const t = useT();
  const composerNodes = useNarrativeStore((s) => s.composerNodes);
  const result = useNarrativeStore((s) => s.activeResult);
  const [axes, setAxes] = useState<NarrativeAxesCatalog>({ types: [], themes: [], structures: [] });

  const entryNode = useMemo(() => composerNodes.find((n) => isEntryNode(n)) ?? null, [composerNodes]);

  useEffect(() => {
    if (!entryNode) return;
    let alive = true;
    void loadNarrativeAxes().then((a) => { if (alive) setAxes(a); });
    return () => { alive = false; };
  }, [entryNode]);

  return useMemo(() => {
    if (!entryNode) return null;
    const ctx = (result ?? {}) as Record<string, unknown>;
    const cfg = entryNode.config as Record<string, unknown>;
    const runAxes = (ctx.narrative_axes ?? {}) as Record<string, unknown>;
    const tierDetection = (ctx.tier_detection ?? {}) as Record<string, unknown>;
    const auto = t("composer.cfg.tierAuto");

    /** 轴编码 → 显示名；词表还没到（或是长尾码）就报编码本身，不报空。 */
    const axisName = (list: NarrativeAxesCatalog["types"], code: unknown): string | null => {
      if (typeof code !== "string" || !code) return null;
      const hit = list.find((o) => o.code === code);
      return hit ? axisOptionLabel(hit) : code;
    };

    const requirement =
      (typeof ctx.user_input === "string" && ctx.user_input.trim())
      || (typeof cfg.userInput === "string" && cfg.userInput.trim())
      || Object.values((cfg.tagSelections ?? {}) as Record<string, string>).filter(Boolean).join("；")
      || t("composer.node.noInput");

    const complexity = (ctx.complexity ?? cfg.complexity) as number | undefined;
    const scaleLabel = complexity ? t(`complexity.${complexity}.label`) : null;

    const fields: Record<string, string> = {
      [t("composer.cfg.input")]: requirement,
      [t("composer.cfg.storyType")]:
        axisName(axes.types, runAxes.storyType ?? cfg.storyType) ?? auto,
      [t("composer.cfg.storyTheme")]:
        axisName(axes.themes, runAxes.storyTheme ?? cfg.storyTheme) ?? auto,
      [t("composer.cfg.scale")]:
        scaleLabel && scaleLabel !== `complexity.${complexity}.label`
          ? scaleLabel
          : (complexity ? String(complexity) : auto),
    };

    // 品类由后端识别后才定（前端只在入口显式指定时才有），有名字才报。
    const genreName = tierDetection.genre_name;
    if (typeof genreName === "string" && genreName) fields[t("composer.cfg.genre")] = genreName;

    // 标题走 catalog 的 i18n 键；node.label 是入库时的中文快照，英文界面下会露出来。
    const labelKey = findCatalogItem(entryNode.catalogId)?.labelKey;
    const localized = labelKey ? t(labelKey) : null;
    const label = localized && localized !== labelKey ? localized : entryNode.label;

    return { id: entryNode.id, label, fields };
  }, [entryNode, result, axes, t]);
}
