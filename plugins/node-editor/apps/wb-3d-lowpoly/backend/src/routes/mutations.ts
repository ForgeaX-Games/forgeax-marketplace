import type { FastifyInstance } from 'fastify'
import { applyBatch } from '@forgeax/node-runtime'
import { getRuntime } from '../runtime.js'
import { ensureMutationAccess } from './projects.js'
import { BATCH_BODY_LIMIT, MAX_BATCH_OPS } from './body-limits.js'

export async function registerMutationRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/batch', {
    // Cap request size + validate shape up front: an unbounded body is a trivial
    // DoS, and an absent/non-array `ops` used to reach applyBatch and 500.
    bodyLimit: BATCH_BODY_LIMIT,
    schema: {
      body: {
        type: 'object',
        required: ['ops'],
        properties: {
          ops: { type: 'array', maxItems: MAX_BATCH_OPS, items: { type: 'object' } },
          opts: {
            type: 'object',
            properties: {
              actor: { type: 'string' },
              label: { type: 'string' },
              batchId: { type: 'string' },
              expectedPrevHash: { type: 'string' },
            },
            additionalProperties: true,
          },
        },
        additionalProperties: true,
      },
    },
  }, async (req, reply) => {
    const access = await ensureMutationAccess(req)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
    const rt = await getRuntime()
    // `actor` and the optional human-readable `label` are forwarded into the
    // kernel history entry. AI / CLI callers set actor (e.g. 'ai:agent', 'cli')
    // and may annotate with `label` so the editor's History panel surfaces a
    // meaningful row (see node-runtime-react history bridge). Local UI edits
    // pass actor 'editor' and are skipped by the bridge to avoid double-recording.
    const { ops, opts } = req.body as {
      ops: unknown[]
      opts?: { actor?: string; label?: string; batchId?: string; expectedPrevHash?: string }
    }
    const result = await applyBatch(rt, ops as never, {
      actor: opts?.actor ?? 'ui',
      ...(opts?.label !== undefined ? { label: opts.label } : {}),
      ...(opts?.batchId !== undefined ? { batchId: opts.batchId } : {}),
      ...(opts?.expectedPrevHash !== undefined ? { expectedPrevHash: opts.expectedPrevHash } : {}),
    })

    if (result.status === 'rejected' && result.reason?.startsWith('concurrent-write:')) {
      return reply.code(409).send(result)
    }

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
