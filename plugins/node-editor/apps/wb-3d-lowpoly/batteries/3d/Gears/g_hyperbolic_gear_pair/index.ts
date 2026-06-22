import {
  emit, freshId, isValidId, makeGeometry, num, parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gHyperbolicGearPair(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const mod    = Number(input.module ?? 0.002);
  const g1T    = Math.round(Number(input.gear1_teeth_number ?? 20));
  const width  = Number(input.width ?? 0.01);
  const shaft  = Number(input.shaft_angle ?? 30);

  if (!Number.isFinite(mod) || !Number.isFinite(width) || !Number.isFinite(shaft) || !Number.isFinite(g1T) || g1T < 3) {
    return { geometry: incoming, id: '', error: 'hyperbolic_gear_pair: numeric params invalid' };
  }

  const args: Record<string, Arg> = {
    module:             num(mod),
    gear1_teeth_number: num(g1T),
    width:              num(width),
    shaft_angle:        num(shaft),
  };

  const g2T = Number(input.gear2_teeth_number ?? 0);
  if (Number.isFinite(g2T) && g2T >= 3) args.gear2_teeth_number = num(Math.round(g2T));

  const optNum = ['pressure_angle', 'clearance', 'backlash'] as const;
  for (const k of optNum) {
    const raw = input[k];
    if (raw === undefined || raw === '' || raw === null) continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v === 0) continue;
    args[k] = num(v);
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'hyppr');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'hyperbolic_gear_pair', args);
  return { geometry: next, id };
}

export default gHyperbolicGearPair;
