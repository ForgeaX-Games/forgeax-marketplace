import {
  createSceneDiagnostic,
  toPublicSceneDiagnostics,
  type SceneDiagnostic,
  type SceneDiagnosticTransaction,
} from '@forgeax/scene-authoring'

export const NOT_APPLIED: SceneDiagnosticTransaction = { applied: false, rolledBack: false }

export function rejectedSceneScriptPayload(
  reason: string,
  diagnostics: readonly SceneDiagnostic[],
  options: {
    code?: string
    transaction?: SceneDiagnosticTransaction
    compatibility?: Record<string, unknown>
  } = {},
): Record<string, unknown> {
  const transaction = options.transaction ?? NOT_APPLIED
  return {
    status: 'rejected',
    reason,
    ...(options.code ? { code: options.code } : {}),
    ...(options.compatibility ?? {}),
    transaction,
    diagnostics: toPublicSceneDiagnostics(diagnostics, transaction),
  }
}

export function revisionConflictDiagnostic(expected: string, actual: string): SceneDiagnostic {
  return createSceneDiagnostic({
    code: 'scene-source-revision-conflict',
    phase: 'resolve',
    severity: 'error',
    title: 'Scene Script revision conflict',
    message: 'Scene Script changed since the edit lens was created.',
    expected: { revision: expected },
    actual: { revision: actual },
    transaction: NOT_APPLIED,
    retryable: true,
    escalation: 'none',
  })
}

export function runtimeImportDiagnostics(
  diagnostics: readonly { severity: string; message: string }[] | undefined,
): SceneDiagnostic[] {
  return (diagnostics ?? []).map((item) => createSceneDiagnostic({
    code: 'SCENE_RUNTIME_IMPORT',
    phase: 'compile',
    severity: item.severity === 'warn' ? 'warning' : 'error',
    title: 'Runtime Graph import rejected',
    message: item.message,
    transaction: { applied: false, rolledBack: true },
  }))
}
