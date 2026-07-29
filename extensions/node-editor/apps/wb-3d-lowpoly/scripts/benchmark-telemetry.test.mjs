import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateThresholds, parseTrace, summarize } from './benchmark-telemetry.mjs'

test('telemetry separates fixed context, history, args, and results', () => {
  const records = parseTrace([
    JSON.stringify({
      round: 1,
      system: '1234',
      tools: { x: '1234' },
      history: '12345678',
      arguments: { source: '1234' },
      result: '123456789012',
      usage: { inputTokens: 9, outputTokens: 2 },
      toolCalls: 1,
      durationMs: 25,
    }),
  ].join('\n'))
  const report = summarize(records, { taskId: 'fixture' })
  assert.equal(report.rounds.length, 1)
  assert.equal(report.totals.system, 4)
  assert.equal(report.totals.history, 8)
  assert.equal(report.totals.toolResults, 12)
  assert.equal(report.totals.estimatedTokens.toolResults, 3)
  assert.equal(report.totals.llmCalls, 1)
  assert.equal(report.totals.toolCalls, 1)
  assert.equal(report.totals.maxToolResultChars, 12)
  assert.equal(evaluateThresholds(report, { maxToolResultChars: 11 }).pass, false)
})
