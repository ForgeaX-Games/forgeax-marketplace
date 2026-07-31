import { createExtensionClient } from '@forgeax/workbench-host/extension'

let client: ReturnType<typeof createExtensionClient> | undefined

/** The iframe's single handshake-bound workbench client. */
export function getWorkbenchHost(): ReturnType<typeof createExtensionClient> {
  return client ??= createExtensionClient()
}

export class ExtensionResponseError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'ExtensionResponseError'
  }
}

function isJsonContentType(value: string | null): boolean {
  const mediaType = value?.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === 'application/json' || Boolean(mediaType?.endsWith('+json'))
}

/** Parses only successful, explicitly JSON extension-router responses. */
export async function readExtensionJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new ExtensionResponseError(response.status, `Extension request failed (${response.status})`)
  }
  if (!isJsonContentType(response.headers.get('content-type'))) {
    throw new ExtensionResponseError(response.status, 'Extension returned a non-JSON response')
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ExtensionResponseError(response.status, 'Extension returned malformed JSON')
  }
  return body
}
