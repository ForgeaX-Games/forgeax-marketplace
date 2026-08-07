import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchProjectDocument, fetchProjectDocuments, selectProjectProposal } from '../document-client'

const mocks = vi.hoisted(() => ({
  pluginFetch: vi.fn(),
  readExtensionJson: vi.fn(),
}))

vi.mock('../../../lib/plugin-http', () => ({ pluginFetch: mocks.pluginFetch }))
vi.mock('../../../lib/workbench-host', () => ({ readExtensionJson: mocks.readExtensionJson }))

const OUTLINE = {
  id: 'doc-outline',
  name: '游戏大纲',
  documentType: 'outline',
  updatedAt: 1,
}

describe('project document client', () => {
  beforeEach(() => {
    mocks.pluginFetch.mockReset()
    mocks.readExtensionJson.mockReset()
    mocks.pluginFetch.mockResolvedValue(new Response('{}'))
  })

  it('returns an empty document list as a normal new-project state', async () => {
    mocks.readExtensionJson.mockResolvedValue({ documents: [], selection: null })

    await expect(fetchProjectDocuments()).resolves.toEqual({ documents: [], selection: null })
    expect(mocks.pluginFetch).toHaveBeenCalledWith('documents')
  })

  it('loads a document body through its registered id', async () => {
    mocks.readExtensionJson.mockResolvedValue({
      document: OUTLINE,
      content: '# 游戏大纲',
    })

    await expect(fetchProjectDocument('doc-outline')).resolves.toEqual({
      ...OUTLINE,
      content: '# 游戏大纲',
    })
    expect(mocks.pluginFetch).toHaveBeenCalledWith('documents/doc-outline')
  })

  it('persists an adopted proposal through the selection endpoint', async () => {
    mocks.readExtensionJson.mockResolvedValue({ selection: { proposalId: 'doc-proposal' } })

    await expect(selectProjectProposal('doc-proposal')).resolves.toEqual({ proposalId: 'doc-proposal' })
    expect(mocks.pluginFetch).toHaveBeenCalledWith('documents/selection', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ proposalId: 'doc-proposal' }),
    })
  })
})
