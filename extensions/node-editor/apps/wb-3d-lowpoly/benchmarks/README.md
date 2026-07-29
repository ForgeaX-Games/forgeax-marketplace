# Lowpoly agent benchmark

`tasks.json` fixes the three comparison tasks: one static object, one 8–12 part mechanical assembly, and one 20–30 instance static scene.

For each run, export one JSON/JSONL record per LLM round with any of these fields:

```json
{"round":1,"system":"...","toolSchemas":[],"history":[],"toolArguments":{},"toolResults":{},"usage":{"inputTokens":0,"outputTokens":0},"llmCalls":1,"toolCalls":1,"durationMs":0}
```

Generate the report:

```bash
LOWPOLY_BENCH_MODEL=<model> \
node scripts/benchmark-telemetry.mjs trace.jsonl report.json simple-static-object
```

The report separates system, tool schemas, history, tool arguments, and tool results by characters and estimated tokens, plus LLM/tool calls and duration. It exits with code 2 when the default regression gates are exceeded:

- any single tool result: 48,000 chars
- total system context: 50,000 chars
- total tool schemas: 120,000 chars

Override gates with `LOWPOLY_BENCH_MAX_TOOL_RESULT_CHARS`, `LOWPOLY_BENCH_MAX_SYSTEM_CHARS`, and `LOWPOLY_BENCH_MAX_TOOL_SCHEMA_CHARS`. Compare reports only when task id and model are identical.
