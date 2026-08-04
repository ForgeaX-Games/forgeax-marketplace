import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlignLeft, AtSign, FileUp, Network, PenLine, Tags } from "lucide-react";
import {
  fetchGenres,
  fetchNarrativeAxes,
  type GenreCategoryGroup,
  type NarrativeAxesCatalog,
} from "../../hooks/useNarrativeStream";
import { useNarrativeStore, type InputTab, type NavTab } from "../../store/narrativeStore";
import { NARRATIVE_ROUTES } from "../../lib/routingCatalog";
import {
  COMPOSER_DND_MIME,
  findCatalogItem,
  genreExpertItem,
  narrativeRouteItem,
  type ComposerCatalogItem,
} from "../../composer/composerCatalog";
import { sendRoleToComposer } from "../../lib/bridge";
import type { ModeId, TierId } from "../../types";
import { useT, getLocale } from "../../i18n";

const INPUT_ENTRIES: { id: InputTab; Icon: typeof PenLine; key: string; catalogId: string }[] = [
  { id: "text", Icon: PenLine, key: "tms.inputTab.text", catalogId: "input.text" },
  { id: "tags", Icon: Tags, key: "tms.inputTab.tags", catalogId: "input.tags" },
  { id: "file", Icon: FileUp, key: "tms.inputTab.file", catalogId: "input.file" },
];

/** 把一个角色项塞进 dataTransfer——与画布 onDrop 读的是同一个 MIME。 */
function startRoleDrag(e: React.DragEvent, item: ComposerCatalogItem, label: string): void {
  e.dataTransfer.setData(COMPOSER_DND_MIME, JSON.stringify({ catalogId: item.id, item }));
  e.dataTransfer.setData("text/plain", label);
  e.dataTransfer.effectAllowed = "copy";
}

/** 叙事体量五档（PRD v1.4 §3.2.2 第三轴）。档位值即后端 complexity。 */
const SCALE_LEVELS = [1, 2, 3, 4, 5] as const;

type RoutingAxis = "type" | "theme" | "scale";
type ToolBranch = "expert" | "unit";

/**
 * 创作空间顶栏（PRD v1.4 §5.2 / 设计稿 02、06、07）。
 *
 * 四个等宽矩形 tab 居中排布，点开浮出竖排级联菜单：路由两列、工具三列，输入与视图一列即末级。
 * 面板绝对定位盖在主体上方，不撑开顶栏高度——设计稿里主体始终顶格。
 *
 * 四段都不是自己的私有状态，而是 store 里那份唯一配置的四个入口，所以浮层编辑区、
 * 左栏项目态与这里永远显示同一件事。词表全部来自后端（/genres 的游戏类型分组、/axes 的类型与题材）。
 *
 * 这里也接下了原画布底部调色板的两件事（三期起底部条取消，入口统一上移顶栏）：
 * 末级条目可拖进画布成节点，条目前的 @ 把这个角色送进宿主平台对话框。
 */
export function CenterTopNav() {
  const t = useT();
  const openTab = useNarrativeStore((s) => s.openNavTab);
  const setOpenTab = useNarrativeStore((s) => s.setOpenNavTab);
  const inputTab = useNarrativeStore((s) => s.inputTab);
  const setInputTab = useNarrativeStore((s) => s.setInputTab);
  const inputEditorOpen = useNarrativeStore((s) => s.inputEditorOpen);
  const setInputEditorOpen = useNarrativeStore((s) => s.setInputEditorOpen);
  const viewMode = useNarrativeStore((s) => s.viewMode);
  const setViewMode = useNarrativeStore((s) => s.setViewMode);
  const routing = useNarrativeStore((s) => s.routing);
  const setRouting = useNarrativeStore((s) => s.setRouting);
  const setRoutingConfigured = useNarrativeStore((s) => s.setRoutingConfigured);
  const notifyConfigChange = useNarrativeStore((s) => s.notifyConfigChange);

  const [axes, setAxes] = useState<NarrativeAxesCatalog | null>(null);
  const [genres, setGenres] = useState<GenreCategoryGroup[]>([]);
  const [openAxis, setOpenAxis] = useState<RoutingAxis>("type");
  const [toolBranch, setToolBranch] = useState<ToolBranch>("expert");
  const [openGenreCat, setOpenGenreCat] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 词表按需拉取：没展开对应 tab 就不请求。
  useEffect(() => {
    if (openTab !== "routing" || axes) return;
    let alive = true;
    fetchNarrativeAxes().then((a) => alive && setAxes(a)).catch(() => {});
    return () => { alive = false; };
  }, [openTab, axes]);

  useEffect(() => {
    if (openTab !== "tools" || genres.length > 0) return;
    let alive = true;
    fetchGenres(getLocale()).then((g) => alive && setGenres(g)).catch(() => {});
    return () => { alive = false; };
  }, [openTab, genres.length]);

  // 点面板外收起：菜单浮在主体上方，不收起会挡住正文。
  useEffect(() => {
    if (!openTab) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenTab(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openTab, setOpenTab]);

  /** 路由/工具的任一次选择都要落这三件事，否则 phase 到不了 routed，「开始生成」不会亮。 */
  const commitRouting = useCallback(
    (patch: Parameters<typeof setRouting>[0]) => {
      setRouting(patch);
      setRoutingConfigured(true);
      notifyConfigChange("routing");
    },
    [setRouting, setRoutingConfigured, notifyConfigChange],
  );

  const genreName = useMemo(() => {
    if (!routing.genreCode) return null;
    for (const group of genres) {
      const hit = group.genres.find((g) => g.code === routing.genreCode);
      if (hit) return hit.name;
    }
    return routing.genreCode;
  }, [genres, routing.genreCode]);

  const axisName = (list: { code: string; name: string }[] | undefined, code: string | null) =>
    code ? (list?.find((x) => x.code === code)?.name ?? code) : null;

  const toolsSummary =
    routing.routeGroup === "narrative"
      ? t(`route.${routing.narrativeRoute}.label`)
      : genreName ?? t("nav.none");

  const summaries: Record<NavTab, string> = {
    input: t(`tms.inputTab.${inputTab}`),
    routing:
      [
        axisName(axes?.types, routing.storyType),
        axisName(axes?.themes, routing.storyTheme),
        t("nav.scale.level", { n: routing.complexity }),
      ].filter(Boolean).join(" · ") || t("nav.none"),
    tools: toolsSummary,
    view: viewMode === "text" ? t("app.view.text") : t("app.view.graph"),
  };

  const TABS: { id: NavTab; label: string }[] = [
    { id: "input", label: t("nav.tab.input") },
    { id: "routing", label: t("nav.tab.routing") },
    { id: "tools", label: t("nav.tab.tools") },
    { id: "view", label: t("nav.tab.view") },
  ];

  const mention = useCallback((item: ComposerCatalogItem, label: string) => {
    sendRoleToComposer({
      name: label,
      category: item.category,
      catalogId: item.id,
      pipelineTemplate: item.pipelineTemplate,
      tier: item.tier ?? null,
      routeGroup: item.routeGroup,
      stepId: item.stepId,
      modeId: item.modeId,
    });
  }, []);

  /**
   * 末级角色行：@ 送进对话框，行本身可拖进画布，点一下则落成当前配置。
   * 三件事都挂在同一行上，因为对用户而言它们是同一个东西的三种用法。
   */
  const renderRoleLeaf = (opts: {
    key: string;
    label: string;
    title?: string;
    active: boolean;
    item: ComposerCatalogItem;
    onPick: () => void;
  }) => (
    <div
      key={opts.key}
      className={`cw-menu__leaf${opts.active ? " is-active" : ""}`}
      draggable
      onDragStart={(e) => startRoleDrag(e, opts.item, opts.label)}
      title={opts.title}
    >
      <button
        type="button"
        className="cw-menu__at"
        title={t("lib.mentionAssistant")}
        aria-label={t("lib.mentionAssistant")}
        onClick={(e) => { e.stopPropagation(); mention(opts.item, opts.label); }}
      >
        <AtSign size={10} aria-hidden />
      </button>
      <button type="button" className="cw-menu__item cw-menu__item--leaf" onClick={opts.onPick}>
        {opts.label}
      </button>
    </div>
  );

  const axisEntries = axes
    ? openAxis === "type"
      ? axes.types
      : openAxis === "theme"
        ? axes.themes
        : []
    : [];

  return (
    <div className="cw-topnav" ref={rootRef}>
      <div className="cw-topnav__bar" role="tablist" aria-label={t("nav.aria")}>
        {TABS.map((tab) => {
          const open = openTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={open}
              aria-expanded={open}
              className={`cw-topnav__tab${open ? " is-open" : ""}`}
              title={summaries[tab.id]}
              onClick={() => setOpenTab(open ? null : tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {openTab && (
        <div className="cw-topnav__panel" role="region" aria-label={t("nav.aria")}>
          {openTab === "input" && (
            <div className="cw-menu">
              {INPUT_ENTRIES.map(({ id, Icon, key, catalogId }) => {
                const item = findCatalogItem(catalogId);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`cw-menu__item${inputTab === id && inputEditorOpen ? " is-active" : ""}`}
                    // 选入口 = 把编辑卡浮到创作空间中央（设计稿 03/04），正文仍读同一份 store 草稿。
                    onClick={() => { setInputTab(id); setInputEditorOpen(true); setOpenTab(null); }}
                    // 拖进画布则是另一件事：多需求编排时，一个输入节点锚一条管线。
                    draggable={!!item}
                    onDragStart={(e) => item && startRoleDrag(e, item, t(key))}
                  >
                    <Icon size={13} aria-hidden />
                    <span>{t(key)}</span>
                  </button>
                );
              })}
            </div>
          )}

          {openTab === "routing" && (
            <>
              <div className="cw-menu">
                {([
                  ["type", t("nav.axis.type"), axisName(axes?.types, routing.storyType)],
                  ["theme", t("nav.axis.theme"), axisName(axes?.themes, routing.storyTheme)],
                  ["scale", t("nav.axis.scale"), t("nav.scale.level", { n: routing.complexity })],
                ] as const).map(([id, label, picked]) => (
                  <button
                    key={id}
                    type="button"
                    className={`cw-menu__item${openAxis === id ? " is-open" : ""}`}
                    onClick={() => setOpenAxis(id)}
                  >
                    <span>{label}</span>
                    <em className="cw-menu__picked">{picked ?? t("nav.none")}</em>
                  </button>
                ))}
              </div>
              <div className="cw-menu cw-menu--leaf">
                {openAxis === "scale"
                  ? SCALE_LEVELS.map((lv) => (
                      <button
                        key={lv}
                        type="button"
                        className={`cw-menu__item${routing.complexity === lv ? " is-active" : ""}`}
                        onClick={() => commitRouting({ complexity: lv, complexityTouched: true })}
                      >
                        {t("nav.scale.level", { n: lv })}
                      </button>
                    ))
                  : axisEntries.map((opt) => {
                      const active =
                        openAxis === "type" ? routing.storyType === opt.code : routing.storyTheme === opt.code;
                      return (
                        <button
                          key={opt.code}
                          type="button"
                          title={opt.summary}
                          className={`cw-menu__item${active ? " is-active" : ""}`}
                          onClick={() =>
                            commitRouting(
                              openAxis === "type"
                                ? { storyType: active ? null : opt.code }
                                : { storyTheme: active ? null : opt.code },
                            )
                          }
                        >
                          {opt.name}
                        </button>
                      );
                    })}
              </div>
            </>
          )}

          {openTab === "tools" && (
            <>
              <div className="cw-menu">
                <button
                  type="button"
                  className={`cw-menu__item${toolBranch === "expert" ? " is-open" : ""}`}
                  onClick={() => setToolBranch("expert")}
                >
                  <span>{t("nav.tools.experts")}</span>
                  <em className="cw-menu__picked">{genreName ?? t("nav.none")}</em>
                </button>
                <button
                  type="button"
                  className={`cw-menu__item${toolBranch === "unit" ? " is-open" : ""}`}
                  onClick={() => setToolBranch("unit")}
                >
                  <span>{t("nav.tools.units")}</span>
                  <em className="cw-menu__picked">
                    {routing.routeGroup === "narrative" ? t(`route.${routing.narrativeRoute}.label`) : t("nav.none")}
                  </em>
                </button>
              </div>

              {toolBranch === "expert" ? (
                <>
                  <div className="cw-menu">
                    {genres.map((group) => (
                      <button
                        key={group.category}
                        type="button"
                        className={`cw-menu__item${openGenreCat === group.category ? " is-open" : ""}`}
                        onClick={() => setOpenGenreCat(group.category)}
                      >
                        {group.label}
                      </button>
                    ))}
                  </div>
                  {openGenreCat && (
                    <div className="cw-menu cw-menu--leaf">
                      {(genres.find((g) => g.category === openGenreCat)?.genres ?? []).map((g) => {
                        const active = routing.genreCode === g.code;
                        return renderRoleLeaf({
                          key: g.code,
                          label: g.name,
                          title: g.keywords?.join(" / "),
                          active,
                          item: genreExpertItem(g),
                          onPick: () =>
                            // 选定专家即选定品类；层级不再由用户挑，跟着品类走（PRD v1.4 §3.2.2）。
                            commitRouting(
                              active
                                ? { genreCode: null }
                                : {
                                    routeGroup: "planning",
                                    genreCode: g.code,
                                    tierChoice: g.tier as TierId,
                                  },
                            ),
                        });
                      })}
                    </div>
                  )}
                </>
              ) : (
                <div className="cw-menu cw-menu--leaf">
                  {NARRATIVE_ROUTES.map((r) => {
                    const active = routing.routeGroup === "narrative" && routing.narrativeRoute === r.id;
                    const label = t(`route.${r.id}.label`);
                    return renderRoleLeaf({
                      key: r.id,
                      label,
                      title: t(`route.${r.id}.hint`),
                      active,
                      item: narrativeRouteItem(r.id, label),
                      onPick: () =>
                        commitRouting({ routeGroup: "narrative", narrativeRoute: r.id as ModeId }),
                    });
                  })}
                </div>
              )}
            </>
          )}

          {openTab === "view" && (
            <div className="cw-menu">
              <button
                type="button"
                className={`cw-menu__item${viewMode === "text" ? " is-active" : ""}`}
                onClick={() => { setViewMode("text"); setOpenTab(null); }}
              >
                <AlignLeft size={13} aria-hidden />
                <span>{t("app.view.text")}</span>
              </button>
              <button
                type="button"
                className={`cw-menu__item${viewMode === "graph" ? " is-active" : ""}`}
                onClick={() => { setViewMode("graph"); setOpenTab(null); }}
              >
                <Network size={13} aria-hidden />
                <span>{t("app.view.graph")}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
