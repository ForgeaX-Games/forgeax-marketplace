// Drop hook: drop a battery from the palette onto the canvas, build a ReactFlow
// node and sync it to the pipeline store. The placement logic is factored into
// placeBattery so the double-click search popover can reuse the same insertion
// path. Ported from the legacy editor (components/canvas/useCanvasDrop.ts),
// retargeted onto the editor stores.
//
import { useCallback } from 'react'
import type { Node, ReactFlowInstance } from 'reactflow'
import { usePipelineStore, useHistoryStore } from '../../stores/index.js'
import { createEmptyPipeline } from '../../stores/pipelineStore.helpers.js'
import type { Battery } from '../../types.js'
import { resolveNodeType, DEFAULT_BATTERY_WIDTH, estimateBatteryNodeWidth, estimateGroupNodeWidth } from './canvasConstants.js'
import { formatIdAsLabel } from '../../utils/batteryLabels.js'
import { RELAY_BATTERY_ID, RELAY_NODE_HEIGHT, RELAY_NODE_WIDTH } from './RelayNode.js'
import { getEditorTransport } from '../../transport/index.js'
import { buildGroupNodeData } from './GroupNode.js'
import { expandLoadedGroupBundle, remapGroupBundle } from './groupViewUtils.js'
import { computeGroupContentHash, writeGroupProvenance } from './groupStatus.js'
import { isTemplateBattery, getSmallLabel } from '../sidebar/batteryGrouping.js'

/** Shared kernel op id backing every saved-prompt node (see PromptNode). */
const PROMPT_OP_ID = 'prompt_template'

interface UseCanvasDropParams {
  reactFlowInstance: ReactFlowInstance | null
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  onUngroup?: (groupId: string) => void
  onEnterGroup?: (groupId: string) => void
  /**
   * App/domain hook for a drop that carries NO `application/battery` payload —
   * e.g. an image dragged from an embedded asset panel (a different iframe, so
   * the native dataTransfer does not survive). Called with the drop position in
   * flow coordinates plus `placeBattery`, so the consumer can look up a battery
   * and insert a node with preset params. Generic: the kernel knows nothing
   * about the domain payload (it lives in an app-side channel, e.g. localStorage).
   */
  onExternalDrop?: ExternalDropHandler
}

export type ExternalDropHandler = (
  flowPosition: { x: number; y: number },
  event: React.DragEvent,
  placeBattery: PlaceBatteryFn,
) => void

export type PlaceBatteryFn = (
  battery: Battery,
  position: { x: number; y: number },
  options?: { presetText?: string; presetParams?: Record<string, unknown> },
) => string | null

export function useCanvasDrop({ reactFlowInstance, setNodes, onUngroup, onEnterGroup, onExternalDrop }: UseCanvasDropParams) {
  const addNode = usePipelineStore((s) => s.addNode)
  const addGroup = usePipelineStore((s) => s.addGroup)
  const addAnnotation = usePipelineStore((s) => s.addAnnotation)
  const incrementalExecute = usePipelineStore((s) => s.incrementalExecute)

  // dragenter 与 dragover 都必须 preventDefault 才算合法 drop target。
  // 单独 cancel dragover 在 Chrome 够用，但 WebKit（Studio/.app 的 WKWebView）
  // 在进入时若 dragenter 未 cancel 会先显示「禁止」光标、直到下一次 dragover 才纠正，
  // 期间松手 drop 不触发 → 电池创建失败。补 onDragEnter 消除这个进入瞬态。
  const onDragEnter = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const placeBattery = useCallback<PlaceBatteryFn>(
    (battery, position, options) => {
      const presetText = options?.presetText
      const presetExtraParams = options?.presetParams ?? {}

      if (battery.type === 'group') {
        // Templates are a locked, restyled class of group battery (big tag
        // 'templates/…'); regular dragged-out group batteries are normal groups.
        const droppedIsTemplate = isTemplateBattery(battery)
        // Provenance for the dropped instance: every group dragged from the
        // library is `saved` (its content matches the library file it came
        // from). Capture the source location so a later edit + save overwrites
        // that file directly, and the content hash so the status reads `saved`
        // until the user actually edits it. Templates carry the isTemplate flag.
        const loadScope: 'groups' | 'templates' = isTemplateBattery(battery) ? 'templates' : 'groups'
        const sourceCategory = droppedIsTemplate ? getSmallLabel(battery) : (battery.displayGroup?.split('/')[1] ?? battery.category)
        const sourceBatteryName = battery.name
        void getEditorTransport().api.loadGroup(battery.id, { scope: loadScope })
          .then((loaded) => {
            if (!loaded) {
              console.warn(`[placeBattery] group template not found: ${battery.id} (scope=${loadScope})`)
              return
            }
            const [root, ...deps] = expandLoadedGroupBundle(loaded)
            const remapped = remapGroupBundle(root, deps, position)
            for (const dep of remapped.deps) addGroup(dep)
            addGroup(remapped.root)

            const noop = (_groupId: string) => {}
            const rfNode: Node = {
              id: remapped.root.id,
              type: 'group',
              position,
              style: { width: estimateGroupNodeWidth(remapped.root, usePipelineStore.getState().batteries) },
              data: buildGroupNodeData(remapped.root, onUngroup ?? noop, onEnterGroup ?? noop, droppedIsTemplate),
              selected: false,
            }
            setNodes((nds) => [...nds, rfNode])

            // Record BEFORE the lazy pipeline is created (currentPipeline may
            // still be null on the very first drop into a fresh project); an
            // empty pipeline is the correct pre-state for undoing the first node.
            const { currentPipeline } = usePipelineStore.getState()
            useHistoryStore.getState().record('add_node', currentPipeline ?? createEmptyPipeline(), {
              nodeIds: [remapped.root.id],
              label: `添加模板节点：${battery.name}`,
              labelEn: `Add template: ${formatIdAsLabel(battery.id)}`,
            })

            addNode({
              id: remapped.root.id,
              batteryId: '__group__',
              name: remapped.root.name,
              position,
              // Stamp provenance so the dropped group is `saved` and (for
              // templates) locked. The hash is over the remapped (id-free)
              // content so it matches the library file regardless of fresh ids.
              params: writeGroupProvenance({ groupId: remapped.root.id }, {
                sourceCategory,
                sourceBatteryName,
                // The library id is the dragged battery's own id; keep it so a
                // later edit + save overwrites that exact library entry instead
                // of minting a duplicate keyed on the remapped instance id.
                sourceGroupId: battery.id,
                savedContentHash: computeGroupContentHash(remapped.root),
                ...(droppedIsTemplate ? { isTemplate: true } : {}),
              }),
            })
            setTimeout(() => {
              // Persist FIRST (this commits the createGroup op that materialises
              // the group shadow node in the kernel), THEN execute. Chaining the
              // execute off the persist promise — instead of firing both in the
              // same tick with `persist:false` — fixes a drop-then-execute race:
              // the group node's execute used to race ahead of its still-in-flight
              // createGroup persist, so the kernel had no such node yet and
              // executeNode threw "target node not found", surfacing as a bare 500.
              void usePipelineStore.getState().persistSession()
                .then(() =>
                  usePipelineStore.getState().incrementalExecute(remapped.root.id, false, { persist: false }),
                )
            }, 50)
          })
          .catch((e) => console.error('[placeBattery] failed to load group template:', e))
        return null
      }

      // Saved-prompt battery: every prompt instance is backed by the shared
      // `prompt_template` op (executes the [xxx] substitution). The per-instance
      // template + var ports + name are baked into the node params (carried on
      // the palette battery as dropParams), so the node is self-contained and
      // survives reload — PromptNode renders its ports from these params, not
      // from the catalog battery (which on reload is the bare shared op).
      if (battery.nodeType === 'prompt') {
        const nodeId = `node-${Date.now()}`
        const promptVars = battery.inputs.map((i) => i.name)
        const params: Record<string, unknown> = {
          ...(battery.dropParams ?? {}),
          ...presetExtraParams,
          _promptVars: promptVars,
          _promptName: battery.name,
        }
        const autoWidth = estimateBatteryNodeWidth(battery)
        const newNode: Node = {
          id: nodeId,
          type: 'prompt',
          position,
          style: { width: autoWidth },
          data: { battery, params },
        }
        setNodes((nds) => [...nds, newNode])

        const { currentPipeline } = usePipelineStore.getState()
        useHistoryStore.getState().record('add_node', currentPipeline ?? createEmptyPipeline(), {
          nodeIds: [nodeId],
          label: `添加提示词：${battery.name}`,
          labelEn: `Add prompt: ${battery.name}`,
        })

        addNode({ id: nodeId, batteryId: PROMPT_OP_ID, name: battery.name, position, params })
        incrementalExecute(nodeId, false)
        return nodeId
      }

      if (battery.id === RELAY_BATTERY_ID) {
        const nodeId = `relay-${Date.now()}`
        const params = { portType: 'any' }
        const newNode: Node = {
          id: nodeId,
          type: 'relay',
          position,
          style: { width: RELAY_NODE_WIDTH, height: RELAY_NODE_HEIGHT },
          data: params,
        }

        setNodes((nds) => [...nds, newNode])

        const { currentPipeline } = usePipelineStore.getState()
        useHistoryStore.getState().record('add_node', currentPipeline ?? createEmptyPipeline(), {
          nodeIds: [nodeId],
          label: '添加 Relay',
          labelEn: 'Add Relay',
        })

        addNode({
          id: nodeId,
          batteryId: RELAY_BATTERY_ID,
          name: 'Relay',
          position,
          params,
        })
        return nodeId
      }

      const nodeType = resolveNodeType(battery)

      // annotation battery: create a canvas annotation, not an execution node.
      if (nodeType === 'annotation') {
        const { currentPipeline } = usePipelineStore.getState()
        const annotationId = addAnnotation(position)
        useHistoryStore.getState().record('add_node', currentPipeline ?? createEmptyPipeline(), {
          nodeIds: [annotationId],
          label: '添加注释',
          labelEn: 'Add annotation',
        })
        setNodes((nds) => [
          ...nds,
          {
            id: annotationId,
            type: 'annotation',
            position,
            style: { width: 400, height: 60 },
            data: { text: '', initialEdit: true },
            deletable: true,
            selectable: true,
            draggable: true,
          },
        ])
        return annotationId
      }

      const nodeId = `node-${Date.now()}`

      const specialInit: Record<string, { style?: Record<string, number>; params?: Record<string, unknown> }> = {
        text_panel: { style: { width: DEFAULT_BATTERY_WIDTH, height: 150 } },
        ai_battery: { style: { width: DEFAULT_BATTERY_WIDTH } },
        json_battery: { style: { width: DEFAULT_BATTERY_WIDTH, height: 200 } },
        image_reader: { style: { width: DEFAULT_BATTERY_WIDTH } },
        image_preview: { style: { width: DEFAULT_BATTERY_WIDTH } },
      }
      const initConfig = specialInit[nodeType] ?? {}
      const autoWidth = estimateBatteryNodeWidth(
        battery,
        (initConfig.style?.width as number | undefined) ?? DEFAULT_BATTERY_WIDTH,
      )

      const dynInitParams: Record<string, unknown> = battery.dynamicInputs
        ? { portCount: battery.dynamicInputs.minCount }
        : {}

      const presetParams: Record<string, unknown> = {
        ...(presetText ? { text: presetText } : {}),
        ...presetExtraParams,
      }

      const newNode: Node = {
        id: nodeId,
        type: nodeType,
        position,
        style: { ...(initConfig.style ?? { width: DEFAULT_BATTERY_WIDTH }), width: autoWidth },
        data: {
          battery,
          params: { ...dynInitParams, ...(initConfig.params ?? {}), ...presetParams },
        },
      }

      setNodes((nds) => [...nds, newNode])

      const { currentPipeline } = usePipelineStore.getState()
      useHistoryStore.getState().record('add_node', currentPipeline ?? createEmptyPipeline(), {
        nodeIds: [nodeId],
        label: `添加节点：${battery.name}`,
        labelEn: `Add node: ${formatIdAsLabel(battery.id)}`,
      })

      addNode({
        id: nodeId,
        batteryId: battery.id,
        name: battery.name,
        position,
        params: { ...presetParams },
      })

      // AI batteries must be run manually; everything else triggers a partial
      // recompute on insert.
      if (battery.type !== 'ai') {
        incrementalExecute(nodeId, false)
      }
      return nodeId
    },
    [setNodes, addNode, addGroup, addAnnotation, incrementalExecute, onUngroup, onEnterGroup],
  )

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (!reactFlowInstance) return

      const batteryData = event.dataTransfer.getData('application/battery')
      const position = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })

      // No battery payload: this may be an app/domain external drop (e.g. an
      // image dragged from an embedded asset panel in another iframe, whose
      // native dataTransfer does not cross the boundary). Defer to the consumer.
      if (!batteryData) {
        onExternalDrop?.(position, event, placeBattery)
        return
      }

      const battery: Battery = JSON.parse(batteryData)
      const presetText = event.dataTransfer.getData('application/preset-text')

      placeBattery(battery, position, presetText ? { presetText } : undefined)
    },
    [reactFlowInstance, placeBattery, onExternalDrop],
  )

  return { onDragEnter, onDragOver, onDrop, placeBattery }
}
