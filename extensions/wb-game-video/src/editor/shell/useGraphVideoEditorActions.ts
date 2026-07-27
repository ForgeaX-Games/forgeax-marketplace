import type { Entity, GameNode, GameScenario, GraphEffect, Layout } from '../../runtime/schema/graph-schema'
import type { QteCue } from '../../runtime/component-host/components/Qte'
import { useGraphScenario } from '../persist/graphScenarioStore'
import type { MaterialItem } from '../video/materialTimelineShared'
import {
  type MaterialTemplate,
  type PreviewOverlay,
  type QteOutcomeHandle,
  type SettlementSpawn,
  addMaterialGraph,
  addOptionBranchGraph,
  addQteCueGraph,
  addQteOutcomeGraph,
  bindVideoGraph,
  confirmMaterialDelete,
  deleteMaterialGraph,
  findNode,
  patchMaterialGraph,
  patchOverlayGraph,
  patchOverlayPositionGraph,
  patchSelectedGraph,
  patchSelectedLayoutGraph,
  qteElement,
  qteElementOfCue,
  removeOptionBranchGraph,
  removeQteCueGraph,
  removeQteOutcomeGraph,
  resetMaterialOverrideGraph,
  setComponentEventEffectsGraph,
  setComponentEventSpawnGraph,
  setNodePromptGraph,
  setOptionBranchEffectsGraph,
  setOptionBranchSpawnGraph,
  setOptionTargetGraph,
  setQteOutcomeEffectsGraph,
  setQteOutcomeSpawnGraph,
  setQteOutcomeTargetGraph,
  syncChoiceStyleLockedOptionsGraph,
  updateOptionLabelGraph,
} from '../video/graphMaterialOps'

type TopPanel = 'library' | 'prompt' | 'inspector'
type MaterialTimingPatch = { startMs?: number; endMs?: number; zIndex?: number }

export interface UseGraphVideoEditorActionsInput {
  scenario: GameScenario
  node: GameNode | undefined
  selectedSceneId: string
  maxMs: number
  entities: Record<string, Entity> | undefined
  playheadMs: number
  materials: MaterialItem[]
  selectedMaterial: MaterialItem | null
  selectedMaterialKey: string | null
  hasEditableVideo: boolean
  isTimedQteNode: boolean
  onScenarioChange: (scenario: GameScenario) => void
  onSelectedMaterialKeyChange: (key: string | null) => void
  onTopPanelChange: (panel: TopPanel) => void
}

export interface GraphVideoEditorActions {
  bindVideo: (ref: string, durationMs: number) => void
  setPrompt: (next: string) => void
  patchMaterial: (item: MaterialItem, patch: MaterialTimingPatch) => void
  deleteMaterial: (item: MaterialItem) => void
  resetMaterialOverride: (item: MaterialItem) => void
  addMaterial: (template: MaterialTemplate) => void
  addMaterialAt: (template: string, atMs: number, zIndex: number) => void
  addQteCue: (afterCueId?: string) => void
  removeQteCue: (cueId: string) => void
  patchSelected: (patch: Record<string, unknown>) => void
  patchSelectedLayout: (patch: Partial<Layout>) => void
  moveOverlay: (overlay: PreviewOverlay, x: number, y: number) => void
  addBranch: () => void
  setBranchLabel: (key: string, label: string) => void
  setBranchTarget: (key: string, target: string) => void
  setBranchEffects: (key: string, effects: GraphEffect[]) => void
  setBranchSpawn: (key: string, spawn: SettlementSpawn | undefined) => void
  removeBranch: (key: string) => void
  syncChoiceStyleLocked: () => void
  setQteOutcomeTarget: (handle: QteOutcomeHandle, target: string) => void
  setQteOutcomeEffects: (handle: QteOutcomeHandle, effects: GraphEffect[]) => void
  setQteOutcomeSpawn: (handle: QteOutcomeHandle, spawn: SettlementSpawn | undefined) => void
  addQteOutcome: (handle: QteOutcomeHandle) => void
  removeQteOutcome: (handle: QteOutcomeHandle) => void
}

export function useGraphVideoEditorActions({
  scenario,
  node,
  selectedSceneId,
  maxMs,
  entities,
  playheadMs,
  materials,
  selectedMaterial,
  selectedMaterialKey,
  hasEditableVideo,
  isTimedQteNode,
  onScenarioChange,
  onSelectedMaterialKeyChange,
  onTopPanelChange,
}: UseGraphVideoEditorActionsInput): GraphVideoEditorActions {
  function editScenario(
    update: (current: GameScenario, currentNode: GameNode) => GameScenario,
  ): void {
    const state = useGraphScenario.getState()
    const current: GameScenario = { ...state.authoringScenario(), graph: state.graph }
    const currentNode = findNode(current.graph, selectedSceneId)
    if (!currentNode) return
    onScenarioChange(update(current, currentNode))
  }

  function addMaterial(template: MaterialTemplate): void {
    if (!node) return
    const result = addMaterialGraph(scenario, node, maxMs, template, entities, playheadMs)
    onScenarioChange(result.scenario)
    if (result.selectKey) onSelectedMaterialKeyChange(result.selectKey)
    onTopPanelChange('inspector')
  }

  function addMaterialAt(template: string, atMs: number, zIndex: number): void {
    if (!node) return
    if (template === 'option' ? !hasEditableVideo || isTimedQteNode : !hasEditableVideo) return
    if (template === 'qte' && !hasEditableVideo) return
    const result = addMaterialGraph(
      scenario,
      node,
      maxMs,
      template,
      entities,
      playheadMs,
      { ms: atMs, zIndex },
    )
    onScenarioChange(result.scenario)
    if (result.selectKey) onSelectedMaterialKeyChange(result.selectKey)
    onTopPanelChange('inspector')
  }

  function removeQteCue(cueId: string): void {
    if (!node) return
    const qte = qteElementOfCue(scenario, node, cueId)
    const cueCount = (qte?.inputs?.cues as QteCue[] | undefined)?.length ?? 0
    if (cueCount <= 1) {
      const cueItem = materials.find((item) => item.kind === 'qte' && item.id === cueId)
      if (cueItem && !confirmMaterialDelete(scenario, node, cueItem)) return
      editScenario((current, currentNode) => removeQteCueGraph(current, currentNode, cueId))
      onSelectedMaterialKeyChange(null)
      onTopPanelChange('prompt')
      return
    }
    editScenario((current, currentNode) => removeQteCueGraph(current, currentNode, cueId))
    if (selectedMaterialKey?.endsWith(`:${cueId}`)) {
      const replacement = (qte?.inputs?.cues as QteCue[] | undefined)?.find((cue) => cue.id !== cueId)
      const element = qteElement(scenario, node)
      onSelectedMaterialKeyChange(
        replacement && element ? `qte:${element.id}:${replacement.id}` : null,
      )
    }
  }

  function patchSelected(patch: Record<string, unknown>): void {
    if (!node || !selectedMaterial) return
    editScenario((current, currentNode) =>
      selectedMaterial.kind === 'overlay'
        ? patchOverlayGraph(current, currentNode, selectedMaterial.id, patch, entities)
        : patchSelectedGraph(current, currentNode, selectedMaterial, patch))
  }

  return {
    bindVideo: (ref, durationMs) =>
      editScenario((current, currentNode) => bindVideoGraph(current, currentNode, ref, durationMs)),
    setPrompt: (next) =>
      editScenario((current, currentNode) => setNodePromptGraph(current, currentNode, next)),
    patchMaterial: (item, patch) =>
      editScenario((current, currentNode) =>
        patchMaterialGraph(current, currentNode, maxMs, item, patch)),
    deleteMaterial: (item) => {
      if (!node || !confirmMaterialDelete(scenario, node, item)) return
      editScenario((current, currentNode) => deleteMaterialGraph(current, currentNode, item))
      if (selectedMaterialKey === item.key) {
        onSelectedMaterialKeyChange(null)
        onTopPanelChange('prompt')
      }
    },
    resetMaterialOverride: (item) =>
      editScenario((current, currentNode) =>
        resetMaterialOverrideGraph(current, currentNode, item)),
    addMaterial,
    addMaterialAt,
    addQteCue: (afterCueId) => {
      if (!node) return
      const result = addQteCueGraph(scenario, node, maxMs, playheadMs, afterCueId)
      onScenarioChange(result.scenario)
      if (result.selectKey) onSelectedMaterialKeyChange(result.selectKey)
    },
    removeQteCue,
    patchSelected,
    patchSelectedLayout: (patch) => {
      if (!node || !selectedMaterial) return
      editScenario((current, currentNode) =>
        patchSelectedLayoutGraph(current, currentNode, selectedMaterial, patch))
    },
    moveOverlay: (overlay, x, y) =>
      editScenario((current, currentNode) =>
        patchOverlayPositionGraph(current, currentNode, overlay.target, x, y)),
    addBranch: () =>
      editScenario((current, currentNode) => addOptionBranchGraph(current, currentNode)),
    setBranchLabel: (key, label) =>
      editScenario((current, currentNode) =>
        updateOptionLabelGraph(current, currentNode, key, label)),
    setBranchTarget: (key, target) =>
      editScenario((current, currentNode) =>
        setOptionTargetGraph(current, currentNode, key, target)),
    setBranchEffects: (key, effects) =>
      editScenario((current, currentNode) =>
        selectedMaterial?.kind === 'component'
          ? setComponentEventEffectsGraph(current, currentNode, selectedMaterial.id, key, effects)
          : setOptionBranchEffectsGraph(current, currentNode, key, effects)),
    setBranchSpawn: (key, spawn) =>
      editScenario((current, currentNode) =>
        selectedMaterial?.kind === 'component'
          ? setComponentEventSpawnGraph(current, currentNode, selectedMaterial.id, key, spawn)
          : setOptionBranchSpawnGraph(current, currentNode, key, spawn)),
    removeBranch: (key) =>
      editScenario((current, currentNode) => removeOptionBranchGraph(current, currentNode, key)),
    syncChoiceStyleLocked: () =>
      editScenario((current, currentNode) =>
        syncChoiceStyleLockedOptionsGraph(current, currentNode)),
    setQteOutcomeTarget: (handle, target) =>
      editScenario((current, currentNode) =>
        setQteOutcomeTargetGraph(current, currentNode, handle, target)),
    setQteOutcomeEffects: (handle, effects) =>
      editScenario((current, currentNode) =>
        setQteOutcomeEffectsGraph(current, currentNode, handle, effects)),
    setQteOutcomeSpawn: (handle, spawn) =>
      editScenario((current, currentNode) =>
        setQteOutcomeSpawnGraph(current, currentNode, handle, spawn)),
    addQteOutcome: (handle) =>
      editScenario((current, currentNode) => addQteOutcomeGraph(current, currentNode, handle)),
    removeQteOutcome: (handle) =>
      editScenario((current, currentNode) => removeQteOutcomeGraph(current, currentNode, handle)),
  }
}
