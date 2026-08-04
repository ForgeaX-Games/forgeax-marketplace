import { useCallback, useEffect, useMemo, useState } from "react";
import { AtSign, FileText, FolderOpen, Package, Star } from "lucide-react";
import {
  fetchRunFiles,
  loadHistoryResult,
  saveEntry,
} from "../../hooks/useNarrativeStream";
import {
  buildLibraryContents,
  type LibraryContents,
  type LibraryFile,
} from "../../lib/contentTypes";
import { findCatalogItem } from "../../composer/composerCatalog";
import { sendFileToComposer, sendRoleToComposer } from "../../lib/bridge";
import { useT } from "../../i18n";

/**
 * 项目内部的两库（PRD v1.4 §5.1 / 设计稿 08）。
 *
 * - 资源管理：这一跑的全部原料与产物，按内容类型分区。
 * - 资产管理：作者点过星标的那些，按同一套类型分区——收藏即入库，取消即出库。
 *
 * 分区与「叙事单品助手」同名同序，分区标题上的 @ 送的是那位助手，文件卡上的 @ 送的是那份产物，
 * 两者都落到宿主对话框里，方便平台 agent 按对象各自开工。
 */
export function ProjectLibraries({ entryKey }: { entryKey: string }) {
  const t = useT();
  const [paths, setPaths] = useState<string[]>([]);
  const [assets, setAssets] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchRunFiles(entryKey).catch(() => []),
      loadHistoryResult(entryKey).catch(() => null),
    ])
      .then(([fileGroups, loaded]) => {
        if (cancelled) return;
        setPaths(fileGroups.flatMap((g) => g.files.map((f) => `${g.group}/${f}`)));
        setAssets(loaded?.entry?.assets ?? []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [entryKey]);

  const toggleAsset = useCallback(
    (groupedPath: string) => {
      setAssets((prev) => {
        const next = prev.includes(groupedPath)
          ? prev.filter((p) => p !== groupedPath)
          : [...prev, groupedPath];
        void saveEntry(entryKey, { assets: next });
        return next;
      });
    },
    [entryKey],
  );

  const resources = useMemo(() => buildLibraryContents(paths), [paths]);
  // 资产库 = 已收藏的那部分资源，走同一套类别表，所以两库的子条目一一对应。
  const assetsView = useMemo(
    () => buildLibraryContents(paths.filter((p) => assets.includes(p))),
    [paths, assets],
  );

  const mentionAssistant = useCallback((assistantId: string) => {
    const item = findCatalogItem(assistantId);
    if (!item) return;
    const label = t(item.labelKey) === item.labelKey ? item.label : t(item.labelKey);
    sendRoleToComposer({
      name: label,
      category: item.category,
      catalogId: item.id,
      stepId: item.stepId,
      modeId: item.modeId,
    });
  }, [t]);

  const renderCards = (files: LibraryFile[]) => (
    <div className="pi-cards">
      {files.map((f) => {
        const picked = assets.includes(f.path);
        return (
          <div key={f.path} className={`pi-card${picked ? " is-picked" : ""}`} title={f.path}>
            <button
              type="button"
              className="pi-at"
              title={t("lib.mentionFile")}
              aria-label={t("lib.mentionFile")}
              onClick={() =>
                sendFileToComposer({
                  entryKey,
                  path: f.path,
                  name: f.name,
                  contentType: f.type ?? undefined,
                })
              }
            >
              <AtSign size={10} aria-hidden />
            </button>
            <FileText size={13} className="pi-card__icon" aria-hidden />
            <span className="pi-card__name">{f.name}</span>
            <button
              type="button"
              className={`pi-star${picked ? " picked" : ""}`}
              title={picked ? t("tms.project.unpick") : t("tms.project.pick")}
              aria-label={picked ? t("tms.project.unpick") : t("tms.project.pick")}
              onClick={() => toggleAsset(f.path)}
            >
              <Star size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );

  const renderSection = (
    key: string,
    Icon: typeof FolderOpen,
    titleKey: string,
    hintKey: string,
    emptyKey: string,
    { buckets, loose }: LibraryContents,
  ) => {
    const total = loose.length + buckets.reduce((n, b) => n + b.files.length, 0);
    return (
      <section className="pi-section" key={key}>
        <header className="pi-section__head">
          <Icon size={13} aria-hidden />
          <span className="pi-section__title">{t(titleKey)}</span>
          <em className="pi-count">{total}</em>
        </header>
        <p className="pi-hint">{t(hintKey)}</p>

        {/* 无类别产物（老管线的落盘）直挂库下：对它们而言只有两级。 */}
        {loose.length > 0 && renderCards(loose)}

        {total === 0 && <div className="pi-empty">{t(emptyKey)}</div>}

        {/* 类别条目照单品助手花名册固定排布，这一跑没产的也在，只是空着。 */}
        {buckets.map(({ def, files }) => (
          <div key={def.id} className={`pi-bucket${files.length === 0 ? " is-empty" : ""}`}>
            <div className="pi-bucket__title">
              {def.assistantId && (
                <button
                  type="button"
                  className="pi-at"
                  title={t("lib.mentionAssistant")}
                  aria-label={t("lib.mentionAssistant")}
                  onClick={() => mentionAssistant(def.assistantId!)}
                >
                  <AtSign size={10} aria-hidden />
                </button>
              )}
              <span>{t(def.labelKey)}</span>
              <em className="pi-bucket__count">{files.length}</em>
            </div>
            {files.length > 0 && renderCards(files)}
          </div>
        ))}
      </section>
    );
  };

  if (loading) return <div className="history-loading">{t("tms.history.loading")}</div>;

  return (
    <div className="project-inside">
      {renderSection(
        "resource", FolderOpen,
        "tms.project.resourceLib", "tms.project.resourceHint", "tms.project.resourceEmpty",
        resources,
      )}
      {renderSection(
        "asset", Package,
        "tms.project.assetLib", "tms.project.assetHint", "tms.project.assetEmpty",
        assetsView,
      )}
    </div>
  );
}
