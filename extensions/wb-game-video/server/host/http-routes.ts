/**
 * HTTP route declarations for the wb-game-video extension router.
 *
 * This module is the SSOT for method/path → service method mapping.
 * Handlers live in `router.ts` / `wb-service.ts`; hosts must not re-declare
 * these paths.
 */

export type WbGameVideoServiceMethod =
  | 'importCharacterRefs'
  | 'importSceneRefs'
  | 'generateShotScript'
  | 'generateKeyframe'
  | 'generateVideo'
  | 'generateNodeVideo'

export type WbGameVideoHttpRoute = {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  readonly path: string
  /** Service method for POST routes that share the JSON body → service pattern. */
  readonly service?: WbGameVideoServiceMethod
  /** Free-form GET/POST handlers implemented in router.ts. */
  readonly kind?: 'list-assets' | 'get-asset' | 'list-documents' | 'get-document' | 'set-document-selection' | 'bundled-media' | 'get-style-axes' | 'set-style-axes' | 'host-media'
}

/** Ordered for documentation; router may use maps for O(1) lookup. */
export const WB_GAME_VIDEO_HTTP_ROUTES: readonly WbGameVideoHttpRoute[] = [
  { method: 'GET', path: 'assets', kind: 'list-assets' },
  { method: 'GET', path: 'assets/:id', kind: 'get-asset' },
  { method: 'GET', path: 'documents', kind: 'list-documents' },
  { method: 'GET', path: 'documents/:id', kind: 'get-document' },
  { method: 'POST', path: 'documents/selection', kind: 'set-document-selection' },
  { method: 'GET', path: 'media/bundled/:name', kind: 'bundled-media' },
  { method: 'GET', path: 'style-axes', kind: 'get-style-axes' },
  { method: 'POST', path: 'style-axes', kind: 'set-style-axes' },
  { method: 'POST', path: 'references/characters/import', service: 'importCharacterRefs' },
  { method: 'POST', path: 'references/scenes/import', service: 'importSceneRefs' },
  { method: 'POST', path: 'generation/shot-script', service: 'generateShotScript' },
  { method: 'POST', path: 'generation/keyframe', service: 'generateKeyframe' },
  { method: 'POST', path: 'generation/video', service: 'generateVideo' },
  { method: 'POST', path: 'generation/node-video', service: 'generateNodeVideo' },
  { method: 'GET', path: 'media/capabilities', kind: 'host-media' },
  { method: 'POST', path: 'media/image-assets/upload', kind: 'host-media' },
  { method: 'GET', path: 'media/resources', kind: 'host-media' },
  { method: 'POST', path: 'media/resources', kind: 'host-media' },
  { method: 'POST', path: 'media/resources/batch', kind: 'host-media' },
  { method: 'GET', path: 'media/resources/:id', kind: 'host-media' },
  { method: 'PUT', path: 'media/resources/:id', kind: 'host-media' },
  { method: 'DELETE', path: 'media/resources/:id', kind: 'host-media' },
  { method: 'GET', path: 'media/resources/:id/content', kind: 'host-media' },
  { method: 'PUT', path: 'media/uploads/:id', kind: 'host-media' },
] as const

/** POST paths that dispatch to `createWbGameVideoService` methods. */
export const WB_GAME_VIDEO_POST_SERVICE_ROUTES: ReadonlyMap<string, WbGameVideoServiceMethod> =
  new Map(
    WB_GAME_VIDEO_HTTP_ROUTES
      .filter((route): route is WbGameVideoHttpRoute & { service: WbGameVideoServiceMethod } =>
        route.method === 'POST' && route.service !== undefined)
      .map((route) => [route.path, route.service]),
  )
