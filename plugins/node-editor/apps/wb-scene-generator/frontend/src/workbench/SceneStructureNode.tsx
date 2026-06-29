import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from 'reactflow'
import {
  BatteryNode,
  resolveInputPortValue,
  usePipelineStore,
  type Battery,
} from '@forgeax/node-runtime-react/editor'
import type { SceneNodeSnapshot } from '../../../vendor/shared/types/scene/types.js'
import {
  collectNodeStats,
  extractScenePortFromWire,
  formatSceneNodeLabel,
  pathsExpandedToFocus,
  readTreeRoot,
  type SceneNodeStats,
} from './sceneStructureUtils.js'
import './SceneStructureNode.css'

const MIN_NODE_WIDTH = 200
const MIN_NODE_HEIGHT = 160
const DEFAULT_NODE_HEIGHT = 280

interface SceneStructureNodeData {
  battery: Battery
  params: Record<string, unknown>
}

function TreeCaret({ collapsed }: { collapsed: boolean }): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="scene-structure-tree__caret-icon">
      <path
        d={collapsed ? 'M3 1L7 5L3 9' : 'M1 3L5 7L9 3'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SceneTreeRow({
  node,
  depth,
  isLast,
  guides,
  focusPath,
  collapsed,
  onToggle,
}: {
  node: SceneNodeSnapshot
  depth: number
  isLast: boolean
  guides: boolean[]
  focusPath: string
  collapsed: ReadonlySet<string>
  onToggle: (path: string) => void
}): JSX.Element {
  const stats = useMemo(() => collectNodeStats(node), [node])
  const hasChildren = node.children.length > 0
  const isCollapsed = collapsed.has(node.path)
  const isFocus = node.path === focusPath

  return (
    <>
      <li className={`scene-structure-tree__row${isFocus ? ' is-focus' : ''}`}>
        <div className="scene-structure-tree__guides" aria-hidden="true">
          {guides.map((continues, index) => (
            <span
              key={`${node.path}-guide-${index}`}
              className={`scene-structure-tree__guide${continues ? ' scene-structure-tree__guide--v' : ''}`}
            />
          ))}
          {depth > 0 ? (
            <span
              className={`scene-structure-tree__guide scene-structure-tree__guide--branch${isLast ? ' scene-structure-tree__guide--last' : ''}`}
            />
          ) : null}
        </div>
        {hasChildren ? (
          <button
            type="button"
            className="scene-structure-tree__caret nodrag"
            aria-expanded={!isCollapsed}
            onClick={() => onToggle(node.path)}
          >
            <TreeCaret collapsed={isCollapsed} />
          </button>
        ) : (
          <span className="scene-structure-tree__caret scene-structure-tree__caret--spacer" aria-hidden />
        )}
        <span className="scene-structure-tree__name" title={node.path}>
          {formatSceneNodeLabel(node)}
        </span>
        {node.schema ? <span className="scene-structure-tree__schema">{node.schema}</span> : null}
        <span className="scene-structure-tree__stats" title={`own=${stats.ownVoxels} · subtree=${stats.subtreeVoxels}`}>
          {stats.ownVoxels}/{stats.subtreeVoxels}
        </span>
      </li>
      {hasChildren &&
        !isCollapsed &&
        node.children.map((child, index) => (
          <SceneTreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            isLast={index === node.children.length - 1}
            guides={[...guides, !isLast]}
            focusPath={focusPath}
            collapsed={collapsed}
            onToggle={onToggle}
          />
        ))}
    </>
  )
}

function SceneStructurePanel({
  focusPath,
  root,
  rootStats,
}: {
  focusPath: string
  root: SceneNodeSnapshot
  rootStats: SceneNodeStats
}): JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    const expanded = pathsExpandedToFocus(focusPath)
    setCollapsed(() => {
      const next = new Set<string>()
      const walk = (node: SceneNodeSnapshot): void => {
        if (node.children.length > 0 && !expanded.has(node.path)) {
          next.add(node.path)
        }
        for (const child of node.children) walk(child)
      }
      walk(root)
      return next
    })
  }, [focusPath, root])

  const onToggle = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  return (
    <div className="scene-structure-panel nodrag">
      <div className="scene-structure-panel__summary">
        <span className="scene-structure-panel__focus" title={focusPath}>
          focus {focusPath || '/'}
        </span>
        <span className="scene-structure-panel__meta">
          nodes {rootStats.nodeCount} · voxels {rootStats.subtreeVoxels}
        </span>
      </div>
      <ul className="scene-structure-tree" role="tree">
        <SceneTreeRow
          node={root}
          depth={0}
          isLast
          guides={[]}
          focusPath={focusPath}
          collapsed={collapsed}
          onToggle={onToggle}
        />
      </ul>
    </div>
  )
}

function resolveSceneWireValue(nodeId: string): unknown {
  const state = usePipelineStore.getState()
  const fromOutput = state.nodeOutputs[nodeId]?.scene
  if (fromOutput !== undefined) return fromOutput
  return resolveInputPortValue(nodeId, 'scene')
}

function SceneStructureNode(props: NodeProps<SceneStructureNodeData>): JSX.Element {
  const { id, data, selected } = props
  const updateNodeParam = usePipelineStore((s) => s.updateNodeParam)
  const schedulePersistSession = usePipelineStore((s) => s.schedulePersistSession)
  const { setNodes } = useReactFlow()
  const nodeOutputs = usePipelineStore((s) => s.nodeOutputs[id])
  const edges = usePipelineStore((s) => s.currentPipeline?.edges)

  useEffect(() => {
    if (typeof data.params._nodeHeight === 'number') return
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, style: { ...n.style, height: DEFAULT_NODE_HEIGHT } } : n)),
    )
    updateNodeParam(id, '_nodeHeight', DEFAULT_NODE_HEIGHT, true)
  }, [data.params._nodeHeight, id, setNodes, updateNodeParam])

  const scenePort = useMemo(() => {
    void nodeOutputs
    void edges
    return extractScenePortFromWire(resolveSceneWireValue(id))
  }, [id, nodeOutputs, edges])

  const root = scenePort ? readTreeRoot(scenePort) : null
  const rootStats = root ? collectNodeStats(root) : null
  const placeholder = !scenePort ? '连接 scene 端口以查看结构' : null

  return (
    <div className="scene-structure-node">
      <NodeResizer
        minWidth={MIN_NODE_WIDTH}
        minHeight={MIN_NODE_HEIGHT}
        isVisible={selected}
        lineClassName="scene-structure-resize-line"
        handleClassName="scene-structure-resize-handle"
        onResizeEnd={(_event, params) => {
          updateNodeParam(id, '_nodeWidth', params.width, true)
          updateNodeParam(id, '_nodeHeight', params.height, true)
          schedulePersistSession('scene-structure-resize')
        }}
      />
      <BatteryNode {...props} />
      {placeholder ? (
        <div className="scene-structure-panel scene-structure-panel--empty nodrag">
          <span className="scene-structure-panel__placeholder">{placeholder}</span>
        </div>
      ) : root && rootStats ? (
        <SceneStructurePanel focusPath={scenePort!.focus} root={root} rootStats={rootStats} />
      ) : null}
    </div>
  )
}

export default memo(SceneStructureNode)
