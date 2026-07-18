/**
 * cameraMath —— 等效焦段(mm) ↔ 水平视场角(度) 换算（基于 36mm 全画幅水平边）。
 *
 * three.PerspectiveCamera.fov 是**垂直** fov；UI 用「等效焦段」更直观。这里统一按
 * 水平 36mm 口径做换算（与摄影界“等效焦距”口径一致）。渲染时再按画幅比把水平 fov
 * 折算成 three 需要的垂直 fov（由调用方用 aspect 处理，本模块只管 mm↔水平fov）。
 */

const FULL_FRAME_WIDTH_MM = 36

const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180

/** 等效焦段(mm) → 水平视场角(度)。 */
export function mmToFov(mm: number): number {
  const m = mm > 0 ? mm : 1
  return 2 * Math.atan(FULL_FRAME_WIDTH_MM / (2 * m)) * RAD2DEG
}

/** 水平视场角(度) → 等效焦段(mm)。 */
export function fovToMm(deg: number): number {
  const d = Math.min(179, Math.max(1, deg))
  return FULL_FRAME_WIDTH_MM / 2 / Math.tan((d * DEG2RAD) / 2)
}

/**
 * 水平 fov + 画幅比 → three 垂直 fov（度）。
 *   vFov = 2*atan(tan(hFov/2) / aspect)
 */
export function horizontalToVerticalFov(hFovDeg: number, aspect: number): number {
  const a = aspect > 0 ? aspect : 1
  const hHalf = (hFovDeg * DEG2RAD) / 2
  return 2 * Math.atan(Math.tan(hHalf) / a) * RAD2DEG
}
