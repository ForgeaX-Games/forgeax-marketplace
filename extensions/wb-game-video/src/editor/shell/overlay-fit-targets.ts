const FIT_TARGET_SELECTOR = '[data-overlay-fit-target]'

function isInteractiveElement(element: HTMLElement): boolean {
  const style = getComputedStyle(element)
  return (
    element.tagName === 'BUTTON'
    || element.getAttribute('role') === 'button'
    || style.cursor === 'pointer'
    || style.cursor === 'not-allowed'
  )
}

/**
 * 操作框测量目标：
 * 1. 组件显式标记的可见内容节点；
 * 2. 未标记时回退到叶子内容 + 最外层交互热区。
 *
 * 不测透明的 100% 布局根节点，避免组件首次拖动写入 layout 后操作框突然膨胀。
 */
export function overlayFitTargets(root: HTMLElement): HTMLElement[] {
  const explicit = Array.from(root.querySelectorAll<HTMLElement>(FIT_TARGET_SELECTOR))
  if (explicit.length) return explicit

  const all = Array.from(root.querySelectorAll<HTMLElement>('*'))
  const leaves = all.filter((element) => element.childElementCount === 0)
  const interactive = all
    .filter(isInteractiveElement)
    .filter((element) => !all.some((other) => other !== element && isInteractiveElement(other) && other.contains(element)))
  return [...new Set([...leaves, ...interactive])]
}
