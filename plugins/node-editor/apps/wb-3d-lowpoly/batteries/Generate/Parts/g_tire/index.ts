import {
  bool, emit, freshId, isValidId, makeGeometry, num, parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gTire(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const outerR = Number(input.outer_radius ?? 0.06);
  const w      = Number(input.width ?? 0.03);

  if (!Number.isFinite(outerR) || !Number.isFinite(w)) {
    return { geometry: incoming, id: '', error: 'tire: outer_radius/width must be finite' };
  }

  const args: Record<string, Arg> = {
    outer_radius: num(outerR),
    width:        num(w),
  };

  const innerR = Number(input.inner_radius ?? 0);
  if (innerR > 0) args.inner_radius = num(innerR);
  const treadDepth = Number(input.tread_depth ?? 0);
  if (Number.isFinite(treadDepth) && treadDepth > 0) args.tread_depth = num(treadDepth);
  const treadCount = Number(input.tread_count ?? 0);
  if (Number.isFinite(treadCount) && treadCount > 0) args.tread_count = num(Math.round(treadCount));
  const sidewallDepth = Number(input.sidewall_depth ?? 0);
  if (Number.isFinite(sidewallDepth) && sidewallDepth > 0) args.sidewall_depth = num(sidewallDepth);
  if (input.center === false || input.center === 'false') args.center = bool(false);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'tire');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'tire', args);
  return { geometry: next, id };
}

export default gTire;
