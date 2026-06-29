export interface PathTreeNode {
  pathKey: string
  segment: string
  layerKey?: string
  children: PathTreeNode[]
}

export interface VisiblePathTreeRow {
  node: PathTreeNode
  depth: number
}

export function buildPathTree<T extends { nodePath: string; nodeName?: string }>(
  layerKeys: string[],
  layerOf: (key: string) => T | undefined,
): PathTreeNode[] {
  const root: PathTreeNode = { pathKey: '', segment: '', children: [] }
  for (const layerKey of layerKeys) {
    const layer = layerOf(layerKey)
    if (!layer) continue
    const segs = layer.nodePath.split('/').filter(Boolean)
    let cur = root
    let acc = ''
    for (let i = 0; i < segs.length; i++) {
      const segment = segs[i]
      acc += '/' + segment
      let child = cur.children.find((c) => c.pathKey === acc)
      if (!child) {
        child = { pathKey: acc, segment, children: [] }
        cur.children.push(child)
      }
      if (i === segs.length - 1) child.layerKey = layerKey
      cur = child
    }
  }
  return root.children
}

export function flattenVisiblePathTree(
  nodes: PathTreeNode[],
  collapsed: ReadonlySet<string>,
  depth = 0,
): VisiblePathTreeRow[] {
  const out: VisiblePathTreeRow[] = []
  for (const node of nodes) {
    out.push({ node, depth })
    if (!collapsed.has(node.pathKey)) {
      out.push(...flattenVisiblePathTree(node.children, collapsed, depth + 1))
    }
  }
  return out
}

export function pathParent(p: string): string {
  const segs = p.split('/').filter(Boolean)
  segs.pop()
  return segs.length ? '/' + segs.join('/') : '/'
}
