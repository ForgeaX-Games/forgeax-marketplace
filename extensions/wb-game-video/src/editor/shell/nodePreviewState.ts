import type { GameNode, GameScenario } from '../../runtime/schema/graph-schema'
import type { NodeAction, Reaction } from '../../runtime/schema/node-config-schema'
import { applyEffects, type MutableState } from '../../runtime/engine/apply-effects'
import { evaluateCondition } from '../../runtime/engine/condition'
import { initState } from '../../runtime/engine/engine-init'

function applyEffectActions(state: MutableState, actions: readonly NodeAction[]): void {
  for (const action of actions) {
    if (action.kind === 'effect') applyEffects(state, action.effects)
  }
}

function applyPhase(state: MutableState, reactions: readonly Reaction[], phase: 'enter' | 'exit'): void {
  for (const reaction of reactions) {
    if (reaction.when.type === phase) applyEffectActions(state, reaction.do)
  }
}

/**
 * Project the deterministic node state at a preview playhead.
 * Rebuild from scenario initial state on every call so backward scrubbing never retains future effects.
 */
export function projectNodePreviewState(
  scenario: GameScenario,
  node: GameNode,
  playheadMs: number,
  durationMs: number,
): MutableState {
  const state = initState(scenario)
  const reactions = node.data.reactions ?? []

  applyPhase(state, reactions, 'enter')
  for (const reaction of reactions) {
    if (reaction.when.type === 'at' && reaction.when.ms <= playheadMs) {
      applyEffectActions(state, reaction.do)
    }
  }

  if (playheadMs >= durationMs) {
    const completes = reactions.filter((reaction) => reaction.when.type === 'complete')
    const chosen = completes.find((reaction) => (
      reaction.when.type === 'complete'
      && reaction.when.if
      && evaluateCondition(reaction.when.if, { state, visited: new Set<string>() })
    )) ?? completes.find((reaction) => reaction.when.type === 'complete' && !reaction.when.if)
    if (chosen) applyEffectActions(state, chosen.do)
    applyPhase(state, reactions, 'exit')
  }

  return state
}
