/**
 * g_stairs —— 追加 `id = stairs(total_rise=..., run=..., width=..., step_count=...)`。
 *
 * 直梯段：逐级叠高的盒体融合成实心楼梯。
 */

import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  parseGeometryPort,
  str,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

const VALID_TYPES = new Set(['straight', 'spiral']);

export function gStairs(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const totalRise = Number(input.total_rise ?? 2.8);
  const run = Number(input.run ?? 0.28);
  const width = Number(input.width ?? 1.0);
  const stepCount = Math.round(Number(input.step_count ?? 14));
  const type = String(input.type ?? 'straight').trim().toLowerCase();
  if (![totalRise, run, width].every(Number.isFinite) || totalRise <= 0 || run <= 0 || width <= 0) {
    return { geometry: incoming, id: '', error: 'stairs: total_rise, run, width must be positive finite numbers' };
  }
  if (!Number.isFinite(stepCount) || stepCount < 1) {
    return { geometry: incoming, id: '', error: 'stairs: step_count must be >= 1' };
  }
  if (!VALID_TYPES.has(type)) {
    return { geometry: incoming, id: '', error: `stairs: type must be straight or spiral, got "${type}"` };
  }

  const args: Record<string, Arg> = {
    total_rise: num(totalRise),
    run: num(run),
    width: num(width),
    step_count: num(stepCount),
  };

  if (type === 'spiral') {
    args.type = str('spiral');
    const radius = Number(input.radius ?? Math.max(width, 1.0));
    const innerRadius = Number(input.inner_radius ?? Math.max(0.05, radius * 0.12));
    const sweepDeg = Number(input.sweep_deg ?? 270);
    if (![radius, innerRadius].every(Number.isFinite) || radius <= 0 || innerRadius <= 0 || innerRadius >= radius) {
      return { geometry: incoming, id: '', error: 'stairs(spiral): need 0 < inner_radius < radius' };
    }
    if (!Number.isFinite(sweepDeg) || Math.abs(sweepDeg) < 1e-3) {
      return { geometry: incoming, id: '', error: 'stairs(spiral): sweep_deg must be a non-zero number' };
    }
    args.radius = num(radius);
    args.inner_radius = num(innerRadius);
    args.sweep_deg = num(sweepDeg);
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'stair');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return { geometry: emit(incoming, id, 'stairs', args), id };
}

export default gStairs;
