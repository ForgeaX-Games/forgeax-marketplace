import { pluginFetch } from '../../lib/plugin-http'
import { readExtensionJson } from '../../lib/workbench-host'
import type { DocumentType } from '../assets/registry-types'

export interface ProjectDocumentSummary {
  id: string
  name: string
  documentType: DocumentType
  updatedAt: number
}

export interface ProjectDocument extends ProjectDocumentSummary {
  content: string
}

export interface ProjectDocumentSelection {
  proposalId?: string
}

export interface ProjectDocumentList {
  documents: ProjectDocumentSummary[]
  selection: ProjectDocumentSelection | null
}

function isDocumentType(value: unknown): value is DocumentType {
  return value === 'proposal' || value === 'outline' || value === 'script'
}

function isSummary(value: unknown): value is ProjectDocumentSummary {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string'
    && typeof item.name === 'string'
    && isDocumentType(item.documentType)
    && typeof item.updatedAt === 'number'
}

export async function fetchProjectDocuments(): Promise<ProjectDocumentList> {
  const response = await pluginFetch('documents')
  const body = await readExtensionJson(response) as { documents?: unknown, selection?: unknown }
  if (!Array.isArray(body.documents) || !body.documents.every(isSummary)) {
    throw new Error('Extension returned an invalid documents response')
  }
  if (
    body.selection !== null
    && body.selection !== undefined
    && (
      typeof body.selection !== 'object'
      || typeof (body.selection as { proposalId?: unknown }).proposalId !== 'string'
    )
  ) {
    throw new Error('Extension returned an invalid document selection')
  }
  return {
    documents: body.documents,
    selection: body.selection === null || body.selection === undefined
      ? null
      : body.selection as ProjectDocumentSelection,
  }
}

export async function fetchProjectDocument(id: string): Promise<ProjectDocument> {
  const response = await pluginFetch(`documents/${encodeURIComponent(id)}`)
  const body = await readExtensionJson(response) as { document?: unknown, content?: unknown }
  if (!isSummary(body.document) || typeof body.content !== 'string') {
    throw new Error('Extension returned an invalid document response')
  }
  return { ...body.document, content: body.content }
}

export async function selectProjectProposal(proposalId: string): Promise<ProjectDocumentSelection> {
  const response = await pluginFetch('documents/selection', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ proposalId }),
  })
  const body = await readExtensionJson(response) as { selection?: unknown }
  const selection = body.selection
  if (
    !selection
    || typeof selection !== 'object'
    || typeof (selection as { proposalId?: unknown }).proposalId !== 'string'
  ) {
    throw new Error('Extension returned an invalid document selection')
  }
  return selection as ProjectDocumentSelection
}
