/**
 * ReelScenario 的 fail-fast 校验（ajv）。
 *
 * charter「Schema-as-Contract」红线落点：进出 `ReelLevel.pack.json` payload 的
 * 剧本不再是裸 `Record<string,unknown>`，而是经可机读 schema
 * （`reelScenario.schema.json`，唯一真源）校验过的 `ReelScenarioLike`。
 *
 * 校验策略 = 骨架严格 + 长尾宽松（schema 里 `additionalProperties:true`）：
 * 只钉 runtime 寻路真正依赖的字段（id/title/rootSceneId/scenes/schemaVersion +
 * 每个 scene 的 id/title/durationMs/branches），避免与 1700 行 TS 类型逐字段漂移。
 *
 * 浏览器安全：ajv 可在浏览器运行；standalone 播放器读取 payload 时也走这里。
 */

import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import schema from './reelScenario.schema.json'
import {
  extractScenario,
  type ReelScenarioLike,
} from '../pkg/reelGamePayload'

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false })
const validateFn: ValidateFunction = ajv.compile(schema)

export interface ScenarioValidationOk {
  ok: true
}
export interface ScenarioValidationErr {
  ok: false
  errors: string[]
}
export type ScenarioValidation = ScenarioValidationOk | ScenarioValidationErr

function formatError(e: ErrorObject): string {
  const path = e.instancePath && e.instancePath.length > 0 ? e.instancePath : '(root)'
  const extra =
    e.keyword === 'additionalProperties' && e.params && 'additionalProperty' in e.params
      ? ` (${(e.params as { additionalProperty?: string }).additionalProperty})`
      : ''
  return `${path}: ${e.message ?? '非法'}${extra}`
}

/** 纯校验，不抛错；返回 ok 或带可读错误列表。 */
export function validateReelScenario(data: unknown): ScenarioValidation {
  const valid = validateFn(data)
  if (valid) return { ok: true }
  const errors = (validateFn.errors ?? []).map(formatError)
  return { ok: false, errors: errors.length > 0 ? errors : ['未知 schema 校验错误'] }
}

/** fail-fast：非法时抛出带全部错误的 Error，并把 data 收窄为 ReelScenarioLike。 */
export function assertReelScenario(data: unknown): asserts data is ReelScenarioLike {
  const r = validateReelScenario(data)
  if (!r.ok) {
    throw new Error(
      `ReelScenario schema 校验失败：\n  - ${r.errors.join('\n  - ')}`,
    )
  }
}

/**
 * 从 reel-game payload 取回并校验 Scenario；任一步失败都抛错（charter Fail-Fast）。
 * loader 读取 / standalone 播放器加载用这个，而不是松提取的 `extractScenario`。
 */
export function extractValidatedScenario(payload: unknown): ReelScenarioLike {
  const scenario = extractScenario(payload)
  if (!scenario) {
    throw new Error('reel-game payload 非法：缺少 scenario 对象')
  }
  assertReelScenario(scenario)
  return scenario
}
