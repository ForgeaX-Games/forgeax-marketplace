// 💡 几何共享逻辑单位
//
// 本仓库统一 1 cell = 8 CSS px。各视角 geometry(top / iso / topBillboard)以此
// 为基准换算屏幕像素。legacy 里这个常量挂在 rendererTypes,这里下沉到 framework
// geometry 自己持有,保持框架自包含、mode-agnostic。

export const BASE_CELL_SIZE = 8
export const TEXTURE_PPU = 16
