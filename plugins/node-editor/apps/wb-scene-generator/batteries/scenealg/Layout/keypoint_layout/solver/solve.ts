// Orchestrates a full solve: normalize the problem to ~unit scale (so Adam's step
// size is scale-invariant), optimize, then scale positions back to meters.

import type { ProblemModel, SolveResult } from './types.ts'
import { buildTerms, mergeConfig, type SolverConfigOverride } from './config.ts'
import { optimize } from './optimizer.ts'

/** Characteristic length used to normalize the problem (meters). */
export function characteristicLength(model: ProblemModel): number {
  let max = 1
  for (const node of model.nodes) max = Math.max(max, node.radius)
  for (const rel of model.relations) {
    if (rel.kind === 'clearance' && rel.distance !== undefined) max = Math.max(max, Math.abs(rel.distance))
  }
  return max
}

function normalizeModel(model: ProblemModel, scale: number): ProblemModel {
  return {
    index: model.index,
    warnings: model.warnings,
    nodes: model.nodes.map((n) => ({ ...n, radius: n.radius / scale })),
    relations: model.relations.map((r) =>
      r.kind === 'clearance' && r.distance !== undefined ? { ...r, distance: r.distance / scale } : { ...r },
    ),
  }
}

export function solve(model: ProblemModel, override?: SolverConfigOverride): SolveResult {
  if (model.nodes.length === 0) return { positions: [], energy: 0, perTerm: {}, iterations: 0 }

  const config = mergeConfig(override)
  const scale = characteristicLength(model)
  const normalized = normalizeModel(model, scale)
  const terms = buildTerms(config)

  const seed = config.seed ?? 0
  const result = optimize(normalized, terms, {
    iterations: config.iterations,
    learningRate: config.learningRate,
    adam: config.adam,
    seed,
  })

  return {
    ...result,
    positions: result.positions.map((p) => ({ x: p.x * scale, y: p.y * scale })),
  }
}
