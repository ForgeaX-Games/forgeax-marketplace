// 💡 URDF Viewer 双语文案表：editor 通过 WS editor:lang_mode 同步 langMode 到本端口；
//    若 viewer 作为独立窗口（直接打开 :9558）则默认 zh、可后续自行切换。
//
//    使用方式：
//      const t = useViewerI18n()      // hook，自动随 langMode 变化重渲染
//      t.titlebar.open                 // 字符串
//      t.fmt.linksCount(3)             // 函数（带格式化）

import { useViewerStore } from '../store/viewerStore'

export interface ViewerI18nStrings {
  titlebar: {
    productName: string
    open: string
    openTooltip: string
    paste: string
    pasteTooltip: string
    export: string
    exportTooltip: string
    exportHeader: string
    exportObj: string
    exportObjSub: string
    exportGlb: string
    exportGlbSub: string
    exportGlbStatic: string
    exportGlbStaticSub: string
    exportUrdf: string
    exportUrdfSub: string
    pasteOverlayTitle: string
    pastePlaceholder: string
    cancel: string
    load: string
    clearModelTooltip: string
    toggleGrid: string
    toggleAxis: string
    playAnimation: string
    stopAnimation: string
    screenshot: string
    moreOptions: string
    viewOptions: string
    showCollision: string
    renderBothSides: string
    sectionView: string
    sectionViewHint: string
    sectionHeightLabel: string
    resetCamera: string
    resetCameraSub: string
    showJointPanel: string
    hideJointPanel: string
    fullscreenStandaloneNote: string
    enterFullscreen: string
    exitFullscreen: string
  }
  sidePanel: {
    modelInfo: string
    robot: string
    links: string
    joints: string
    visuals: string
    movableSuffix: string
    fixedSuffix: string
    mimicSuffix: string
    primitive: string
    meshLoaded: string
    meshFailed: string
    noModelLoaded: string
    jointsHeader: string
    animatingTag: string
    resetAllJoints: string
    noMovableJoints: string
    noLimit: string
    rangeArrow: string
  }
  canvas: {
    emptyTitle: string
    emptySubPrefix: string
    emptySubMid1: string
    emptySubSuffix: string
    loadingMesh: string
  }
}

const ZH: ViewerI18nStrings = {
  titlebar: {
    productName: 'URDF 预览器',
    open: '打开',
    openTooltip: '打开本地 URDF 文件',
    paste: '粘贴',
    pasteTooltip: '粘贴 URDF XML 文本',
    export: '导出',
    exportTooltip: '导出当前模型',
    exportHeader: '导出格式',
    exportObj: 'OBJ',
    exportObjSub: '保存当前视图中的物体为 Wavefront OBJ',
    exportGlb: 'GLB（带动画）',
    exportGlbSub: '保存当前物体为 GLB，含关节预览动画（与自动动画一致）',
    exportGlbStatic: 'GLB（静态）',
    exportGlbStaticSub: '保存当前物体为 GLB，仅几何 + 材质，不含任何动画轨道',
    exportUrdf: 'URDF',
    exportUrdfSub: '保存当前 URDF XML 源文件',
    pasteOverlayTitle: '粘贴 URDF XML',
    pastePlaceholder: "<?xml version='1.0'?>\n<robot name='...'>\n  ...\n</robot>",
    cancel: '取消',
    load: '加载',
    clearModelTooltip: '清除当前模型',
    toggleGrid: '网格地面',
    toggleAxis: '坐标系',
    playAnimation: '开始预览动画',
    stopAnimation: '停止预览动画',
    screenshot: '保存截图',
    moreOptions: '更多设置',
    viewOptions: '视图选项',
    showCollision: '显示碰撞几何',
    renderBothSides: '双面渲染（DoubleSide）',
    sectionView: '建筑剖切（切掉顶部看内部）',
    sectionViewHint: '用水平面切掉模型顶部，俯视看进房间 / 各楼层',
    sectionHeightLabel: '剖切高度',
    resetCamera: '重置相机',
    resetCameraSub: '让相机重新适配当前模型',
    showJointPanel: '显示关节面板',
    hideJointPanel: '隐藏关节面板',
    fullscreenStandaloneNote: '全屏仅在嵌入到编辑器时可用',
    enterFullscreen: '让 Viewer 占据整个工作台',
    exitFullscreen: '退出全屏',
  },
  sidePanel: {
    modelInfo: '模型信息',
    robot: '名称',
    links: '连杆',
    joints: '关节',
    visuals: '可视元素',
    movableSuffix: '可动',
    fixedSuffix: '固定',
    mimicSuffix: '联动',
    primitive: '基础形状',
    meshLoaded: 'mesh 已加载',
    meshFailed: '加载失败',
    noModelLoaded: '尚未加载模型。',
    jointsHeader: '关节',
    animatingTag: '预览动画中',
    resetAllJoints: '重置所有关节',
    noMovableJoints: '该模型没有可动关节。',
    noLimit: '(无限位)',
    rangeArrow: '→',
  },
  canvas: {
    emptyTitle: '尚未加载 URDF',
    emptySubPrefix: '点击标题栏的 ',
    emptySubMid1: '打开',
    emptySubSuffix: ' 或 粘贴 来载入模型。',
    loadingMesh: '正在加载 mesh 资源…',
  },
}

const EN: ViewerI18nStrings = {
  titlebar: {
    productName: 'URDF Viewer',
    open: 'Open',
    openTooltip: 'Open URDF file',
    paste: 'Paste',
    pasteTooltip: 'Paste URDF XML text',
    export: 'Export',
    exportTooltip: 'Export current model',
    exportHeader: 'Export format',
    exportObj: 'OBJ',
    exportObjSub: 'Save the visible object as Wavefront OBJ',
    exportGlb: 'GLB (animated)',
    exportGlbSub: 'Save as GLB with joint preview animation (same as auto-animate)',
    exportGlbStatic: 'GLB (static)',
    exportGlbStaticSub: 'Save as GLB with geometry + materials only, no animation tracks',
    exportUrdf: 'URDF',
    exportUrdfSub: 'Save the current URDF XML source',
    pasteOverlayTitle: 'Paste URDF XML',
    pastePlaceholder: "<?xml version='1.0'?>\n<robot name='...'>\n  ...\n</robot>",
    cancel: 'Cancel',
    load: 'Load',
    clearModelTooltip: 'Clear model',
    toggleGrid: 'Toggle grid',
    toggleAxis: 'Toggle axis helper',
    playAnimation: 'Play animation',
    stopAnimation: 'Stop animation',
    screenshot: 'Save screenshot',
    moreOptions: 'More options',
    viewOptions: 'View options',
    showCollision: 'Show collision geometry',
    renderBothSides: 'Render both sides (DoubleSide)',
    sectionView: 'Section view (cut top to see inside)',
    sectionViewHint: 'Clip the top of the model with a horizontal plane to look into rooms / floors',
    sectionHeightLabel: 'Section height',
    resetCamera: 'Reset camera',
    resetCameraSub: 'Re-fit camera to current model',
    showJointPanel: 'Show joint panel',
    hideJointPanel: 'Hide joint panel',
    fullscreenStandaloneNote: 'Fullscreen available only when embedded in editor',
    enterFullscreen: 'Maximize Viewer in workbench',
    exitFullscreen: 'Exit fullscreen',
  },
  sidePanel: {
    modelInfo: 'Model Info',
    robot: 'Name',
    links: 'Links',
    joints: 'Joints',
    visuals: 'Visuals',
    movableSuffix: 'movable',
    fixedSuffix: 'fixed',
    mimicSuffix: 'mimic',
    primitive: 'primitive',
    meshLoaded: 'mesh loaded',
    meshFailed: 'failed',
    noModelLoaded: 'No model loaded.',
    jointsHeader: 'Joints',
    animatingTag: 'animating',
    resetAllJoints: 'Reset all joints',
    noMovableJoints: 'No movable joints in this model.',
    noLimit: '(no limit)',
    rangeArrow: '→',
  },
  canvas: {
    emptyTitle: 'No URDF loaded',
    emptySubPrefix: 'Use ',
    emptySubMid1: 'Open',
    emptySubSuffix: ' or Paste in the title bar to load a model.',
    loadingMesh: 'Loading mesh assets…',
  },
}

const TABLE = { zh: ZH, en: EN } as const

/** Hook：随 useViewerStore.langMode 自动重渲染。 */
export function useViewerI18n(): ViewerI18nStrings {
  const langMode = useViewerStore((s) => s.langMode)
  return TABLE[langMode] ?? ZH
}

/** 同步获取（store 方法、effect 内部使用），不订阅变化。 */
export function getViewerI18n(): ViewerI18nStrings {
  return TABLE[useViewerStore.getState().langMode] ?? ZH
}
