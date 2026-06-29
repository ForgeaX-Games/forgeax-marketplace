import type { FastifyInstance } from 'fastify'
import { applyBatch } from '@forgeax/node-runtime'
import { getRuntime } from '../runtime.js'
import { ensureMutationAccess } from './projects.js'
import { checkSinoOpAllowlist, isSinoBatch } from './sinoOpGate.js'
import { logPersistBatch } from '../lib/persistTrace.js'

export async function registerMutationRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/batch', async (req, reply) => {
    const t0 = performance.now()
    const access = await ensureMutationAccess(req)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
    const rt = await getRuntime()
    // `actor`, the optional human-readable `label` and an optional client-chosen
    // `batchId` are forwarded into the kernel history entry. AI / CLI callers set
    // actor (e.g. 'ai:agent', 'cli') and may annotate with `label` so the editor's
    // History panel surfaces a meaningful row (see node-runtime-react history
    // bridge). Forwarding `batchId` lets a caller correlate its own batch with the
    // graph:applied it gets back (the bridge waits for that exact id). Local UI
    // edits pass actor 'editor' and are skipped by the bridge to avoid double-recording.
    const { ops, opts } = req.body as {
      ops: unknown[]
      opts?: { actor?: string; label?: string; batchId?: string; ephemeral?: boolean; expectedPrevHash?: string }
    }

    // Sino agent op-allowlist hard gate. DEFAULT-OFF: only engages when the
    // batch is attributed to the constrained "scene composer" agent (via
    // opts.actor `ai:sino` or the forwarded caller agent-id header). Non-sino
    // callers (UI editor, other agents, CLI, tests) bypass this entirely, so
    // existing behaviour is unchanged. See routes/sinoOpGate.ts for the rules.
    if (isSinoBatch(opts, req.headers['x-forgeax-caller-agent-id'])) {
      const rejection = checkSinoOpAllowlist(ops)
      if (rejection) {
        return reply.code(403).send({ reason: rejection.reason, opIndex: rejection.opIndex, opId: rejection.opId })
      }
    }

    const result = await applyBatch(rt, ops as never, {
      actor: opts?.actor ?? 'ui',
      ...(opts?.label !== undefined ? { label: opts.label } : {}),
      ...(opts?.batchId !== undefined ? { batchId: opts.batchId } : {}),
      ...(opts?.ephemeral !== undefined ? { ephemeral: opts.ephemeral } : {}),
      ...(opts?.expectedPrevHash !== undefined ? { expectedPrevHash: opts.expectedPrevHash } : {}),
    })

    if (result.status === 'rejected' && result.reason?.startsWith('concurrent-write:')) {
      return reply.code(409).send(result)
    }

    logPersistBatch(ops as never, result, {
      actor: opts?.actor,
      label: opts?.label,
      batchId: opts?.batchId,
      durationMs: performance.now() - t0,
    })

    // graph:applied is announced by the kernel's in-process bus (applyBatch ->
    // busFor.emit) and fanned out to every live client by the /ws subscription
    // binding. We deliberately do NOT broadcast a second copy here: that was a
    // redundant refresh path that double-fired loadPipeline on every mutation.
    // Layout-only batches (reposition / viewport / frames) emit no bus event at
    // all, so dragging a node no longer triggers a snapshot re-pull or preview
    // rebuild on any client.
    return result
  })
}
