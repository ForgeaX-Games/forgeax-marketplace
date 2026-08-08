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

export interface ProjectDocumentList {
  documents: ProjectDocumentSummary[]
}

function isDocumentType(value: unknown): value is DocumentType {
  return value === 'intake' || value === 'core' || value === 'inquiry' || value === 'pillar'
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
  const body = await readExtensionJson(response) as { documents?: unknown }
  if (!Array.isArray(body.documents) || !body.documents.every(isSummary)) {
    throw new Error('Extension returned an invalid documents response')
  }
  return { documents: body.documents }
}

export async function fetchProjectDocument(id: string): Promise<ProjectDocument> {
  const response = await pluginFetch(`documents/${encodeURIComponent(id)}`)
  const body = await readExtensionJson(response) as { document?: unknown, content?: unknown }
  if (!isSummary(body.document) || typeof body.content !== 'string') {
    throw new Error('Extension returned an invalid document response')
  }
  return { ...body.document, content: body.content }
}
