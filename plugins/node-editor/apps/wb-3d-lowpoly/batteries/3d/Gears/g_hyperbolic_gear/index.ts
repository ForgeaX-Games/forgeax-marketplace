import {
  emit, freshId, isValidId, makeGeometry, num, parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gHyperbolicGear(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const mod   = Number(input.module ?? 0.002);
  const teeth = Math.round(Number(input.teeth_number ?? 20));
  const width = Number(input.width ?? 0.01);
  const twist = Number(input.twist_angle ?? 30);

  if (!Number.isFinite(mod) || !Number.isFinite(width) || !Number.isFinite(twist) || !Number.isFinite(teeth) || teeth < 3) {
    return { geometry: incoming, id: '', error: 'hyperbolic_gear: numeric params invalid' };
  }

  const args: Record<string, Arg> = {
    module:       num(mod),
    teeth_number: num(teeth),
    width:        num(width),
    twist_angle:  num(twist),
  };

  const optNum = ['pressure_angle', 'clearance', 'backlash', 'bore_d'] as const;
  for (const k of optNum) {
    const raw = input[k];
    if (raw === undefined || raw === '' || raw === null) continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v === 0) continue;
    args[k] = num(v);
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'hyp');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'hyperbolic_gear', args);
  return { geometry: next, id };
}

export default gHyperbolicGear;
