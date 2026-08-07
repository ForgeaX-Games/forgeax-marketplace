import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocumentNav } from '../../persist/documentNavStore'
import { DocumentLibraryView } from '../DocumentLibraryView'

const mocks = vi.hoisted(() => ({
  fetchProjectDocuments: vi.fn(),
  fetchProjectDocument: vi.fn(),
  selectProjectProposal: vi.fn(),
}))

vi.mock('../document-client', () => ({
  fetchProjectDocuments: mocks.fetchProjectDocuments,
  fetchProjectDocument: mocks.fetchProjectDocument,
  selectProjectProposal: mocks.selectProjectProposal,
}))

describe('DocumentLibraryView', () => {
  beforeEach(() => {
    mocks.fetchProjectDocuments.mockReset()
    mocks.fetchProjectDocument.mockReset()
    mocks.selectProjectProposal.mockReset()
    useDocumentNav.setState({ documentType: 'proposal' })
  })

  it('shows a read-only empty state when a new project has no Markdown documents', async () => {
    mocks.fetchProjectDocuments.mockResolvedValue({ documents: [], selection: null })

    render(<DocumentLibraryView />)

    await waitFor(() => {
      expect(screen.getByText('当前项目尚无策划案。创建和写入功能将在后续版本提供。')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: /创建|上传|编辑/ })).toBeNull()
  })

  it('adopts exactly one proposal and hides other adoption actions', async () => {
    mocks.fetchProjectDocuments.mockResolvedValue({
      documents: [
        { id: 'proposal-a', name: '方案 A', documentType: 'proposal', updatedAt: 1 },
        { id: 'proposal-b', name: '方案 B', documentType: 'proposal', updatedAt: 2 },
      ],
      selection: null,
    })
    mocks.fetchProjectDocument.mockResolvedValue({
      id: 'proposal-a', name: '方案 A', documentType: 'proposal', updatedAt: 1, content: '# A',
    })
    mocks.selectProjectProposal.mockResolvedValue({ proposalId: 'proposal-a' })

    render(<DocumentLibraryView />)

    await waitFor(() => expect(screen.getAllByRole('button', { name: '采用' })).toHaveLength(2))
    fireEvent.click(screen.getAllByRole('button', { name: '采用' })[0]!)
    await waitFor(() => expect(screen.getByText('已采用')).toBeTruthy())
    expect(screen.queryByRole('button', { name: '采用' })).toBeNull()
  })
})
