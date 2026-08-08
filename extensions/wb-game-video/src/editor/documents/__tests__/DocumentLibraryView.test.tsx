import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyHostInit, resetHostInjectionForTests } from '../../../host-init'
import { useDocumentNav } from '../../persist/documentNavStore'
import { DocumentLibraryView } from '../DocumentLibraryView'

const mocks = vi.hoisted(() => ({
  fetchProjectDocuments: vi.fn(),
  fetchProjectDocument: vi.fn(),
}))

vi.mock('../document-client', () => ({
  fetchProjectDocuments: mocks.fetchProjectDocuments,
  fetchProjectDocument: mocks.fetchProjectDocument,
}))

describe('DocumentLibraryView', () => {
  beforeEach(() => {
    mocks.fetchProjectDocuments.mockReset()
    mocks.fetchProjectDocument.mockReset()
    useDocumentNav.setState({ documentType: 'intake' })
    resetHostInjectionForTests()
  })

  afterEach(() => {
    resetHostInjectionForTests()
  })

  it('shows a read-only empty state when a new project has no Markdown documents', async () => {
    mocks.fetchProjectDocuments.mockResolvedValue({ documents: [] })

    render(<DocumentLibraryView />)

    await waitFor(() => {
      expect(screen.getByText('当前项目尚无需求。')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: /创建|上传|编辑|采用/ })).toBeNull()
  })

  it('renders a single registered document for the active type', async () => {
    mocks.fetchProjectDocuments.mockResolvedValue({
      documents: [
        { id: 'doc-core', name: '核心方案', documentType: 'core', updatedAt: 1 },
      ],
    })
    mocks.fetchProjectDocument.mockResolvedValue({
      id: 'doc-core', name: '核心方案', documentType: 'core', updatedAt: 1, content: '# 核心',
    })
    useDocumentNav.setState({ documentType: 'core' })

    render(<DocumentLibraryView />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: '核心' })).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: '采用' })).toBeNull()
  })

  it('refetches the document list when the active type changes', async () => {
    mocks.fetchProjectDocuments
      .mockResolvedValueOnce({
        documents: [
          { id: 'doc-intake', name: '需求', documentType: 'intake', updatedAt: 1 },
        ],
      })
      .mockResolvedValueOnce({
        documents: [
          { id: 'doc-intake', name: '需求', documentType: 'intake', updatedAt: 1 },
          { id: 'doc-pillar', name: '支柱', documentType: 'pillar', updatedAt: 3 },
        ],
      })
    mocks.fetchProjectDocument.mockImplementation(async (id: string) => (
      id === 'doc-pillar'
        ? { id, name: '支柱', documentType: 'pillar', updatedAt: 3, content: '支柱正文' }
        : { id, name: '需求', documentType: 'intake', updatedAt: 1, content: '需求正文' }
    ))

    render(<DocumentLibraryView />)

    await waitFor(() => {
      expect(screen.getByText('需求正文')).toBeTruthy()
    })

    act(() => {
      useDocumentNav.setState({ documentType: 'pillar' })
    })

    await waitFor(() => {
      expect(screen.getByText('支柱正文')).toBeTruthy()
    })
    expect(mocks.fetchProjectDocuments).toHaveBeenCalledTimes(2)
    expect(mocks.fetchProjectDocument).toHaveBeenCalledWith('doc-pillar')
    expect(screen.queryByText('需求正文')).toBeNull()
    expect(screen.queryByText('当前项目尚无支柱。')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders only the author-visible layer of the active document', async () => {
    mocks.fetchProjectDocuments.mockResolvedValue({
      documents: [
        { id: 'doc-pillar', name: '支柱', documentType: 'pillar', updatedAt: 3 },
      ],
    })
    mocks.fetchProjectDocument.mockResolvedValue({
      id: 'doc-pillar',
      name: '支柱',
      documentType: 'pillar',
      updatedAt: 3,
      content: [
        '# 黑神话 · 支柱设计',
        '',
        '    schema_version: 1',
        '    based_on_option: A',
        '',
        '<!-- ========== 作者可见层（确认门渲染此段） ========== -->',
        '',
        '### 序：五行山下',
        '',
        '五百年前那一架没打完。',
        '',
        '<!-- ========== 契约层（作者界面默认折叠） ========== -->',
        '',
        '| 字段 | 值 |',
        '| --- | --- |',
        '| ap_cost | 3 |',
      ].join('\n'),
    })
    useDocumentNav.setState({ documentType: 'pillar' })

    render(<DocumentLibraryView />)

    await waitFor(() => {
      expect(screen.getByText('五百年前那一架没打完。')).toBeTruthy()
    })
    const prose = screen.getByText('五百年前那一架没打完。').closest('.gdx-prose')
    expect(prose).toBeTruthy()
    expect(prose?.textContent ?? '').not.toContain('schema_version')
    expect(prose?.textContent ?? '').not.toContain('<!--')
    expect(prose?.textContent ?? '').not.toContain('ap_cost')
  })

  it('hosts docActionSlotEl under header', async () => {
    mocks.fetchProjectDocuments.mockResolvedValue({ documents: [] })
    const slot = document.createElement('div')
    slot.textContent = 'HOST_BAR'
    applyHostInit({ docActionSlotEl: slot })

    render(<DocumentLibraryView />)

    const hostBar = await screen.findByText('HOST_BAR')
    expect(hostBar.closest('.gdx-header')).toBeTruthy()
    expect(screen.getByTestId('doc-action-slot-host').contains(slot)).toBe(true)
  })
})
