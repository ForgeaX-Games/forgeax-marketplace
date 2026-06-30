// 💡 URDF Viewer 全局状态：URDF 源文本 / 渲染开关 / 面板开关 / 状态消息 / 语言模式
import { create } from 'zustand'

export type LangMode = 'zh' | 'en'

/**
 * 跨端口 localStorage 不共享（9555 ≠ 9558），独立窗口直接打开 9558 时需要本地兜底默认值。
 * editor 切语言时会通过 WS editor:lang_mode 事件同步过来；viewer 还会把最新值写回
 * 自己的 localStorage，下次刷新 9558 时使用上次的语言而不是回退到 zh。
 */
function loadLangMode(): LangMode {
  try {
    const v = localStorage.getItem('langMode')
    return v === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

export interface RenderOptions {
  showGrid: boolean
  showAxis: boolean
  showCollisions: boolean
  autoAnimate: boolean
  doubleSided: boolean
  /** 建筑剖切：用一个水平裁剪面切掉顶部，俯视看进房间 / 各楼层（专为中空建筑设计）。 */
  sectionView: boolean
}

export interface ViewerStoreState {
  /** URDF XML 文本（空字符串表示尚未加载）。 */
  source: string
  /** 用于解析 URDF 中 mesh filename 的 base URL（相对路径起点）；空字符串则不加载 mesh 资源。 */
  baseUrl: string
  /** 可选：用于 mesh 资源 cache busting 的版本号（如时间戳）。 */
  assetRevisionKey: string | null
  /** 标识当前模型的标签（文件名 / 自定义来源），仅用于状态栏展示。 */
  sourceLabel: string

  setSource: (source: string, opts?: { baseUrl?: string; sourceLabel?: string; assetRevisionKey?: string | null }) => void
  clearSource: () => void

  render: RenderOptions
  toggleRenderOption: (key: keyof RenderOptions) => void
  setRenderOption: <K extends keyof RenderOptions>(key: K, value: RenderOptions[K]) => void

  /** 剖切高度（0..1，模型高度的比例）：1=完整不切，越小切掉越多顶部。 */
  sectionHeight: number
  setSectionHeight: (value: number) => void

  sidePanelOpen: boolean
  toggleSidePanel: () => void
  setSidePanelOpen: (open: boolean) => void

  errorMessage: string | null
  setErrorMessage: (msg: string | null) => void

  /** 语言模式（由 editor 通过 WS editor:lang_mode 同步），zh=中文 / en=英文 */
  langMode: LangMode
  setLangMode: (mode: LangMode) => void
}

export const useViewerStore = create<ViewerStoreState>((set) => ({
  source: '',
  baseUrl: '',
  assetRevisionKey: null,
  sourceLabel: '',

  setSource: (source, opts) =>
    set({
      source,
      baseUrl: opts?.baseUrl ?? '',
      sourceLabel: opts?.sourceLabel ?? '',
      assetRevisionKey: opts?.assetRevisionKey ?? null,
      errorMessage: null,
    }),
  clearSource: () =>
    set({ source: '', baseUrl: '', sourceLabel: '', assetRevisionKey: null, errorMessage: null }),

  render: {
    showGrid: true,
    showAxis: true,
    showCollisions: false,
    autoAnimate: false,
    doubleSided: false,
    sectionView: false,
  },
  toggleRenderOption: (key) =>
    set((state) => ({ render: { ...state.render, [key]: !state.render[key] } })),
  setRenderOption: (key, value) =>
    set((state) => ({ render: { ...state.render, [key]: value } })),

  sectionHeight: 0.55,
  setSectionHeight: (value) => set({ sectionHeight: Math.min(1, Math.max(0, value)) }),

  sidePanelOpen: true,
  toggleSidePanel: () => set((state) => ({ sidePanelOpen: !state.sidePanelOpen })),
  setSidePanelOpen: (open) => set({ sidePanelOpen: open }),

  errorMessage: null,
  setErrorMessage: (msg) => set({ errorMessage: msg }),

  langMode: loadLangMode(),
  setLangMode: (mode) => {
    try { localStorage.setItem('langMode', mode) } catch { /* ignore */ }
    set({ langMode: mode })
  },
}))
