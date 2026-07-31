/**
 * 试玩「蓝图」浮层：调用栈 → 面包屑 / pinned 高亮（编辑器调试 UI 专用）。
 * runtime 只暴露 SessionSnapshot.activeBlueprintId + callStack；折叠规则不住引擎。
 */
export interface BlueprintCrumb {
  blueprintId: string
  title: string
}

/** 外→内：root + 栈中每次换蓝图的帧 + 当前 active（去重连续相同 id） */
export function blueprintBreadcrumbs(
  rootBlueprintId: string,
  rootTitle: string,
  callStack: ReadonlyArray<{ blueprintId: string; title?: string }>,
  activeBlueprintId: string,
  activeTitle: string,
): BlueprintCrumb[] {
  const out: BlueprintCrumb[] = [{ blueprintId: rootBlueprintId, title: rootTitle || rootBlueprintId }]
  for (const f of callStack) {
    const last = out[out.length - 1]
    if (last && last.blueprintId === f.blueprintId) continue
    out.push({ blueprintId: f.blueprintId, title: f.title || f.blueprintId })
  }
  const last = out[out.length - 1]
  if (!last || last.blueprintId !== activeBlueprintId) {
    out.push({ blueprintId: activeBlueprintId, title: activeTitle || activeBlueprintId })
  } else {
    last.title = activeTitle || last.title
  }
  return out
}

/** pinned 到某蓝图时：该 id 在栈上最深一帧的 caller；若 pinned===active 则 null（改用 currentNodeId） */
export function deepestCallerOnBlueprint(
  callStack: ReadonlyArray<{ blueprintId: string; callerNodeId: string }>,
  pinnedBlueprintId: string,
  activeBlueprintId: string,
): string | null {
  if (pinnedBlueprintId === activeBlueprintId) return null
  for (let i = callStack.length - 1; i >= 0; i--) {
    if (callStack[i]!.blueprintId === pinnedBlueprintId) return callStack[i]!.callerNodeId
  }
  return null
}
