/**
 * g_window —— 追加 `id = window(size=[w,h], depth=..., frame=..., mullion=..., glass=...)`。
 *
 * 窗框 + 十字中梃 + 可选玻璃，融合为单一 shape。
 */

import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  numList,
  parseGeometryPort,
  str,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

const VALID_TYPES = new Set(['cross', 'grid', 'louver']);

export function gWindow(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const w = Number(input.width ?? 1.2);
  const h = Number(input.height ?? 1.4);
  const depth = Number(input.depth ?? 0.2);
  const type = String(input.type ?? 'cross').trim().toLowerCase();
  if (![w, h, depth].every(Number.isFinite) || w <= 0 || h <= 0 || depth <= 0) {
    return { geometry: incoming, id: '', error: 'window: width, height, depth must be positive finite numbers' };
  }
  if (!VALID_TYPES.has(type)) {
    return { geometry: incoming, id: '', error: `window: type must be cross/grid/louver, got "${type}"` };
  }

  const args: Record<string, Arg> = {
    size: numList([w, h]),
    depth: num(depth),
  };
  const frame = Number(input.frame ?? 0.06);
  if (Number.isFinite(frame) && frame > 0) args.frame = num(frame);
  const mullion = Number(input.mullion ?? 0.04);
  if (Number.isFinite(mullion) && mullion > 0) args.mullion = num(mullion);
  const glass = Number(input.glass ?? 0);
  if (Number.isFinite(glass) && glass > 0) args.glass = num(glass);
  if (type !== 'cross') args.type = str(type);
  if (type === 'grid' || type === 'louver') {
    const rows = Math.round(Number(input.rows ?? (type === 'louver' ? 5 : 3)));
    if (Number.isFinite(rows) && rows >= 1) args.rows = num(rows);
  }
  if (type === 'grid') {
    const cols = Math.round(Number(input.cols ?? 3));
    if (Number.isFinite(cols) && cols >= 1) args.cols = num(cols);
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'win');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return { geometry: emit(incoming, id, 'window', args), id };
}

export default gWindow;
