// 💡 URDF Viewer 标题栏：导出 + 渲染选项 + 关节面板开关
//    文案走 useViewerI18n()（本地静态表，无 WS 同步）。
//    单源宿主版本：移除了 legacy 的本地文件打开 / 粘贴 URDF 输入，以及跨端口/全屏
//    postMessage（这些在后续任务里改接 workbench 协议）。模型来源由 live sync 注入。
import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown, FileCode2, Grid3X3, Compass, Download,
  Repeat, Play, Pause, X, PanelRight, PanelRightClose, RotateCcw, Camera,
} from 'lucide-react'
import { useViewerStore } from '../../store/viewerStore'
import { useViewerI18n } from '../../i18n/strings'
import './Titlebar.css'

type ExportFormat = 'obj' | 'glb' | 'glb-static' | 'urdf'

interface TitlebarProps {
  onResetView: () => void
  onExport: (format: ExportFormat) => void | Promise<void>
  onScreenshot: () => void | Promise<void>
  canExportUrdf: boolean
  canExportScene: boolean
}

function Titlebar({ onResetView, onExport, onScreenshot, canExportUrdf, canExportScene }: TitlebarProps) {
  const {
    sourceLabel, render, toggleRenderOption,
    sectionHeight, setSectionHeight,
    sidePanelOpen, toggleSidePanel, clearSource,
  } = useViewerStore()
  const t = useViewerI18n()

  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  const settingsMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showExportMenu) return
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setShowExportMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showExportMenu])

  useEffect(() => {
    if (!showSettings) return
    const handler = (e: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target as Node)) setShowSettings(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSettings])

  const handleExportFormat = (format: ExportFormat) => {
    setShowExportMenu(false)
    void onExport(format)
  }

  return (
    <div className="viewer-titlebar">
      <div className="viewer-titlebar-left">
        <span className="viewer-logo-text">{t.titlebar.productName}</span>
        {sourceLabel && (
          <span className="viewer-source-badge" title={sourceLabel}>
            <FileCode2 size={11} />
            <span>{sourceLabel}</span>
            <button
              className="viewer-source-clear"
              title={t.titlebar.clearModelTooltip}
              onClick={() => { clearSource() }}
            >
              <X size={11} />
            </button>
          </span>
        )}
      </div>

      <div className="viewer-titlebar-right">
        <div className="viewer-dropdown-container" ref={exportMenuRef}>
          <button
            className={`viewer-tb-btn${showExportMenu ? ' active' : ''}`}
            title={t.titlebar.exportTooltip}
            disabled={!canExportUrdf && !canExportScene}
            onClick={(e) => { e.stopPropagation(); setShowSettings(false); setShowExportMenu((v) => !v) }}
          >
            <Download size={14} />
            <span>{t.titlebar.export}</span>
            <ChevronDown size={12} />
          </button>
          {showExportMenu && (
            <div className="viewer-dropdown">
              <div className="viewer-dropdown-header">{t.titlebar.exportHeader}</div>
              <button
                className="viewer-dropdown-item"
                disabled={!canExportScene}
                onClick={() => handleExportFormat('obj')}
              >
                <span className="viewer-dropdown-item-title">{t.titlebar.exportObj}</span>
                <span className="viewer-dropdown-item-sub">{t.titlebar.exportObjSub}</span>
              </button>
              <button
                className="viewer-dropdown-item"
                disabled={!canExportScene}
                onClick={() => handleExportFormat('glb')}
              >
                <span className="viewer-dropdown-item-title">{t.titlebar.exportGlb}</span>
                <span className="viewer-dropdown-item-sub">{t.titlebar.exportGlbSub}</span>
              </button>
              <button
                className="viewer-dropdown-item"
                disabled={!canExportScene}
                onClick={() => handleExportFormat('glb-static')}
              >
                <span className="viewer-dropdown-item-title">{t.titlebar.exportGlbStatic}</span>
                <span className="viewer-dropdown-item-sub">{t.titlebar.exportGlbStaticSub}</span>
              </button>
              <button
                className="viewer-dropdown-item"
                disabled={!canExportUrdf}
                onClick={() => handleExportFormat('urdf')}
              >
                <span className="viewer-dropdown-item-title">{t.titlebar.exportUrdf}</span>
                <span className="viewer-dropdown-item-sub">{t.titlebar.exportUrdfSub}</span>
              </button>
            </div>
          )}
        </div>

        <span className="viewer-tb-divider" />

        <button
          className={`viewer-tb-icon-btn${render.showGrid ? ' active' : ''}`}
          title={t.titlebar.toggleGrid}
          onClick={() => toggleRenderOption('showGrid')}
        >
          <Grid3X3 size={16} />
        </button>
        <button
          className={`viewer-tb-icon-btn${render.showAxis ? ' active' : ''}`}
          title={t.titlebar.toggleAxis}
          onClick={() => toggleRenderOption('showAxis')}
        >
          <Compass size={16} />
        </button>
        <button
          className={`viewer-tb-icon-btn${render.autoAnimate ? ' active' : ''}`}
          title={render.autoAnimate ? t.titlebar.stopAnimation : t.titlebar.playAnimation}
          onClick={() => toggleRenderOption('autoAnimate')}
        >
          {render.autoAnimate ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          className="viewer-tb-icon-btn"
          title={t.titlebar.screenshot}
          onClick={() => { void onScreenshot() }}
        >
          <Camera size={16} />
        </button>

        <div className="viewer-dropdown-container" ref={settingsMenuRef}>
          <button
            className={`viewer-tb-icon-btn${showSettings ? ' active' : ''}`}
            title={t.titlebar.moreOptions}
            onClick={(e) => { e.stopPropagation(); setShowExportMenu(false); setShowSettings((v) => !v) }}
          >
            <Repeat size={16} />
          </button>
          {showSettings && (
            <div className="viewer-dropdown">
              <div className="viewer-dropdown-header">{t.titlebar.viewOptions}</div>
              <label className="viewer-dropdown-check">
                <input
                  type="checkbox"
                  checked={render.showCollisions}
                  onChange={() => toggleRenderOption('showCollisions')}
                />
                <span>{t.titlebar.showCollision}</span>
              </label>
              <label className="viewer-dropdown-check">
                <input
                  type="checkbox"
                  checked={render.doubleSided}
                  onChange={() => toggleRenderOption('doubleSided')}
                />
                <span>{t.titlebar.renderBothSides}</span>
              </label>
              <label className="viewer-dropdown-check" title={t.titlebar.sectionViewHint}>
                <input
                  type="checkbox"
                  checked={render.sectionView}
                  onChange={() => toggleRenderOption('sectionView')}
                />
                <span>{t.titlebar.sectionView}</span>
              </label>
              {render.sectionView && (
                <div className="viewer-dropdown-slider">
                  <span className="viewer-dropdown-slider-label">
                    {t.titlebar.sectionHeightLabel} · {Math.round(sectionHeight * 100)}%
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={sectionHeight}
                    onChange={(e) => setSectionHeight(Number(e.target.value))}
                  />
                </div>
              )}
              <div className="viewer-dropdown-divider" />
              <button className="viewer-dropdown-item" onClick={() => { onResetView(); setShowSettings(false) }}>
                <span className="viewer-dropdown-item-title">
                  <RotateCcw size={12} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  {t.titlebar.resetCamera}
                </span>
                <span className="viewer-dropdown-item-sub">{t.titlebar.resetCameraSub}</span>
              </button>
            </div>
          )}
        </div>

        <span className="viewer-tb-divider" />

        <button
          className={`viewer-tb-icon-btn${sidePanelOpen ? ' active' : ''}`}
          title={sidePanelOpen ? t.titlebar.hideJointPanel : t.titlebar.showJointPanel}
          onClick={() => toggleSidePanel()}
        >
          {sidePanelOpen ? <PanelRightClose size={16} /> : <PanelRight size={16} />}
        </button>
      </div>
    </div>
  )
}

export default Titlebar
