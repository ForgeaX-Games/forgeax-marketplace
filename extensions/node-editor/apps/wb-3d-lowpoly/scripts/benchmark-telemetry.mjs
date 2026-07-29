import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const FIELDS = ['system', 'toolSchemas', 'history', 'toolArguments', 'toolResults']

function chars(value) {
  if (value == null) return 0
  if (typeof value === 'string') return value.length
  try { return JSON.stringify(value).length } catch { return String(value).length }
}

function pick(record, names) {
  for (const name of names) if (record?.[name] != null) return record[name]
  return undefined
}

export function normalizeRound(record, index = 0) {
  const payload = record?.payload && typeof record.payload === 'object' ? record.payload : record
  const counts = {
    system: chars(pick(payload, ['system', 'systemPrompt', 'charter', 'persona'])),
    toolSchemas: chars(pick(payload, ['toolSchemas', 'tools', 'tool_specs'])),
    history: chars(pick(payload, ['history', 'messages', 'context'])),
    toolArguments: chars(pick(payload, ['toolArguments', 'toolArgs', 'arguments', 'input'])),
    toolResults: chars(pick(payload, ['toolResults', 'toolResult', 'result', 'output'])),
  }
  return {
    round: Number(payload?.round ?? payload?.turn ?? index + 1),
    ...counts,
    estimatedTokens: Object.fromEntries(FIELDS.map((field) => [field, Math.ceil(counts[field] / 4)])),
    llmCalls: Number(payload?.llmCalls ?? (payload?.usage ? 1 : 0)),
    toolCalls: Number(payload?.toolCalls ?? (payload?.toolCall || payload?.toolName ? 1 : 0)),
    durationMs: Number(payload?.durationMs ?? payload?.duration_ms ?? 0),
    usage: payload?.usage ?? null,
  }
}

export function summarize(records, meta = {}) {
  const rounds = records.map(normalizeRound)
  const totals = Object.fromEntries(FIELDS.map((field) => [field, rounds.reduce((n, row) => n + row[field], 0)]))
  const estimatedTokens = Object.fromEntries(FIELDS.map((field) => [
    field,
    rounds.reduce((n, row) => n + row.estimatedTokens[field], 0),
  ]))
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ...meta,
    rounds,
    totals: {
      ...totals,
      estimatedTokens,
      llmCalls: rounds.reduce((n, row) => n + row.llmCalls, 0),
      toolCalls: rounds.reduce((n, row) => n + row.toolCalls, 0),
      durationMs: rounds.reduce((n, row) => n + row.durationMs, 0),
      maxToolResultChars: Math.max(0, ...rounds.map((row) => row.toolResults)),
    },
  }
}

export function evaluateThresholds(report, limits = {}) {
  const configured = {
    maxToolResultChars: Number(limits.maxToolResultChars ?? 48_000),
    maxSystemChars: Number(limits.maxSystemChars ?? 50_000),
    maxToolSchemaChars: Number(limits.maxToolSchemaChars ?? 120_000),
  }
  const checks = [
    { metric: 'maxToolResultChars', actual: report.totals.maxToolResultChars, limit: configured.maxToolResultChars },
    { metric: 'systemChars', actual: report.totals.system, limit: configured.maxSystemChars },
    { metric: 'toolSchemaChars', actual: report.totals.toolSchemas, limit: configured.maxToolSchemaChars },
  ].map((check) => ({ ...check, pass: check.actual <= check.limit }))
  return { pass: checks.every((check) => check.pass), checks }
}

export function parseTrace(text) {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) return JSON.parse(trimmed)
  return trimmed.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
}

async function main() {
  const [tracePath, outputPath, taskId = process.env.LOWPOLY_BENCH_TASK ?? 'unknown'] = process.argv.slice(2)
  if (!tracePath) {
    throw new Error('usage: node scripts/benchmark-telemetry.mjs <trace.json|jsonl> [report.json] [taskId]')
  }
  const records = parseTrace(await readFile(tracePath, 'utf8'))
  const report = summarize(records, {
    taskId,
    model: process.env.LOWPOLY_BENCH_MODEL ?? 'unspecified',
    tracePath,
  })
  report.gates = evaluateThresholds(report, {
    maxToolResultChars: process.env.LOWPOLY_BENCH_MAX_TOOL_RESULT_CHARS,
    maxSystemChars: process.env.LOWPOLY_BENCH_MAX_SYSTEM_CHARS,
    maxToolSchemaChars: process.env.LOWPOLY_BENCH_MAX_TOOL_SCHEMA_CHARS,
  })
  const json = `${JSON.stringify(report, null, 2)}\n`
  if (outputPath) await writeFile(outputPath, json, 'utf8')
  else process.stdout.write(json)
  if (!report.gates.pass) process.exitCode = 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
