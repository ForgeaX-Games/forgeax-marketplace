import { useMemo } from "react";
import { useNarrativeStore } from "../../store/narrativeStore";
import { TEMPLATE_LABELS } from "../../pipeline-templates";
import type { TierId } from "../../types";
import { useT } from "../../i18n";

const TIERS: TierId[] = ["tier1", "tier2", "tier3", "tier4"];

interface Props {
  selectedId: string | null;
}

/**
 * 编排节点配置面板。输入节点↔INPUT、路由节点↔ROUTING(路由组/层级/品类/复杂度)，
 * 专家/助手/工程师展示其预制管线/策略/环节并允许覆盖节点级配置。
 */
export function ComposerNodeConfigPanel({ selectedId }: Props) {
  const t = useT();
  const composerNodes = useNarrativeStore((s) => s.composerNodes);
  const setComposerNodeConfig = useNarrativeStore((s) => s.setComposerNodeConfig);

  const node = useMemo(
    () => composerNodes.find((n) => n.id === selectedId) ?? null,
    [composerNodes, selectedId],
  );

  if (!node) {
    return (
      <div className="composer-config composer-config--empty">
        <span>{t("composer.cfg.none")}</span>
      </div>
    );
  }

  const cfg = node.config;
  const set = (patch: Record<string, unknown>) => setComposerNodeConfig(node.id, patch);

  return (
    <div className="composer-config">
      <header className="composer-config__head">
        <span className="composer-config__icon">{node.icon}</span>
        <span className="composer-config__title">{node.label}</span>
      </header>

      {node.category === "input" && (
        <label className="composer-config__field">
          <span className="composer-config__label">{t("composer.cfg.input")}</span>
          <textarea
            className="composer-config__textarea"
            rows={5}
            placeholder={t("composer.cfg.inputPlaceholder")}
            value={(cfg.userInput as string) ?? ""}
            onChange={(e) => set({ userInput: e.target.value })}
          />
        </label>
      )}

      {node.category === "routing" && (
        <>
          <label className="composer-config__field">
            <span className="composer-config__label">{t("composer.cfg.routeGroup")}</span>
            <select
              className="composer-config__select"
              value={(cfg.routeGroup as string) ?? "planning"}
              onChange={(e) => set({ routeGroup: e.target.value })}
            >
              <option value="planning">{t("composer.cfg.routeGroup.planning")}</option>
              <option value="narrative">{t("composer.cfg.routeGroup.narrative")}</option>
            </select>
          </label>
          <label className="composer-config__field">
            <span className="composer-config__label">{t("composer.cfg.tier")}</span>
            <select
              className="composer-config__select"
              value={(cfg.tier as string) ?? ""}
              onChange={(e) => set({ tier: e.target.value || null })}
            >
              <option value="">{t("composer.cfg.tierAuto")}</option>
              {TIERS.map((tr) => (
                <option key={tr} value={tr}>{tr.toUpperCase()}</option>
              ))}
            </select>
          </label>
          <label className="composer-config__field">
            <span className="composer-config__label">{t("composer.cfg.genre")}</span>
            <input
              className="composer-config__input"
              type="text"
              placeholder={t("composer.cfg.genrePlaceholder")}
              value={(cfg.genreCode as string) ?? ""}
              onChange={(e) => set({ genreCode: e.target.value || null })}
            />
          </label>
          <label className="composer-config__field">
            <span className="composer-config__label">{t("composer.cfg.complexity")}</span>
            <input
              className="composer-config__input"
              type="number"
              min={1}
              max={10}
              value={(cfg.complexity as number) ?? ""}
              onChange={(e) => set({ complexity: e.target.value ? Number(e.target.value) : undefined })}
            />
          </label>
        </>
      )}

      {node.category === "expert" && node.pipelineTemplate && (
        <div className="composer-config__field">
          <span className="composer-config__label">{t("composer.cfg.pipeline")}</span>
          <span className="composer-config__readonly">
            {TEMPLATE_LABELS[node.pipelineTemplate] ?? node.pipelineTemplate}
            {node.tier ? ` · ${node.tier.toUpperCase()}` : ""}
          </span>
        </div>
      )}

      {node.category === "assistant" && (
        <div className="composer-config__field">
          <span className="composer-config__label">{t("composer.cfg.strategy")}</span>
          <span className="composer-config__readonly">{node.modeId ?? "—"}</span>
        </div>
      )}

      {node.category === "engineer" && (
        <div className="composer-config__field">
          <span className="composer-config__label">{t("composer.cfg.step")}</span>
          <span className="composer-config__readonly">{node.stepId ?? "—"}</span>
        </div>
      )}
    </div>
  );
}
