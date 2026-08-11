import type {
  SceneDiagnostic,
  SceneDiagnosticEscalation,
  SceneDiagnosticPhase,
  SceneDiagnosticTransaction,
} from './types.js'

export interface SceneDiagnosticPolicy {
  retryable: boolean
  escalation: SceneDiagnosticEscalation
}

/** One explicit policy table shared by every Scene Script diagnostic producer. */
export const SCENE_DIAGNOSTIC_POLICIES: Readonly<Record<SceneDiagnosticPhase, SceneDiagnosticPolicy>> = {
  parse: { retryable: true, escalation: 'compiler' },
  type: { retryable: true, escalation: 'compiler' },
  resolve: { retryable: true, escalation: 'compiler' },
  compile: { retryable: true, escalation: 'compiler' },
  execute: { retryable: false, escalation: 'battery' },
  verify: { retryable: false, escalation: 'none' },
  platform: { retryable: true, escalation: 'platform' },
  capability: { retryable: false, escalation: 'none' },
}

function titleFromCode(code: string): string {
  return code
    .replace(/^SCENE_/, '')
    .replace(/^SCN-/, '')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (letter) => letter.toUpperCase())
}

function boundedValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    return value.length <= 1_024 ? value : `${value.slice(0, 1_024)}… [truncated ${value.length - 1_024} chars]`
  }
  if (typeof value === 'undefined') return undefined
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') return String(value)
  if (depth >= 3) return '[omitted: nested payload]'
  if (Array.isArray(value)) {
    const result = value.slice(0, 20).map((item) => boundedValue(item, depth + 1))
    if (value.length > 20) result.push(`[omitted: ${value.length - 20} items]`)
    return result
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !['stack', 'runtimeGraph', 'dataTree', 'voxels', 'voxelData'].includes(key))
    .slice(0, 20)
    .map(([key, item]) => [key, boundedValue(item, depth + 1)])
  return Object.fromEntries(entries)
}

export function createSceneDiagnostic(
  input: Omit<SceneDiagnostic, 'title' | 'retryable' | 'escalation'> &
    Partial<Pick<SceneDiagnostic, 'title' | 'retryable' | 'escalation'>>,
): SceneDiagnostic {
  const policy = SCENE_DIAGNOSTIC_POLICIES[input.phase]
  const statementId = input.source?.statementId ?? input.statementId
  return {
    ...input,
    title: input.title ?? titleFromCode(input.code),
    ...(input.source && statementId ? { source: { ...input.source, statementId } } : {}),
    ...(statementId
      ? {
          statementId,
          graph: { authoringNodeId: statementId, ...input.graph },
        }
      : {}),
    ...(input.expected !== undefined ? { expected: boundedValue(input.expected) } : {}),
    ...(input.actual !== undefined ? { actual: boundedValue(input.actual) } : {}),
    ...(input.fixes ? { fixes: input.fixes.slice(0, 3) } : {}),
    retryable: input.retryable ?? policy.retryable,
    escalation: input.escalation ?? policy.escalation,
  }
}

export function normalizeSceneDiagnostic(
  diagnostic: SceneDiagnostic,
  transaction?: SceneDiagnosticTransaction,
): SceneDiagnostic {
  return createSceneDiagnostic({
    ...diagnostic,
    ...(transaction ? { transaction } : {}),
  })
}

/**
 * Agent-facing diagnostics have a fixed response budget: one primary error,
 * at most two related diagnostics, and at most three structured fixes each.
 */
export function toPublicSceneDiagnostics(
  diagnostics: readonly SceneDiagnostic[],
  transaction?: SceneDiagnosticTransaction,
): SceneDiagnostic[] {
  if (diagnostics.length === 0) return []
  const primary = diagnostics.findIndex((item) => item.severity === 'error')
  const ordered = primary > 0
    ? [diagnostics[primary], ...diagnostics.slice(0, primary), ...diagnostics.slice(primary + 1)]
    : [...diagnostics]
  return ordered.slice(0, 3).map((item) => normalizeSceneDiagnostic(item, transaction))
}
