/**
 * 蓝图侧栏 / 库列表的纯派生：主蓝图置顶（isEntry 标记），其余子蓝图按标题排序。
 * 不依赖 store/React——供单测与 NewSidebar 共用。
 */
import type { BlueprintDoc } from '../../runtime/schema/graph-schema'

export function blueprintListItems(
  blueprints: Record<string, BlueprintDoc>,
  mainId: string,
): { id: string; label: string; isEntry: boolean }[] {
  const main = blueprints[mainId]
  const subs = Object.values(blueprints)
    .filter((d) => d.id !== mainId)
    .sort((a, b) => a.title.localeCompare(b.title))
  const items: { id: string; label: string; isEntry: boolean }[] = []
  if (main) items.push({ id: main.id, label: main.title, isEntry: true })
  for (const d of subs) items.push({ id: d.id, label: d.title, isEntry: false })
  return items
}
