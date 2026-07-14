export type { LayoutPreviewScreenContext, LayoutPrototypeScreenContext } from './types'
export { renderScreenPreviewMarkup } from './screen-preview'
export {
  renderGenrePreviewByTemplate,
  renderGenrePrototypeByTemplate,
  renderLayoutSceneBody,
  wrapGenreLayoutShell,
  GENRE_LAYOUT_PROTO_CSS,
  GENRE_PROTO_WIRE_SCRIPT,
  LAYOUT_SCENE_BODY_CSS,
  SHARED_LAYOUT_SHELL_CSS,
  GENRE_START_LAYOUT_PARITY_CSS,
  WORKBENCH_LAYOUT_SCENE_CSS,
} from './genre-screens'

import type { LayoutPreviewScreenContext, LayoutPrototypeScreenContext } from './types'
import {
  renderGenrePreviewByTemplate,
  renderGenrePrototypeByTemplate,
} from './genre-screens'

export function renderLayoutPreviewFromSpec(ctx: LayoutPreviewScreenContext): string | null {
  return renderGenrePreviewByTemplate(ctx)
}

export function renderLayoutPrototypeFromSpec(ctx: LayoutPrototypeScreenContext): string | null {
  return renderGenrePrototypeByTemplate(ctx)
}
