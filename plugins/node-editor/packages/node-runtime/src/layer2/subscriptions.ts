// Subscription channels: graph events, execution events, asset events.
// Consumed by UI for live updates and by AI for change notifications.

export type GraphEvent =
  | { kind: 'graph:applied'; pipelineId: string; batchId: string; newHash: string }
  | { kind: 'graph:rejected'; pipelineId: string; reason: string }

export type ExecutionEvent =
  | { kind: 'exec:started'; pipelineId: string; executionId: string }
  | { kind: 'exec:node:output'; pipelineId: string; nodeId: string; portId: string; outputType: string }
  // A node the walker chose NOT to execute. Currently only manual-trigger ops (e.g. AI generators behind the Run button): the walker treats them as data boundaries and hydrates downstream from their cached output instead of re-firing the op. `reason` is a short machine tag ('manualTrigger').
  | { kind: 'exec:node:skipped'; pipelineId: string; executionId: string; nodeId: string; reason: string }
  | { kind: 'exec:completed'; pipelineId: string; executionId: string }
  | { kind: 'exec:error'; pipelineId: string; executionId: string; nodeId?: string; message: string }
  // Non-fatal execution diagnostic (the run continues). Emitted e.g. when a partial run reads a boundary upstream input that has no cached output yet (never executed), so the input silently resolves to empty.
  | { kind: 'exec:warn'; pipelineId: string; executionId: string; nodeId: string; message: string }

export type AssetEvent =
  | { kind: 'asset:added'; path: string; type: string; producer: string }
  | { kind: 'asset:changed'; path: string; type: string }
  | { kind: 'asset:removed'; path: string }

// Workspace-lifecycle events. `project:activated` is broadcast to ALL connected
// clients when the active project changes (in one iframe / via an agent tool) so
// every other client pointed at the same backend re-syncs to it. It travels on
// the 'graph' channel (the client transport demuxes any non-exec/non-asset kind
// onto 'graph'), so no new subscription channel is required.
export type WorkspaceEvent =
  | { kind: 'project:activated'; projectId: string; pipelineId: string; newHash: string }

export type RuntimeEvent = GraphEvent | ExecutionEvent | AssetEvent | WorkspaceEvent

export type RuntimeChannel = 'graph' | 'execution' | 'asset'

export interface SubscriptionAPI {
  subscribe(
    pipelineId: string,
    channels: ReadonlyArray<RuntimeChannel>,
    handler: (event: RuntimeEvent) => void,
  ): () => void
}
