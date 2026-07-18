import { useMemo } from "react";
import { X } from "lucide-react";
import { useNarrativeStore } from "../../store/narrativeStore";
import type { NarrativeContext, SceneNode } from "../../types";
import { StageFileBrowser, fileGroupsForStep } from "../shared/StageFileBrowser";
import { useT, tStepLabel, tDisplayState } from "../../i18n";

export function StepDetailPanel() {
  const t = useT();
  const focusedStepId = useNarrativeStore((s) => s.focusedStepId);
  const result = useNarrativeStore((s) => s.activeResult);
  const steps = useNarrativeStore((s) => s.activeSteps);
  const runningProgress = useNarrativeStore((s) => s.runningProgress);
  const activeEntryKey = useNarrativeStore((s) => s.activeEntryKey);
  const runningEntryKey = useNarrativeStore((s) => s.runningEntryKey);
  const ipRunKey = useNarrativeStore((s) => s.ipRunKey);
  const setFocus = useNarrativeStore((s) => s.setFocus);

  if (!focusedStepId) return null;

  const stepState = steps.find((s) => s.id === focusedStepId) ?? runningProgress.find((s) => s.id === focusedStepId);
  const stepData = stepState?.data;
  const isViewingRunning = activeEntryKey === runningEntryKey;
  const fileRunKey = (isViewingRunning ? ipRunKey : activeEntryKey) ?? activeEntryKey;
  const fileGroups = fileGroupsForStep(focusedStepId);
  const stepLabel = stepState?.label
    ? tStepLabel(focusedStepId, stepState.label)
    : tStepLabel(focusedStepId, focusedStepId);

  return (
    <div className="step-detail-panel">
      <div className="step-detail-panel-header">
        <span className="step-detail-panel-title">
          {stepLabel}
          {stepState && (
            <span className={`step-detail-status status-${stepState.status}`}>
              {tDisplayState(stepState.status)}
            </span>
          )}
        </span>
        <button type="button" className="step-detail-close fx-icon-btn" onClick={() => setFocus(null)} aria-label={t("stepDetail.close")}>
          <X size={14} aria-hidden />
        </button>
      </div>
      <div className="step-detail-panel-body">
        <StepDetailContent stepId={focusedStepId} data={stepData} result={result} status={stepState?.status} />
        {fileGroups && fileGroups.length > 0 && (
          <StageFileBrowser runKey={fileRunKey} groups={fileGroups} />
        )}
      </div>
    </div>
  );
}

function StepDetailContent({
  stepId, data, result, status,
}: {
  stepId: string;
  data: unknown;
  result: NarrativeContext | null;
  status?: string;
}) {
  const t = useT();
  const resolved = data ?? (result ? getStepData(stepId, result) : null);

  if (!resolved) {
    return (
      <div className="step-detail-empty-msg">
        {status === "running" ? t("stepDetail.generating") : status === "pending" ? t("stepDetail.waiting") : t("stepDetail.noData")}
      </div>
    );
  }

  if (stepId === "scene_generation") {
    return <SceneMiniTree data={resolved} />;
  }

  if (stepId === "script_generation") {
    return <ScriptMiniView data={resolved} />;
  }

  if (stepId === "core_concept" && resolved && typeof resolved === "object") {
    return <CoreConceptView data={resolved as Record<string, unknown>} />;
  }

  if ((stepId === "system_architecture" || stepId === "system_detail" || stepId === "value_framework" || stepId === "design_doc") && resolved && typeof resolved === "object") {
    return <DesignStepView stepId={stepId} data={resolved} />;
  }

  if (stepId === "character_enrichment" && Array.isArray(resolved)) {
    return (
      <div className="sdp-structured">
        {resolved.map((c: Record<string, unknown>, i: number) => (
          <div key={i} className="sdp-item">
            <strong>{String(c.name ?? "")}</strong> [{String(c.label ?? "")}]
            {c.role_in_story ? <span className="sdp-desc"> — {String(c.role_in_story)}</span> : null}
          </div>
        ))}
      </div>
    );
  }

  if (typeof resolved === "string") {
    return <MdBlock text={resolved} />;
  }
  return <pre className="step-detail-pre">{JSON.stringify(resolved, null, 2)}</pre>;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderMd(text: string): string {
  return escHtml(text)
    .replace(/^#### (.+)$/gm, '<h4 class="md-h4">$1</h4>')
    .replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="md-bold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="md-italic">$1</em>')
    .replace(/^---$/gm, '<hr class="md-hr">')
    .replace(/^[-•]\s+(.+)$/gm, '<div class="md-li">• $1</div>')
    .replace(/\n\n/g, '</p><p class="md-p">')
    .replace(/\n/g, "<br>");
}

function MdBlock({ text }: { text: string }) {
  const html = useMemo(() => renderMd(text), [text]);
  return <div className="md-rendered" dangerouslySetInnerHTML={{ __html: html }} />;
}

function SceneMiniTree({ data }: { data: unknown }) {
  const t = useT();
  const scenes: SceneNode[] = (() => {
    if (!data || typeof data !== "object") return [];
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.scenes)) return d.scenes as SceneNode[];
    return [];
  })();

  if (!scenes.length) {
    return <pre className="step-detail-pre">{JSON.stringify(data, null, 2)}</pre>;
  }

  const LEVEL_LABELS = ["L0", "L1", "L2", "L3", "L4", "L5"];
  const byParent = new Map<string, SceneNode[]>();
  for (const s of scenes) {
    const key = s.parent || "";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(s);
  }

  function renderBranch(parentName: string, depth: number): React.ReactNode {
    const children = byParent.get(parentName);
    if (!children?.length) return null;
    return (
      <>
        {children.map((s) => {
          const lvl = s.scene_level ?? s.level ?? 0;
          return (
            <div key={s.uid || s.name} style={{ paddingLeft: depth * 12 }} className="sdp-scene-row">
              <span className="sdp-level">{LEVEL_LABELS[lvl] ?? `L${lvl}`}</span>
              <span className="sdp-scene-name">{s.name}</span>
              {renderBranch(s.name, depth + 1)}
            </div>
          );
        })}
      </>
    );
  }

  const worldName = (data as Record<string, unknown>).world_name;
  return (
    <div className="sdp-structured sdp-scene-tree">
      {worldName ? <div className="sdp-scene-world">{String(worldName)} · {t("stepDetail.scenes", { n: scenes.length })}</div> : null}
      {renderBranch("", 0)}
    </div>
  );
}

function ScriptMiniView({ data }: { data: unknown }) {
  const t = useT();
  if (!data || typeof data !== "object") {
    return <pre className="step-detail-pre">{JSON.stringify(data, null, 2)}</pre>;
  }
  const d = data as Record<string, unknown>;
  const chapters = d.chapters as Array<Record<string, unknown>> | undefined;
  if (!chapters?.length) {
    return <pre className="step-detail-pre">{JSON.stringify(data, null, 2)}</pre>;
  }

  const TYPE_LABELS: Record<string, string> = {
    opening: t("textView.chapterType.opening"),
    rising: t("textView.chapterType.rising"),
    climax: t("textView.chapterType.climax"),
    falling: t("textView.chapterType.falling"),
    resolution: t("textView.chapterType.resolution"),
  };

  return (
    <div className="sdp-structured">
      {d.title ? <div className="sdp-scene-world">{String(d.title)} · {t("stepDetail.chapters", { n: chapters.length })}</div> : null}
      {chapters.map((ch, i) => {
        const ct = String(ch.chapter_type ?? "");
        const scenes = Array.isArray(ch.scenes) ? ch.scenes : [];
        const conflict = ch.conflict as Record<string, unknown> | undefined;
        return (
          <div key={i} className="sdp-item">
            <span className="sdp-level">{TYPE_LABELS[ct] ?? ct}</span>
            <strong>{String(ch.title ?? t("stepDetail.chapterN", { n: i + 1 }))}</strong>
            <span className="sdp-desc">
              {t("stepDetail.scenes", { n: scenes.length })}{conflict ? ` · ${t("textView.tension")} ${conflict.tension_level}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CoreConceptView({ data }: { data: Record<string, unknown> }) {
  const t = useT();
  const highConcept = data.high_concept as string | undefined;
  const pillars = data.narrative_pillars as string[] | undefined;
  const loops = data.three_loops as Record<string, unknown> | undefined;

  return (
    <div className="sdp-structured">
      {highConcept && <div className="sdp-scene-world">{highConcept}</div>}
      {pillars?.length ? (
        <div className="sdp-item">
          <strong>{t("stepDetail.narrativePillars")}</strong>
          {pillars.map((p, i) => <div key={i} className="sdp-desc">• {p}</div>)}
        </div>
      ) : null}
      {loops ? (
        <>
          {(["system_loop", "gameplay_loop", "resource_loop"] as const).map((key) => {
            const loop = loops[key] as Record<string, unknown> | undefined;
            if (!loop) return null;
            const loopLabel =
              key === "system_loop" ? t("stepDetail.loop.system")
              : key === "gameplay_loop" ? t("stepDetail.loop.gameplay")
              : t("stepDetail.loop.resource");
            return (
              <div key={key} className="sdp-item">
                <span className="sdp-level">{loopLabel}</span>
                <strong>{String(loop.summary ?? loop.description ?? key)}</strong>
                {Array.isArray(loop.stages) && (
                  <span className="sdp-desc">{(loop.stages as Array<Record<string, unknown>>).map((s) => s.name).join(" → ")}</span>
                )}
                {Array.isArray(loop.nodes) && (
                  <span className="sdp-desc">{(loop.nodes as Array<Record<string, unknown>>).map((n) => n.name).join(" → ")}</span>
                )}
              </div>
            );
          })}
        </>
      ) : null}
      <pre className="step-detail-pre" style={{ marginTop: 8 }}>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}

function DesignStepView({ stepId, data }: { stepId: string; data: unknown }) {
  const t = useT();
  const title = t(`stepDetail.design.${stepId}`);
  const d = data as Record<string, unknown>;

  const summary = d.summary ?? d.description ?? d.high_concept;
  return (
    <div className="sdp-structured">
      <div className="sdp-scene-world">{title}</div>
      {typeof summary === "string" && <div className="sdp-desc" style={{ marginBottom: 8 }}>{summary}</div>}
      <pre className="step-detail-pre">{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}

function getStepData(stepId: string, ctx: NarrativeContext): unknown {
  const map: Record<string, unknown> = {
    preference_summary: ctx.user_preference_summary,
    preference_analysis: ctx.user_preference_analysis,
    initial_outline: ctx.initial_story_outline,
    core_settings: ctx.core_settings,
    worldview: ctx.worldview_structure,
    plot_synopsis: ctx.plot_synopsis,
    story_framework: ctx.story_framework,
    outline_batch: ctx.outlines_generated,
    detailed_outline: ctx.detailed_outlines_generated,
    character_enrichment: ctx.detailed_character_sheets,
    item_database: ctx.item_database,
    plot_generation: ctx.plots_generated,
    structure_validation_l3: (ctx as Record<string, unknown>).l3_validation,
    script_generation: ctx.jrpg_script,
    quest_generation: ctx.quest_graph,
    scene_generation: ctx.scene_map,
    narrative_card: ctx.narrative_card,
    lore_generation: ctx.lore_fragments,
    tier_router: ctx.tier_detection,
    core_concept: (ctx as Record<string, unknown>).core_concept,
    system_architecture: (ctx as Record<string, unknown>).system_architecture,
    system_detail: (ctx as Record<string, unknown>).system_details,
    value_framework: (ctx as Record<string, unknown>).value_framework,
    design_doc: (ctx as Record<string, unknown>).game_design_context,
  };
  return map[stepId] ?? null;
}
