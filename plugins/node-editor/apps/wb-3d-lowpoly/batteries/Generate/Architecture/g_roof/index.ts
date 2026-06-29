/**
 * g_roof —— 追加 `id = roof(footprint=[w,d], type=..., height=..., thickness=..., overhang=...)`。
 *
 * footprint 之上的 flat / shed / gable / hip 屋顶。
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

const VALID_TYPES = new Set(['flat', 'shed', 'gable', 'hip', 'gambrel', 'mansard', 'pyramid']);

export function gRoof(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const width = Number(input.width ?? 6);
  const depth = Number(input.depth ?? 4);
  const type = String(input.type ?? 'gable').trim().toLowerCase();
  if (![width, depth].every(Number.isFinite) || width <= 0 || depth <= 0) {
    return { geometry: incoming, id: '', error: 'roof: width and depth must be positive finite numbers' };
  }
  if (!VALID_TYPES.has(type)) {
    return { geometry: incoming, id: '', error: `roof: type must be one of flat/shed/gable/hip/gambrel/mansard/pyramid, got "${type}"` };
  }

  const args: Record<string, Arg> = {
    footprint: numList([width, depth]),
    type: str(type),
  };

  const overhang = Number(input.overhang ?? 0.3);
  if (Number.isFinite(overhang) && overhang > 0) args.overhang = num(overhang);

  if (type === 'flat') {
    const thickness = Number(input.thickness ?? 0.15);
    if (Number.isFinite(thickness) && thickness > 0) args.thickness = num(thickness);
  } else {
    const height = Number(input.height ?? 1.6);
    if (!Number.isFinite(height) || height <= 0) {
      return { geometry: incoming, id: '', error: 'roof: height must be positive for non-flat roofs' };
    }
    args.height = num(height);
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'roof');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return { geometry: emit(incoming, id, 'roof', args), id };
}

export default gRoof;
