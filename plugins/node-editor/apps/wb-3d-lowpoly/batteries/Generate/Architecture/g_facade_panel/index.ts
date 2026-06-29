/**
 * g_facade_panel —— 追加 `id = facade_panel(panel_size=[w,h], thickness=..., groove_*=...)`。
 *
 * 外立面挂板 / siding：薄板 + 可选水平 reveal 板缝阵列。
 */

import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  numList,
  parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gFacadePanel(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const w = Number(input.panel_w ?? 2.4);
  const h = Number(input.panel_h ?? 2.8);
  const thickness = Number(input.thickness ?? 0.03);
  if (![w, h, thickness].every(Number.isFinite) || w <= 0 || h <= 0 || thickness <= 0) {
    return { geometry: incoming, id: '', error: 'facade_panel: panel_w, panel_h, thickness must be positive finite numbers' };
  }

  const args: Record<string, Arg> = {
    panel_size: numList([w, h]),
    thickness: num(thickness),
  };

  const grooveCount = Math.round(Number(input.groove_count ?? 6));
  if (Number.isFinite(grooveCount) && grooveCount > 0) {
    args.groove_count = num(grooveCount);
    const gd = Number(input.groove_depth ?? 0);
    if (Number.isFinite(gd) && gd > 0) args.groove_depth = num(gd);
    const gw = Number(input.groove_width ?? 0);
    if (Number.isFinite(gw) && gw > 0) args.groove_width = num(gw);
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'facade');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return { geometry: emit(incoming, id, 'facade_panel', args), id };
}

export default gFacadePanel;
