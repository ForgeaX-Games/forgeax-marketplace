/**
 * g_material —— 追加 `id = material(rgba=[r, g, b, a])` 一行。
 *
 * v1 只支持 RGBA；texture 留接口未来扩。
 */

import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  numList,
  parseGeometryPort,
} from '../../../../vendor/dist/shared/types/index.js';

export function gMaterial(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const r = Number(input.r ?? 0.5);
  const g = Number(input.g ?? 0.5);
  const b = Number(input.b ?? 0.5);
  const a = Number(input.a ?? 1);
  if (![r, g, b, a].every(v => Number.isFinite(v))) {
    return { geometry: incoming, id: '', error: 'rgba components must be finite numbers' };
  }
  const clamped = [r, g, b, a].map(v => Math.max(0, Math.min(1, v)));

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'mat');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'material', {
    rgba: numList(clamped),
  });
  return { geometry: next, id };
}

export default gMaterial;
