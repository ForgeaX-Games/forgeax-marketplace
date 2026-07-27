import { useCallback, useState } from "react";
import { AtSign } from "lucide-react";
import { useT } from "../../i18n";
import {
  COMPOSER_CATALOG,
  COMPOSER_DND_MIME,
  type ComposerCatalogItem,
  type ComposerNodeCategory,
} from "../../composer/composerCatalog";
import { sendRoleToComposer } from "../../lib/bridge";

/**
 * 底部角色调色板（无限画布编排）。五大类横排，点击某类向上展开其角色列表。
 * 列表项 HTML5 draggable → 拖入画布成节点；每项附 "@" 按钮 → 拖入/发送到右侧平台对话。
 */
export function ComposerPalette() {
  const t = useT();
  const [openCat, setOpenCat] = useState<ComposerNodeCategory | null>(null);

  const onDragStart = useCallback(
    (e: React.DragEvent, item: ComposerCatalogItem) => {
      const payload = JSON.stringify({ catalogId: item.id });
      e.dataTransfer.setData(COMPOSER_DND_MIME, payload);
      // 通用 text/plain 兜底（部分浏览器要求至少设一个标准类型才允许拖拽）。
      e.dataTransfer.setData("text/plain", item.label);
      e.dataTransfer.effectAllowed = "copy";
    },
    [],
  );

  const sendToChat = useCallback((item: ComposerCatalogItem) => {
    sendRoleToComposer({
      name: t(item.labelKey) === item.labelKey ? item.label : t(item.labelKey),
      category: item.category,
      catalogId: item.id,
      pipelineTemplate: item.pipelineTemplate,
      tier: item.tier ?? null,
      routeGroup: item.routeGroup,
      stepId: item.stepId,
      modeId: item.modeId,
    });
  }, [t]);

  return (
    <div className="composer-palette" aria-label={t("composer.paletteAria")}>
      {openCat && (
        <div className="composer-palette__flyout" role="listbox">
          {COMPOSER_CATALOG.find((c) => c.category === openCat)?.items.map((item) => {
            const label = t(item.labelKey) === item.labelKey ? item.label : t(item.labelKey);
            return (
              <div
                key={item.id}
                className="composer-palette__item"
                draggable
                role="option"
                aria-selected={false}
                onDragStart={(e) => onDragStart(e, item)}
                title={label}
              >
                <span className="composer-palette__item-icon">{item.icon}</span>
                <span className="composer-palette__item-label">{label}</span>
                <button
                  type="button"
                  className="composer-palette__at"
                  title={t("composer.toChat")}
                  aria-label={t("composer.toChat")}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    sendToChat(item);
                  }}
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    onDragStart(e, item);
                  }}
                  onDragEnd={() => sendToChat(item)}
                >
                  <AtSign size={12} aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="composer-palette__bar" role="tablist">
        {COMPOSER_CATALOG.map((cat) => {
          const label = t(cat.labelKey) === cat.labelKey ? cat.label : t(cat.labelKey);
          const isOpen = openCat === cat.category;
          return (
            <button
              key={cat.category}
              type="button"
              role="tab"
              aria-selected={isOpen}
              className={`composer-palette__cat ${isOpen ? "is-open" : ""}`}
              onClick={() => setOpenCat(isOpen ? null : cat.category)}
            >
              <span className="composer-palette__cat-icon">{cat.icon}</span>
              <span className="composer-palette__cat-label">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
