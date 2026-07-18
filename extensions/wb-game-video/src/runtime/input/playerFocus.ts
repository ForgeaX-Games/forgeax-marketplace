/**
 * 多局 Player 键盘焦点门控 —— 只有「当前焦点」Player 的交互皮响应 window keydown。
 *
 * 皮肤仍可挂 window 监听（便于全局快捷键手感），但必须先 `isPlayerFocused(root)`；
 * GraphPlayer 在 pointerdown / focusin 时 `claimPlayerFocus(root)`。
 */
let focusedRoot: HTMLElement | null = null

export function claimPlayerFocus(root: HTMLElement | null | undefined): void {
  if (!root) return
  focusedRoot = root
}

export function releasePlayerFocus(root: HTMLElement | null | undefined): void {
  if (root && focusedRoot === root) focusedRoot = null
}

/** 无任何 Player 声明焦点时放行（单局兼容）；有焦点时仅焦点根内响应。 */
export function isPlayerFocused(root: HTMLElement | null | undefined): boolean {
  if (!root) return focusedRoot == null
  if (focusedRoot == null) return true
  return focusedRoot === root || focusedRoot.contains(root)
}

export function getFocusedPlayerRoot(): HTMLElement | null {
  return focusedRoot
}
