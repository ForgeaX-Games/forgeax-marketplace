import { useMemo } from 'react'
import { useShellStore } from '../../shell/shellStore'
import { injectStyleOnce } from '../../styles/injectStyle'
import { SynopsisPanel } from './SynopsisPanel'
import { RelationsPanel } from './RelationsPanel'
import { CharactersTextPanel } from './CharactersTextPanel'
import { OutlinePanel } from './OutlinePanel'
import { DetailScriptPanel } from './DetailScriptPanel'
import { ScriptImportPanel } from './ScriptImportPanel'
import { useForgeStudioStore } from './forgeStudioStore'
import {
  NarrativeProgressBanner,
  useNarrativeProgressBoot,
} from './NarrativeProgressBanner'

/**
 * ForgeStudio —— "剧本"tab 的左侧主区 (小说家工作板).
 *
 * 2026-05-29 重构:
 *   - 顶部 5 段 segmented 已搬至 sidebar (pane=left), 由 sidebar 调用
 *     useForgeStudioStore.setTab. ForgeStudio 仅作为内容容器.
 *   - 不再渲染顶部 nav, 节省一行高度, 也避免双控制点视觉冗余.
 *
 * 5 段同时 mount + hidden 切换的设计仍然保留 (textarea 焦点 / 滚动位置不丢).
 */
export function ForgeStudio() {
  const tab = useForgeStudioStore((s) => s.tab)
  // 「导入完整剧本」触发点已搬到左侧 sidebar 底部 (ReelSidebar)。模态本体仍渲染在
  // 这里 (内容区 / center pane), 由 shellStore.importOpen 驱动 —— sidebar 那一栏
  // (pane=left iframe) 点按钮经 crossPaneSync 把 importOpen 镜像过来即可打开。
  const importOpen = useShellStore((s) => s.importOpen)
  const setImportOpen = useShellStore((s) => s.setImportOpen)
  // 独立运行 (pane===null, 无 sidebar) 时 sidebar 不渲染 → 在内容区顶部保留触发入口，
  // 否则独立调试态彻底没了导入按钮。嵌入 (pane=left/center) 态隐藏, 由 sidebar 提供。
  const isStandalone = useMemo(() => {
    try {
      return !new URLSearchParams(window.location.search).get('pane')
    } catch {
      return true
    }
  }, [])
  useNarrativeProgressBoot()

  return (
    <div className="ks-fs">
      {isStandalone ? (
        <div className="ks-fs-topbar">
          <button
            className="ks-fs-import-btn"
            onClick={() => setImportOpen(true)}
            title="粘贴或上传你写好的完整剧本，严格按原文解析成剧情树"
          >
            导入完整剧本
          </button>
          <span className="ks-fs-import-hint ks-faint">
            已有剧本？直接粘贴 / 上传，按原文生成（长剧本自动分段读取）
          </span>
        </div>
      ) : null}
      <NarrativeProgressBanner />
      <ScriptImportPanel open={importOpen} onClose={() => setImportOpen(false)} />
      <div className="ks-fs-body">
        <div className="ks-fs-pane" hidden={tab !== 'synopsis'}>
          <SynopsisPanel />
        </div>
        <div className="ks-fs-pane" hidden={tab !== 'relations'}>
          <RelationsPanel />
        </div>
        <div className="ks-fs-pane" hidden={tab !== 'characters'}>
          <CharactersTextPanel />
        </div>
        <div className="ks-fs-pane" hidden={tab !== 'outline'}>
          <OutlinePanel />
        </div>
        <div className="ks-fs-pane" hidden={tab !== 'detail'}>
          <DetailScriptPanel />
        </div>
      </div>
    </div>
  )
}

const css = `
.ks-fs {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--color-background-base);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.ks-fs-topbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--color-border-default);
  background: var(--color-background-elevated);
}
.ks-fs-import-btn {
  flex: 0 0 auto;
  border: 1px solid color-mix(in srgb, var(--color-brand-primary) 40%, transparent);
  background: color-mix(in srgb, var(--color-brand-primary) 16%, var(--color-background-elevated));
  color: var(--color-brand-primary);
  border-radius: var(--radius-sm);
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.ks-fs-import-btn:hover {
  background: color-mix(in srgb, var(--color-brand-primary) 26%, var(--color-background-elevated));
}
.ks-fs-import-hint { font-size: 12px; line-height: 1.4; }
@media (max-width: 760px) {
  .ks-fs-import-hint { display: none; }
}
.ks-fs-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-areas: 'pane';
  overflow: hidden;
}
.ks-fs-pane {
  grid-area: pane;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.ks-fs-pane[hidden] {
  display: none;
}
`
injectStyleOnce('forge-studio', css)
