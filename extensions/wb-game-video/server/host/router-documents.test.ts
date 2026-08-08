import { describe, expect, it } from 'vitest'
import type { WorkbenchExtensionContext } from '@forgeax/workbench-host/node'
import { createWbGameVideoRouter } from './router'

const decoder = new TextDecoder()
const encoder = new TextEncoder()

function contextFor(files: Record<string, string>): WorkbenchExtensionContext {
  return {
    files: {
      read: async (path: string) => {
        const value = files[path]
        return value === undefined ? null : encoder.encode(value)
      },
    },
  } as unknown as WorkbenchExtensionContext
}

function request(path: string) {
  return {
    gameId: 'game-1',
    runtimeId: 'runtime-1',
    method: 'GET',
    path,
    headers: {},
    query: {},
    body: new Uint8Array(),
  } as const
}

describe('wb-game-video document routing', () => {
  it('returns an empty document list for a new project', async () => {
    const router = createWbGameVideoRouter(contextFor({}))

    const response = await router.handle(request('documents'))

    expect(response.status).toBe(200)
    expect(JSON.parse(decoder.decode(response.body))).toEqual({ documents: [], selection: null })
  })

  it('returns only public document metadata and Markdown content', async () => {
    const router = createWbGameVideoRouter(contextFor({
      'assets/manifest.json': JSON.stringify({
        version: 2,
        assets: [{
          id: 'doc-outline',
          kind: 'document',
          name: '游戏大纲',
          status: 'ready',
          mimeType: 'text/markdown',
          createdAt: 1,
          updatedAt: 2,
          provider: { kind: 'local', ref: 'documents/outline.md' },
          meta: { documentType: 'outline' },
        }],
      }),
      'assets/documents/outline.md': '# 游戏大纲',
    }))

    const list = await router.handle(request('documents'))
    const document = await router.handle(request('documents/doc-outline'))

    expect(JSON.parse(decoder.decode(list.body))).toEqual({
      documents: [{ id: 'doc-outline', name: '游戏大纲', documentType: 'outline', updatedAt: 2 }],
      selection: null,
    })
    expect(JSON.parse(decoder.decode(document.body))).toEqual({
      document: { id: 'doc-outline', name: '游戏大纲', documentType: 'outline', updatedAt: 2 },
      content: '# 游戏大纲',
      selection: null,
    })
  })

  it('persists the first selected proposal and rejects a non-proposal target', async () => {
    const files: Record<string, string> = {
      'assets/manifest.json': JSON.stringify({
        version: 2,
        assets: [{
          id: 'doc-proposal',
          kind: 'document',
          name: '策划案',
          status: 'ready',
          mimeType: 'text/markdown',
          createdAt: 1,
          updatedAt: 2,
          provider: { kind: 'local', ref: 'documents/proposal.md' },
          meta: { documentType: 'proposal' },
        }, {
          id: 'doc-outline',
          kind: 'document',
          name: '大纲',
          status: 'ready',
          mimeType: 'text/markdown',
          createdAt: 1,
          updatedAt: 2,
          provider: { kind: 'local', ref: 'documents/outline.md' },
          meta: { documentType: 'outline' },
        }],
      }),
    }
    const context = contextFor(files)
    context.files.withLocks = async (_keys, operation) => operation()
    context.files.write = async (path, bytes) => { files[path] = decoder.decode(bytes) }
    const router = createWbGameVideoRouter(context)
    const response = await router.handle({
      ...request('documents/selection'),
      method: 'POST',
      headers: { 'content-type': ['application/json'] },
      body: encoder.encode(JSON.stringify({ proposalId: 'doc-proposal' })),
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(files['assets/manifest.json']!)).toMatchObject({
      documentSelection: { proposalId: 'doc-proposal' },
    })

    const invalid = await router.handle({
      ...request('documents/selection'),
      method: 'POST',
      headers: { 'content-type': ['application/json'] },
      body: encoder.encode(JSON.stringify({ proposalId: 'doc-outline' })),
    })
    expect(invalid.status).toBe(400)
  })
})
