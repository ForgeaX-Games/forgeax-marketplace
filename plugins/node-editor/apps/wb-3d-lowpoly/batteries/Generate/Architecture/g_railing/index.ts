/**
 * g_railing —— 追加 `id = railing(length=..., height=..., ...)`。
 *
 * 栏杆 / 护栏：沿 X 一段，两端方立柱 + 顶扶手 + 均布竖向栏杆条。可用于阳台、
 * 走廊、平台、楼梯侧。
 */

import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gRailing(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const length = Number(input.length ?? 3);
  const height = Number(input.height ?? 1.0);
  if (![length, height].every(Number.isFinite) || length <= 0 || height <= 0) {
    return { geometry: incoming, id: '', error: 'railing: length and height must be positive finite numbers' };
  }

  const args: Record<string, Arg> = {
    length: num(length),
    height: num(height),
  };
  const thickness = Number(input.thickness ?? 0.04);
  if (Number.isFinite(thickness) && thickness > 0) args.thickness = num(thickness);
  const postSize = Number(input.post_size ?? 0);
  if (Number.isFinite(postSize) && postSize > 0) args.post_size = num(postSize);
  const railHeight = Number(input.rail_height ?? 0);
  if (Number.isFinite(railHeight) && railHeight > 0) args.rail_height = num(railHeight);
  const balusterCount = Math.round(Number(input.baluster_count ?? -1));
  if (Number.isFinite(balusterCount) && balusterCount >= 0) args.baluster_count = num(balusterCount);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'rail');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return { geometry: emit(incoming, id, 'railing', args), id };
}

export default gRailing;
